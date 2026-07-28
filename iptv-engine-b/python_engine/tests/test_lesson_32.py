import pytest
from unittest.mock import patch
from python_engine.src.models import Channel
from python_engine.src.merger import merge_priority_channels


# ================== 辅助函数 ==================

def _make_channel(name: str, urls: list, delay_ms: int = 500) -> Channel:
    """快速构造标准 Channel 对象"""
    return Channel(name=name, group="其他频道", urls=list(urls), delay_ms=delay_ms)


def _make_priority(url: str, channel_key: str = "", raw_name: str = "",
                   delay_ms: int = 5, suggested_group: str = "") -> dict:
    """快速构造 priority_stream 字典"""
    ps = {"url": url, "delay_ms": delay_ms}
    if channel_key:
        ps["channel_key"] = channel_key
    if raw_name:
        ps["raw_name"] = raw_name
    if suggested_group:
        ps["suggested_group"] = suggested_group
    return ps


# ================== 测试用例 ==================

@patch("python_engine.src.merger.get_channel_metadata", return_value=None)
def test_prio_url_inserts_at_index_0(_mock_meta):
    """测试：已存在频道，priority url 抢占 index 0"""
    cctv1 = _make_channel("CCTV-1", ["http://pub.com/1.m3u8", "http://pub.com/2.m3u8"])
    standard = [cctv1]

    prio = _make_priority("http://cdn.com/cctv1.ts", channel_key="cctv1", delay_ms=5)

    result = merge_priority_channels(standard, [prio])

    assert len(result) == 1
    # CDN 源必须抢占 index 0
    assert result[0].urls[0] == "http://cdn.com/cctv1.ts"
    # 原有公网源向后顺延
    assert result[0].urls[1] == "http://pub.com/1.m3u8"
    assert result[0].urls[2] == "http://pub.com/2.m3u8"


@patch("python_engine.src.merger.get_channel_metadata", return_value=None)
def test_prio_url_dedup_before_insert(_mock_meta):
    """测试：已存在相同 url，先 remove 再 insert，不重复"""
    cctv1 = _make_channel("CCTV-1", ["http://cdn.com/cctv1.ts", "http://pub.com/2.m3u8"])
    standard = [cctv1]

    # priority stream 的 url 已在 channel 中
    prio = _make_priority("http://cdn.com/cctv1.ts", channel_key="cctv1", delay_ms=5)

    result = merge_priority_channels(standard, [prio])

    assert len(result) == 1
    # 去重后 urls 仍然 2 条，cdn 源被移到 index 0
    assert len(result[0].urls) == 2
    assert result[0].urls[0] == "http://cdn.com/cctv1.ts"
    assert result[0].urls[1] == "http://pub.com/2.m3u8"


@patch("python_engine.src.merger.get_channel_metadata", return_value=None)
def test_prio_delay_ms_override(_mock_meta):
    """测试：priority 的 delay_ms 覆写 channel.delay_ms"""
    cctv1 = _make_channel("CCTV-1", ["http://pub.com/1.m3u8"], delay_ms=500)
    standard = [cctv1]

    prio = _make_priority("http://cdn.com/cctv1.ts", channel_key="cctv1", delay_ms=15)

    result = merge_priority_channels(standard, [prio])

    assert result[0].delay_ms == 15


@patch("python_engine.src.merger.get_channel_metadata", return_value=None)
def test_prio_url_limit_truncate_to_4(_mock_meta):
    """测试：超过 4 条时截断为 4 条"""
    cctv1 = _make_channel("CCTV-1", [
        "http://pub.com/1.m3u8",
        "http://pub.com/2.m3u8",
        "http://pub.com/3.m3u8",
        "http://pub.com/4.m3u8",
    ])
    standard = [cctv1]

    prio = _make_priority("http://cdn.com/cctv1.ts", channel_key="cctv1", delay_ms=5)

    result = merge_priority_channels(standard, [prio])

    assert len(result) == 1
    # 抢占后最多 4 条
    assert len(result[0].urls) == 4
    assert result[0].urls[0] == "http://cdn.com/cctv1.ts"
    # 后 3 条是原有公网源的前 3 条
    assert result[0].urls[1] == "http://pub.com/1.m3u8"
    assert result[0].urls[2] == "http://pub.com/2.m3u8"
    assert result[0].urls[3] == "http://pub.com/3.m3u8"


@patch("python_engine.src.merger.get_channel_metadata", return_value=None)
def test_prio_creates_new_channel_when_missing(_mock_meta):
    """测试：主数据无此频道，自适应新建"""
    cctv1 = _make_channel("CCTV-1", ["http://pub.com/1.m3u8"])
    standard = [cctv1]

    # 主列表中没有"浙江卫视"，应新建
    prio = _make_priority(
        "http://cdn.com/zj.ts",
        channel_key="浙江卫视",
        delay_ms=10,
        suggested_group="浙江频道"
    )

    result = merge_priority_channels(standard, [prio])

    assert len(result) == 2
    zj = next(c for c in result if c.name == "浙江卫视")
    assert zj.urls == ["http://cdn.com/zj.ts"]
    assert zj.delay_ms == 10


@patch("python_engine.src.merger.get_channel_metadata", return_value=None)
def test_prio_new_channel_uses_suggested_group(_mock_meta):
    """测试：新建频道使用 suggested_group"""
    standard = []

    prio = _make_priority(
        "http://hotel.com/shaoxing.ts",
        channel_key="绍兴新闻",
        delay_ms=8,
        suggested_group="浙江频道"
    )

    result = merge_priority_channels(standard, [prio])

    assert len(result) == 1
    assert result[0].name == "绍兴新闻"
    assert result[0].group == "浙江频道"


@patch("python_engine.src.merger.get_channel_metadata", return_value=None)
def test_prio_empty_url_skipped(_mock_meta):
    """测试：priority stream 无 url 时跳过不报错"""
    cctv1 = _make_channel("CCTV-1", ["http://pub.com/1.m3u8"])
    standard = [cctv1]

    prio = {"channel_key": "CCTV-1", "delay_ms": 5}  # 没有 url 字段

    result = merge_priority_channels(standard, [prio])

    assert len(result) == 1
    # urls 不变
    assert result[0].urls == ["http://pub.com/1.m3u8"]


@patch("python_engine.src.merger.get_channel_metadata", return_value=None)
def test_prio_empty_channel_key_skipped(_mock_meta):
    """测试：channel_key 和 raw_name 都为空时跳过"""
    cctv1 = _make_channel("CCTV-1", ["http://pub.com/1.m3u8"])
    standard = [cctv1]

    prio = _make_priority("http://cdn.com/unknown.ts", channel_key="", raw_name="", delay_ms=5)

    result = merge_priority_channels(standard, [prio])

    # 无法解析频道名，跳过，不新建
    assert len(result) == 1
    assert result[0].name == "CCTV-1"
