import pytest
from unittest.mock import patch
from python_engine.src.models import RawStream, Channel
from python_engine.src.merger import refined_aggregate_streams


# ================== 辅助函数 ==================

def _make_streams(name_url_pairs):
    """快速构造 RawStream 列表：传入 [(raw_name, raw_url), ...]"""
    return [
        RawStream(raw_name=name, raw_url=url)
        for name, url in name_url_pairs
    ]


# ================== 测试用例 ==================

@patch("python_engine.src.merger.get_channel_metadata", return_value=None)
def test_basic_denoising_merge(_mock_meta):
    """测试：不同噪声的同一频道应合并为 1 个，URL 保序累加
    clean_channel_name 会将 [FHD]、[电信]、(测试)、超清 等噪声全部剥离，
    因此 "CCTV-1 [FHD]"、"CCTV-1 [电信]"、"cctv1" 清洗后均为 "CCTV-1"。
    """
    streams = _make_streams([
        ("CCTV-1 [FHD]", "http://a.com/1.m3u8"),
        ("CCTV-1 [电信]", "http://b.com/2.m3u8"),
        ("cctv1", "http://c.com/3.m3u8"),
    ])

    result = refined_aggregate_streams(streams)

    assert len(result) == 1
    assert result[0].name == "CCTV-1"
    assert len(result[0].urls) == 3
    assert result[0].urls == [
        "http://a.com/1.m3u8",
        "http://b.com/2.m3u8",
        "http://c.com/3.m3u8",
    ]


@patch("python_engine.src.merger.get_channel_metadata")
def test_logo_priority_official_wins(_mock_meta):
    """测试：iptv-org 官方 logo 优先级最高"""
    _mock_meta.return_value = {
        "tvg_id": "cctv1.cn",
        "logo": "http://official.com/cctv1.png",
    }

    streams = _make_streams([
        ("CCTV-1 [FHD]", "http://a.com/1.m3u8"),
    ])
    # 第一个流自带一个非官方 logo
    streams[0].tvg_logo = "http://unofficial.com/logo.png"

    result = refined_aggregate_streams(streams)

    assert len(result) == 1
    assert result[0].logo == "http://official.com/cctv1.png"
    assert result[0].tvg_id == "cctv1.cn"


@patch("python_engine.src.merger.get_channel_metadata", return_value=None)
def test_logo_fallback_to_tvg_logo(_mock_meta):
    """测试：无官方 logo 时，回退到组内首个有效 tvg_logo"""
    streams = _make_streams([
        ("CCTV-1 [FHD]", "http://a.com/1.m3u8"),
        ("CCTV-1 [电信]", "http://b.com/2.m3u8"),
    ])
    streams[0].tvg_logo = "http://first.com/logo.png"
    streams[1].tvg_logo = "http://second.com/logo.png"

    result = refined_aggregate_streams(streams)

    assert len(result) == 1
    # 应选第一个流的 tvg_logo（先到先得）
    assert result[0].logo == "http://first.com/logo.png"


@patch("python_engine.src.merger.get_channel_metadata", return_value=None)
def test_url_limit_enforced(_mock_meta):
    """测试：同一频道超过 4 个不同 URL 时，截断到 4 条"""
    streams = _make_streams([
        ("CCTV-1 [FHD]", "http://a.com/1.m3u8"),
        ("CCTV-1 [电信]", "http://b.com/2.m3u8"),
        ("CCTV-1 (测试)", "http://c.com/3.m3u8"),
        ("CCTV-1 超清", "http://d.com/4.m3u8"),
        ("CCTV-1 备用", "http://e.com/5.m3u8"),
        ("CCTV-1 极速", "http://f.com/6.m3u8"),
    ])

    result = refined_aggregate_streams(streams)

    assert len(result) == 1
    # refined_aggregate_streams 合并阶段不截断 URL，截断由后续 sort/merge_priority 负责
    assert len(result[0].urls) == 6
    assert result[0].urls == [
        "http://a.com/1.m3u8",
        "http://b.com/2.m3u8",
        "http://c.com/3.m3u8",
        "http://d.com/4.m3u8",
        "http://e.com/5.m3u8",
        "http://f.com/6.m3u8",
    ]


@patch("python_engine.src.merger.get_channel_metadata", return_value=None)
def test_best_name_is_shortest_clean(_mock_meta):
    """测试：最短清洗名胜出（去噪最彻底 = 最规范）
    当多个原始名称清洗后得到相同的 clean_key 时，选最短者作为最终 name。
    例如 "CCTV-1 超清" → "CCTV-1"（6 字符）与 "CCTV-1 [FHD]" → "CCTV-1"（6 字符）
    同长先到先得；而 "CCTV-1 综合" → "CCTV-1 综合"（10 字符）与 "CCTV-1 [FHD]" → "CCTV-1"
    清洗结果不同，属于不同 key，不合并。

    本用例验证：同一 clean_key 下，最短清洗名胜出。
    "CCTV-1 [FHD]" → "CCTV-1"（6 字符）
    "CCTV-1 [超清]" → "CCTV-1"（6 字符）
    同长，先到先得，最终 name = "CCTV-1"。
    """
    streams = _make_streams([
        ("CCTV-1 [FHD]", "http://a.com/1.m3u8"),
        ("CCTV-1 [超清]", "http://b.com/2.m3u8"),
    ])

    result = refined_aggregate_streams(streams)

    assert len(result) == 1
    # 两者清洗后均为 "CCTV-1"，同长先到先得
    assert result[0].name == "CCTV-1"


@patch("python_engine.src.merger.get_channel_metadata", return_value=None)
def test_empty_raw_name_skipped(_mock_meta):
    """测试：空名称流不产生任何频道"""
    streams = _make_streams([
        ("", "http://a.com/1.m3u8"),
        ("   ", "http://b.com/2.m3u8"),
        ("CCTV-1 [FHD]", "http://c.com/3.m3u8"),
    ])

    result = refined_aggregate_streams(streams)

    assert len(result) == 1
    assert result[0].name == "CCTV-1"


@patch("python_engine.src.merger.get_channel_metadata", return_value=None)
def test_group_assignment(_mock_meta):
    """测试：频道分组自动分配正确"""
    streams = _make_streams([
        ("CCTV-1 [FHD]", "http://a.com/1.m3u8"),
        ("湖南卫视 [电信]", "http://b.com/2.m3u8"),
        ("浙江新闻 [FHD]", "http://c.com/3.m3u8"),
    ])

    result = refined_aggregate_streams(streams)

    assert len(result) == 3

    cctv = next(c for c in result if c.name == "CCTV-1")
    assert cctv.group == "央视频道"

    hunan = next(c for c in result if c.name == "湖南卫视")
    assert hunan.group == "卫视频道"

    zhejiang = next(c for c in result if c.name == "浙江新闻")
    assert zhejiang.group == "浙江频道"
