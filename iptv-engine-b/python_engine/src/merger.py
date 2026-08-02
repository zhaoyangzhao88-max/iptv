import re
from typing import List, Dict
from pydantic import TypeAdapter, ValidationError
from python_engine.src.models import Channel, RawStream
from python_engine.src.normalizer import clean_channel_name, get_channel_group, get_channel_metadata
from python_engine.src.reputation import get_score as _get_reputation_score


def _stream_risk_flags(url: str) -> List[str]:
    lowered = url.lower()
    if lowered.startswith("http://") and "127.0.0.1" not in lowered and "localhost" not in lowered:
        return ["http-cleartext"]
    return []


def _merge_risk_flags(channel: Channel, flags: List[str]) -> None:
    channel.risk_flags = sorted(set(channel.risk_flags).union(flags))


def rough_aggregate_streams(streams: List[RawStream]) -> List[Channel]:
    """第一波：内存粗聚合（保留向后兼容）"""
    aggregated: Dict[str, Channel] = {}
    for stream in streams:
        name = stream.raw_name.strip()
        if not name:
            continue
        key = name.lower()
        if key not in aggregated:
            meta = get_channel_metadata(name) or {}
            aggregated[key] = Channel(
                name=name,
                group=get_channel_group(name),
                urls=[stream.raw_url],
                logo=meta.get("logo") or stream.tvg_logo,
                tvg_id=meta.get("tvg_id"),
                risk_flags=_stream_risk_flags(stream.raw_url),
            )
        else:
            channel = aggregated[key]
            if stream.raw_url not in channel.urls:
                channel.urls.append(stream.raw_url)
            _merge_risk_flags(channel, _stream_risk_flags(stream.raw_url))
    return list(aggregated.values())

def refined_aggregate_streams(streams: List[RawStream]) -> List[Channel]:
    """第二波：高精度深度清洗与智能合并"""
    aggregated: Dict[str, Channel] = {}
    for stream in streams:
        clean_name = clean_channel_name(stream.raw_name)
        if not clean_name:
            continue
        key = clean_name.lower()
        if key not in aggregated:
            meta = get_channel_metadata(clean_name) or {}
            logo = meta.get("logo") or stream.tvg_logo
            group = get_channel_group(clean_name)
            aggregated[key] = Channel(
                name=clean_name,
                group=group,
                urls=[stream.raw_url],
                logo=logo,
                tvg_id=tvg_id if (tvg_id := meta.get("tvg_id")) else None,
                risk_flags=_stream_risk_flags(stream.raw_url),
            )
        else:
            channel = aggregated[key]
            if stream.raw_url not in channel.urls:
                channel.urls.append(stream.raw_url)
            _merge_risk_flags(channel, _stream_risk_flags(stream.raw_url))
    return list(aggregated.values())

def merge_priority_channels(
    standard_channels: List[Channel],
    priority_streams: List[dict]
) -> List[Channel]:
    """第三波：无条件置顶抢占算法（开头浅拷贝，避免修改入参）"""
    channels = list(standard_channels)
    channel_map = {c.name.lower(): c for c in channels}
    for ps in priority_streams:
        url = ps.get("url")
        if not url:
            continue
        channel_key = ps.get("channel_key", "")
        clean_name = clean_channel_name(channel_key) if channel_key else clean_channel_name(ps.get("raw_name", ""))
        if not clean_name:
            continue
        key = clean_name.lower()
        url_lower = url.lower()
        is_multicast_url = "/udp/" in url_lower or "/rtp/" in url_lower
        if key in channel_map:
            channel = channel_map[key]
            if url in channel.urls:
                channel.urls.remove(url)
            channel.urls.insert(0, url)
            channel.delay_ms = ps.get("delay_ms", channel.delay_ms)
            if is_multicast_url:
                channel.is_multicast = True
            if len(channel.urls) > 4:
                channel.urls = channel.urls[:4]
        else:
            group = ps.get("suggested_group", get_channel_group(clean_name))
            meta = get_channel_metadata(clean_name) or {}
            new_channel = Channel(
                name=clean_name,
                group=group,
                urls=[url],
                delay_ms=ps.get("delay_ms", 99),
                logo=meta.get("logo"),
                tvg_id=meta.get("tvg_id"),
                is_multicast=is_multicast_url
            )
            channels.append(new_channel)
            channel_map[key] = new_channel
    return channels

def clean_expired_and_dead_channels(
    channels: List[Channel],
    scores: Dict[str, int]
) -> List[Channel]:
    """第四波：失效源与空壳台清淤函数"""
    cleaned_channels: List[Channel] = []
    for channel in channels:
        channel.urls = [
            url for url in channel.urls
            if _get_reputation_score(scores, url, 100) > 0
        ]
        if len(channel.urls) > 0:
            cleaned_channels.append(channel)
    return cleaned_channels

def sort_channel_urls_with_priority(
    channels: List[Channel],
    delay_scores: Dict[str, int]
) -> List[Channel]:
    """第五波：双层高精度主备线分级排序算法"""
    for channel in channels:
        priority_urls = []
        standard_urls = []
        for url in channel.urls:
            url_lower = url.lower()
            if "/udp/" in url_lower or "/rtp/" in url_lower:
                priority_urls.append(url)
            else:
                standard_urls.append(url)
        priority_urls.sort(key=lambda u: delay_scores.get(u, 9999))
        standard_urls.sort(key=lambda u: delay_scores.get(u, 9999))
        channel.is_multicast = any(
            "/udp/" in url.lower() or "/rtp/" in url.lower()
            for url in channel.urls
        )
        sorted_urls = (priority_urls + standard_urls)[:4]
        channel.urls = sorted_urls
        if sorted_urls:
            channel.delay_ms = delay_scores.get(sorted_urls[0], 9999)
    return channels

def orchestrate_channel_groups(channels: List[Channel]) -> List[Channel]:
    """第六波：地方台分类自动化打包、大板块排序与组内数字自然排序算法"""
    active_channels = [c for c in channels if len(c.urls) > 0]
    GROUP_PRIORITY = {
        "央视频道": 1,
        "卫视频道": 2,
        "其他频道": 999
    }

    def get_group_priority(group_name: str) -> int:
        if group_name in GROUP_PRIORITY:
            return GROUP_PRIORITY[group_name]
        if group_name.endswith("频道"):
            return 10
        return 50

    def get_sort_key(c: Channel) -> tuple:
        cctv_num = 999.0
        if "CCTV" in c.name.upper():
            digits = re.findall(r"\d+", c.name)
            if digits:
                cctv_num = float(digits[0])
                if "+" in c.name:
                    cctv_num += 0.1
        return (
            get_group_priority(c.group),
            c.group,
            cctv_num,
            c.name
        )
    return sorted(active_channels, key=get_sort_key)

def export_channels_to_list(channels: List[Channel]) -> List[dict]:
    """第七波：最终契约格式转换"""
    final_list = []
    for channel in channels:
        clean_dict = channel.model_dump(exclude_none=True)
        final_list.append(clean_dict)
    return final_list

def validate_final_json_data(data: List[dict]) -> bool:
    """
    【第 37 课核心新增】：JSON Schema 与强契约合规性工业级强校验。
    利用 Pydantic v2 的 TypeAdapter 核心，对最终准备写盘的 JSON 数据进行地毯式结构审判。
    只要有任何一个频道：
    1. 缺少必填字段 (如 name)
    2. urls 字段类型不对 (必须为非空字符串数组，结果写成了单字符串或空)
    3. delay_ms 不是整型 (例如被错写成了 "fast")
    TypeAdapter 会在微秒级瞬间抛出 ValidationError，我们捕捉异常并熔断写盘，返回 False。
    通过校验则返回 True。
    """
    try:
        # 使用 TypeAdapter 动态加载 List[Channel] 的强校验契约，底层走 Rust 极速跑完
        ta = TypeAdapter(List[Channel])
        ta.validate_python(data)
        return True
    except ValidationError:
        return False
