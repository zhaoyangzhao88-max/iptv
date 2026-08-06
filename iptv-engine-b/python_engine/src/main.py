import asyncio
import logging
from pathlib import Path
from typing import List
import time
import json
from python_engine.src.fetcher import fetch_all_sources
from python_engine.src.source_config import source_urls, source_id_for_url
from python_engine.src.source_health import (
    load_source_health,
    save_source_health,
    transition_state,
    update_source_health_batch,
    select_recovery_source,
    mark_recovery_attempt,
    finalize_recovery,
    compute_source_stats,
)
from python_engine.src.parser import parse_m3u_content, expand_m3u_streams
from python_engine.src.blocklist import filter_blocked_streams
from python_engine.src.merger import (
    refined_aggregate_streams,
    merge_priority_channels,
    clean_expired_and_dead_channels,
    sort_channel_urls_with_priority,
    orchestrate_channel_groups,
    export_channels_to_list,
    validate_final_json_data
)
from python_engine.src.speedtest import probe_all_urls
from python_engine.src.reputation import update_reputation_scores_batch, load_reputation_scores
from python_engine.src.writer import (
    determine_manifest_path,
    determine_output_path,
    write_publication,
)
from python_engine.src.normalizer import rewrite_special_stream_url
from python_engine.src.quality_gate import evaluate_quality_gate
from python_engine.src.url_policy import is_special_loopback_url

logger = logging.getLogger(__name__)

async def main() -> List[dict]:
    logger.info("[IPTV-Engine-B] 正在启动全渠道数据清洗测速合并流水线...")

    # 1. 抓取：并发抓取 5 大高质量 GitHub M3U 播放源 (Lesson 6)
    logger.info("[Step 1] 开始从显式授权源进行同步...")
    configured_urls = source_urls()
    source_ids = [source_id_for_url(url) for url in configured_urls]
    health = load_source_health()
    recovery_source_id = select_recovery_source(source_ids, health)
    recovery_url = next((url for url in configured_urls if source_id_for_url(url) == recovery_source_id), None)
    active_urls = [
        url for url in configured_urls
        if health.get(source_id_for_url(url), {}).get("status") != "removed"
    ]
    fetch_urls = active_urls + ([recovery_url] if recovery_url and recovery_url not in active_urls else [])
    if recovery_source_id:
        mark_recovery_attempt(health, recovery_source_id, timestamp=time.time())
        save_source_health(health)
    raw_m3u_dict = fetch_all_sources(fetch_urls)
    if not raw_m3u_dict:
        save_source_health(health)
        raise RuntimeError("all configured sources failed; stable publication preserved")

    # 2. 解析：M3U #EXTINF 元数据像素级解析 (Lesson 7)
    logger.info("[Step 2] 开始对原始数据进行 #EXTINF 属性拆解...")
    all_raw_streams = []
    recovery_valid_m3u = False
    for url, content in raw_m3u_dict.items():
        source_id = source_id_for_url(url)
        parsed_streams = parse_m3u_content(content, source_id=source_id)
        all_raw_streams.extend(parsed_streams)
        if source_id == recovery_source_id and parsed_streams:
            recovery_valid_m3u = True
    url_to_sources = {}
    for stream in all_raw_streams:
        if stream.source_id:
            url_to_sources.setdefault(stream.raw_url, set()).add(stream.source_id)
    logger.info(f"-> 原始盲扫成功，共捕获 {len(all_raw_streams)} 条原始播放线路")

    # 3. 解套：嵌套子 M3U 列表递归自动下钻展开 (Lesson 8)
    logger.info("[Step 3] 启动套娃子列表解包递归引擎...")
    expanded_streams = expand_m3u_streams(all_raw_streams)

    # 4. 去污：黑名单恶意域名、广告特征拦截 (Lesson 9)
    logger.info("[Step 4] 拦截 epg.pw / catvod 恶意劫持流...")
    clean_streams = filter_blocked_streams(expanded_streams)

    # 5. 合并：同名频道强力去噪、美容与同名合并 (Lesson 11~12)
    logger.info("[Step 5] 频道名强力去噪标准化，并合并同名多线路...")
    rewritten_streams = [rewrite_special_stream_url(stream) for stream in clean_streams]
    channels = refined_aggregate_streams(rewritten_streams)
    logger.info(f"-> 离线清洗完成，粗归并出 {len(channels)} 个有效标准频道卡片")

    # 6. 抢占：混入广电专网/酒店组播极品源并无条件置顶 (Lesson 32)
    logger.info("[Step 6] 混入广电专网有线/酒店组播极品源（无条件置顶 preemption）...")
    # 生产环境中可挂接探测器返回的流，此处作为核心骨架
    mock_priority_streams = []
    channels = merge_priority_channels(channels, mock_priority_streams)

    # 7. 测速：启动千协程异步 TS 分片级测速与 302 重定向拦截 (Lesson 16~21)
    logger.info("[Step 7] 启动高并发异步 TS 视频切片级探针与 302 劫持链检测...")
    all_urls = []
    for c in channels:
        all_urls.extend(c.urls)
    logger.info(f"-> 共有 {len(all_urls)} 条线路进入实时网络拨测流水线")
    probe_results = await probe_all_urls(all_urls, max_concurrent=50)
    if url_to_sources:
        source_sync = {source_id_for_url(url): bool(raw_m3u_dict.get(url)) for url in raw_m3u_dict}
        update_source_health_batch(
            source_sync,
            {url: url_to_sources[url] for url in set(all_urls) if url in url_to_sources},
            probe_results,
        )
    if recovery_source_id:
        recovery_stats = compute_source_stats(url_to_sources, probe_results).get(recovery_source_id, {})
        recovery_success = recovery_valid_m3u and recovery_stats.get("healthy_streams", 0) > 0
        health = load_source_health()
        health[recovery_source_id] = finalize_recovery(
            health.get(recovery_source_id),
            recovery_success,
            healthy_streams=recovery_stats.get("healthy_streams", 0),
            total_streams=recovery_stats.get("total_streams", 0),
        )
        save_source_health(health)
    successful_urls = {
        result.get('url') for result in probe_results
        if result.get('url') and result.get('success') is True
    }
    # Node resolver routes are stable publication references, not externally
    # probeable media URLs. Preserve only the strict supported route shape;
    # malformed/local URLs must still be removed by the normal probe filter.
    publishable_loopback_urls = {
        url for url in all_urls if is_special_loopback_url(url)
    }
    successful_urls.update(publishable_loopback_urls)

    # 8. 清淤：剔除历史信誉 <= 0 的死链，并斩首"空壳台" (Lesson 33)
    logger.info("[Step 8] 结合历史积分进行失效线路强力清淤...")
    scores = load_reputation_scores()
    cleaned_channels = clean_expired_and_dead_channels(channels, scores)
    for channel in cleaned_channels:
        channel.urls = [url for url in channel.urls if url in successful_urls]
        if any(
            url.lower().startswith('http://')
            and '127.0.0.1' not in url.lower()
            and 'localhost' not in url.lower()
            for url in channel.urls
        ):
            channel.risk_flags = sorted(set(channel.risk_flags).union(['http-cleartext']))
    cleaned_channels = [channel for channel in cleaned_channels if channel.urls]

    # 9. 排序：双层高精度主备线分级排序 (Lesson 34)
    logger.info("[Step 9] 主备线路自适应双层延迟排序（极品前置、普通殿后）...")
    delay_scores = {r["url"]: r["delay_ms"] for r in probe_results}
    sorted_channels = sort_channel_urls_with_priority(cleaned_channels, delay_scores)

    # 10. 编排：商业级电视盒子排序大编排 (Lesson 35)
    logger.info("[Step 10] 频道列表自然顺序漏斗大编排...")
    final_channels = orchestrate_channel_groups(sorted_channels)

    # 11. 序列化：输出符合 B 端播放器格式的纯净数据 (Lesson 36)
    logger.info("[Step 11] 清洗 null 值，序列化输出纯净契约字典...")
    final_json_list = export_channels_to_list(final_channels)

    # 12. 强校验：Pydantic 工业级强校验强规则合规性核验 (Lesson 37)
    logger.info("[Step 12] 启动数据物理写盘前的最后一秒强契约 Schema 强校验...")
    if not validate_final_json_data(final_json_list):
        raise RuntimeError("最终输出的数据契约强校验失败，已紧急熔断写盘！")

    # 13. 质量门禁：候选必须先通过稳定快照比较和隐私扫描。
    output_path = determine_output_path()
    manifest_path = determine_manifest_path(output_path)
    output_exists = Path(output_path).exists()
    manifest_exists = Path(manifest_path).exists()
    if output_exists != manifest_exists:
        raise RuntimeError("稳定快照与 manifest 不一致，拒绝覆盖")
    stable_manifest = manifest_path if output_exists and manifest_exists else None
    gate_result = evaluate_quality_gate(
        final_json_list,
        probe_results,
        stable_manifest=stable_manifest,
    )
    if not gate_result.accepted:
        reasons = "; ".join(gate_result.reasons)
        raise RuntimeError(f"质量门禁拒绝候选快照：{reasons}")

    # 14. 信誉与候选快照通过同一发布事务原子落盘。
    logger.info("[Step 14] 质量门禁通过，原子发布稳定快照、manifest 与信誉状态...")
    scores = load_reputation_scores()
    now = time.time()
    for result in probe_results:
        url = result.get('url')
        if not url:
            continue
        current = scores.get(url, {'s': 100, 't': now})
        current_score = current.get('s', 100) if isinstance(current, dict) else int(current)
        scores[url] = {
            's': min(100, current_score + 10) if result.get('success') else max(0, current_score - 20),
            't': now,
        }
    from python_engine.src.reputation import prune_reputation_scores, REPUTATION_FILE
    reputation_content = json.dumps(prune_reputation_scores(scores), ensure_ascii=False, indent=2)
    written_file_path = write_publication(
        final_json_list,
        gate_result.manifest,
        output_path=output_path,
        manifest_path=manifest_path,
        extra_files={REPUTATION_FILE: reputation_content},
    )
    logger.info(f"-> [SUCCESS] 最终合规精品播放源已物理覆盖写入: {written_file_path}")

    return final_json_list

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
    asyncio.run(main())
