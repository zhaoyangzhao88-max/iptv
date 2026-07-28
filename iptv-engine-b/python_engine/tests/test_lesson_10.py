import pytest
from unittest.mock import patch, MagicMock
from python_engine.src.models import RawStream, Channel
from python_engine.src.parser import parse_m3u_content, expand_m3u_streams
from python_engine.src.blocklist import filter_blocked_streams
from python_engine.src.merger import rough_aggregate_streams

@patch("python_engine.src.merger.get_channel_metadata", return_value=None)
@patch("python_engine.src.parser.smart_request_get")
def test_phase_2_pipeline_integration(mock_get, mock_meta):
    """
    Phase 2 全链路端到端集成大考：
    1. 模拟两个不同的 M3U 订阅源（含同名重复台、假台、以及嵌套的子列表链接）。
    2. 执行：解析 -> 自动解套娃 -> 拦截过滤垃圾台 -> 同名内存聚合。
    3. 校验最终生成的 Channel 列表是否完全合规。
    """
    # 模拟数据源 1
    m3u_source_1 = """#EXTM3U
#EXTINF:-1 tvg-logo="http://logo.com/cctv1.png",CCTV-1 综合
http://cctv.com/live1.m3u8
#EXTINF:-1,浙江地方源子列表
http://sub.com/local.m3u
#EXTINF:-1,CCTV-1 假台
http://epg.pw/cctv1.m3u8
"""
    # 模拟数据源 2
    m3u_source_2 = """#EXTM3U
#EXTINF:-1,CCTV-1 综合
http://cctv.com/live2.m3u8
#EXTINF:-1,浙江卫视
http://zjtv.com/live.m3u8
"""

    # 模拟子列表下载请求（测试套娃嵌套解包）
    mock_sub_response = MagicMock()
    mock_sub_response.status_code = 200
    mock_sub_response.text = """#EXTM3U
#EXTINF:-1,绍兴新闻
http://shaoxing.com/live.m3u8
"""
    mock_get.return_value = mock_sub_response

    # ================== 启动流水线 ==================

    # 1. 像素级解析
    streams_1 = parse_m3u_content(m3u_source_1)
    streams_2 = parse_m3u_content(m3u_source_2)
    raw_all_streams = streams_1 + streams_2

    # 2. 套娃展开
    expanded_streams = expand_m3u_streams(raw_all_streams)

    # 3. 强力黑名单清洗
    clean_streams = filter_blocked_streams(expanded_streams)

    # 4. 同名内存粗合并
    final_channels = rough_aggregate_streams(clean_streams)

    # ================== 综合断言判定 ==================

    # 我们期望得到的干净频道数必须为 3 个：
    # CCTV-1 综合 (合成了2个源的链接，分类"央视频道")、绍兴新闻 (嵌套解出，分类"浙江频道")、浙江卫视 (分类"卫视频道")
    # CCTV-1 假台 (因为包含 epg.pw 域名) 必须被完全秒杀

    assert len(final_channels) == 3

    # 验证 CCTV-1 综合
    cctv1 = next(c for c in final_channels if c.name == "CCTV-1 综合")
    assert cctv1.group == "央视频道"
    assert len(cctv1.urls) == 2
    assert "http://cctv.com/live1.m3u8" in cctv1.urls
    assert "http://cctv.com/live2.m3u8" in cctv1.urls
    assert cctv1.logo == "http://logo.com/cctv1.png"

    # 验证绍兴新闻 (套娃列表里的频道)
    shaoxing = next(c for c in final_channels if c.name == "绍兴新闻")
    assert shaoxing.group == "浙江频道"
    assert len(shaoxing.urls) == 1
    assert shaoxing.urls[0] == "http://shaoxing.com/live.m3u8"

    # 验证浙江卫视
    zjtv = next(c for c in final_channels if c.name == "浙江卫视")
    assert zjtv.group == "卫视频道"
