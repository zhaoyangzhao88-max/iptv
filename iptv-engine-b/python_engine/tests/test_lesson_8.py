import pytest
from unittest.mock import patch, MagicMock
from python_engine.src.models import RawStream
from python_engine.src.parser import expand_m3u_streams, is_m3u_playlist

def test_is_m3u_playlist_logic():
    """测试 M3U 子列表链接的精准判定"""
    assert is_m3u_playlist("http://test.com/list.m3u") is True
    assert is_m3u_playlist("http://test.com/list.M3U?token=abc") is True
    assert is_m3u_playlist("http://test.com/stream.m3u8") is False  # 必须是.m3u而非.m3u8流媒体链接
    assert is_m3u_playlist("http://test.com/video.ts") is False

@patch("python_engine.src.parser.smart_request_get")
def test_m3u_expansion_success(mock_get):
    """测试嵌套 M3U 递归自动展开，且完全扁平化归并"""
    # 模拟父 M3U 解析出来的流列表。第一个是直链流，第二个是子列表链接
    initial_streams = [
        RawStream(raw_url="http://direct.com/cctv.m3u8", raw_name="CCTV-1"),
        RawStream(raw_url="http://sub.com/local_list.m3u", raw_name="地方源子列表")
    ]

    # 模拟子 M3U 的下载内容
    mock_sub_response = MagicMock()
    mock_sub_response.status_code = 200
    mock_sub_response.text = """#EXTM3U
#EXTINF:-1,绍兴新闻
http://shaoxing.com/live.m3u8
#EXTINF:-1,温州生活
http://wenzhou.com/live.m3u8
"""
    mock_get.return_value = mock_sub_response

    flat_results = expand_m3u_streams(initial_streams)

    # 子列表 2 个台 + 直链 1 个台 = 3 个
    assert len(flat_results) == 3
    assert flat_results[0].raw_name == "CCTV-1"
    assert flat_results[0].raw_url == "http://direct.com/cctv.m3u8"
    assert flat_results[1].raw_name == "绍兴新闻"
    assert flat_results[1].raw_url == "http://shaoxing.com/live.m3u8"
    assert flat_results[2].raw_name == "温州生活"
    assert flat_results[2].raw_url == "http://wenzhou.com/live.m3u8"

@patch("python_engine.src.parser.smart_request_get")
def test_circular_dependency_deadlock_prevention(mock_get):
    """测试死循环防熔断：当 A 列表自我循环嵌套时，必须能秒速跳出，杜绝死机"""
    initial_streams = [
        RawStream(raw_url="http://circle.com/A.m3u", raw_name="A列表")
    ]

    mock_response = MagicMock()
    mock_response.status_code = 200
    # A.m3u 的内容又指向了 A.m3u 自己，形成循环套娃
    mock_response.text = """#EXTM3U
#EXTINF:-1,A列表自我引用
http://circle.com/A.m3u
"""
    mock_get.return_value = mock_response

    # 执行展开，如果防死锁不生效，这里会触发无限递归并崩溃
    flat_results = expand_m3u_streams(initial_streams)

    # 应当能顺利跳出，且结果为空（因为没有真正的直链流）
    assert len(flat_results) == 0
