import asyncio
import logging
import os
import json
from typing import List
from python_engine.src.fetcher import fetch_all_sources
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
from python_engine.src.writer import write_channels_json

logger = logging.getLogger(__name__)

async def main() -> List[dict]:
    logger.info("[IPTV-Engine-B] 正在启动全渠道数据清洗测速合并流水线...")

    # 1. 抓取：并发抓取 5 大高质量 GitHub M3U 播放源 (Lesson 6)
    logger.info("[Step 1] 开始从预设 5 大顶级源进行盲扫抓取...")
    raw_m3u_dict = fetch_all_sources()

    # 2. 解析：M3U #EXTINF 元数据像素级解析 (Lesson 7)
    logger.info("[Step 2] 开始对原始数据进行 #EXTINF 属性拆解...")
    all_raw_streams = []
    for url, content in raw_m3u_dict.items():
        all_raw_streams.extend(parse_m3u_content(content))
    logger.info(f"-> 原始盲扫成功，共捕获 {len(all_raw_streams)} 条原始播放线路")

    # 3. 解套：嵌套子 M3U 列表递归自动下钻展开 (Lesson 8)
    logger.info("[Step 3] 启动套娃子列表解包递归引擎...")
    expanded_streams = expand_m3u_streams(all_raw_streams)

    # 4. 去污：黑名单恶意域名、广告特征拦截 (Lesson 9)
    logger.info("[Step 4] 拦截 epg.pw / catvod 恶意劫持流...")
    clean_streams = filter_blocked_streams(expanded_streams)

    # 5. 合并：同名频道强力去噪、美容与同名合并 (Lesson 11~12)
    logger.info("[Step 5] 频道名强力去噪标准化，并合并同名多线路...")
    channels = refined_aggregate_streams(clean_streams)
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

    # 8. 积分：高性能批量结算并更新本地"功德簿" (Lesson 22)
    logger.info("[Step 8] 高性能批量更新 history_scores 历史信誉积分...")
    update_reputation_scores_batch(probe_results)

    # 9. 清淤：剔除信誉分 <= 0 的死链，并斩首"空壳台" (Lesson 33)
    logger.info("[Step 9] 结合历史积分进行失效线路强力清淤...")
    scores = load_reputation_scores()
    cleaned_channels = clean_expired_and_dead_channels(channels, scores)

    # 10. 排序：双层高精度主备线分级排序 (Lesson 34)
    logger.info("[Step 10] 主备线路自适应双层延迟排序（极品前置、普通殿后）...")
    delay_scores = {r["url"]: r["delay_ms"] for r in probe_results}
    sorted_channels = sort_channel_urls_with_priority(cleaned_channels, delay_scores)

    # 11. 编排：商业级电视盒子排序大编排 (Lesson 35)
    logger.info("[Step 11] 频道列表自然顺序漏斗大编排...")
    final_channels = orchestrate_channel_groups(sorted_channels)

    # 12. 序列化：输出符合 B 端播放器格式的纯净数据 (Lesson 36)
    logger.info("[Step 12] 清洗 null 值，序列化输出纯净契约字典...")
    final_json_list = export_channels_to_list(final_channels)

    # 13. 强校验：Pydantic 工业级强校验强规则合规性核验 (Lesson 37)
    logger.info("[Step 13] 启动数据物理写盘前的最后一秒强契约 Schema 强校验...")
    if not validate_final_json_data(final_json_list):
        raise RuntimeError("最终输出的数据契约强校验失败，已紧急熔断写盘！")

    # 14. 【新增写盘】：自适应物理覆盖写入最终位置
    logger.info("[Step 14] 启动跨平台自适应物理写盘...")
    written_file_path = write_channels_json(final_json_list)
    logger.info(f"-> [SUCCESS] 最终合规精品播放源已物理覆盖写入: {written_file_path}")

    return final_json_list

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
    asyncio.run(main())
