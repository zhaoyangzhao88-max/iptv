import json
from typing import List, Dict
from python_engine.src.parser import parse_m3u_content, expand_m3u_streams
from python_engine.src.blocklist import filter_blocked_streams
from python_engine.src.merger import refined_aggregate_streams
from python_engine.src.reputation import load_reputation_scores, get_score as _get_reputation_score

def run_phase3_pipeline(m3u_contents: List[str]) -> List[dict]:
    """
    第一至第三阶段全链路集成运行器：
    1. 接收多个原始 M3U 文本内容列表。
    2. 解析并解套娃嵌套列表。
    3. 过滤黑名单假台域名及广告词。
    4. 执行同名频道高精度去噪合并。
    5. 根据 reputation 信誉分进行过滤（自动剔除历史积分为 0 的死链）。
    6. 将结果转换为完全兼容 B 端播放器格式的字典列表并返回。
    """
    # 1. 像素级解析
    all_raw_streams = []
    for content in m3u_contents:
        all_raw_streams.extend(parse_m3u_content(content))

    # 2. 嵌套子列表解套娃展开
    expanded_streams = expand_m3u_streams(all_raw_streams)

    # 3. 强力黑名单去广告牛皮癣
    clean_streams = filter_blocked_streams(expanded_streams)

    # 4. 同名频道高精度去噪合并 (此时 cctv1, cctv_1 已融合成标准 CCTV-1)
    channels = refined_aggregate_streams(clean_streams)

    # 5. 信誉分强力洗涤：剔除任何历史积分为 0 的彻底死链
    scores = load_reputation_scores()
    for channel in channels:
        channel.urls = [url for url in channel.urls if _get_reputation_score(scores, url, 100) > 0]

    # 如果该频道的所有播放线都被扣光积分死掉了，直接丢弃该"空壳频道"
    active_channels = [c for c in channels if len(c.urls) > 0]

    # 6. 转换为完全符合 B 端播放器 JSON 契约的字典格式
    output_data = []
    for channel in active_channels:
        # exclude_none=True 确保无台标或 EPG 的时候不会输出 null，保持最终输出的 JSON 纯净极简
        output_data.append(channel.model_dump(exclude_none=True))

    return output_data
