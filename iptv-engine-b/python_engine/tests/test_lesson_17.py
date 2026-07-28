import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from python_engine.src.speedtest import parse_m3u8_for_next_link, resolve_first_ts_url

def test_parse_m3u8_master_playlist_conformance():
    """测试：解析一级主列表（嵌套二级子列表）"""
    base_url = "http://live.com/index.m3u8"
    master_content = """#EXTM3U
#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=800000,RESOLUTION=1280x720
sub_playlist_720p.m3u8
"""
    next_link = parse_m3u8_for_next_link(master_content, base_url)
    # 应完美解析子列表，并基于 base_url 拼装为绝对路径
    assert next_link == "http://live.com/sub_playlist_720p.m3u8"

def test_parse_m3u8_media_playlist_relative_path():
    """测试：解析二级媒体列表（含有相对路径的 .ts 切片）"""
    base_url = "http://live.com/sub/index.m3u8"
    media_content = """#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:5.008,
segment_0001.ts
"""
    next_link = parse_m3u8_for_next_link(media_content, base_url)
    # 应完美解析出首个 TS 视频切片，且正确处理相对路径级别
    assert next_link == "http://live.com/sub/segment_0001.ts"

@pytest.mark.asyncio
async def test_resolve_first_ts_url_recursive_mock():
    """测试：异步递归下钻，Master M3U8 -> Media M3U8 -> TS 视频切片"""
    mock_session = MagicMock()

    # 1. 模拟第一次拉取一级主列表 (Master Playlist)
    mock_master_response = AsyncMock()
    mock_master_response.status = 200
    mock_master_response.url = "http://test.com/master.m3u8"
    mock_master_response.text.return_value = """#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000
media.m3u8
"""

    # 2. 模拟第二次拉取二级分片列表 (Media Playlist)
    mock_media_response = AsyncMock()
    mock_media_response.status = 200
    mock_media_response.url = "http://test.com/media.m3u8"
    mock_media_response.text.return_value = """#EXTM3U
#EXTINF:6.0,
chunk_01.ts
"""

    # 串联模拟：依次返回主列表和二级分片列表
    mock_session.get.return_value.__aenter__.side_effect = [
        mock_master_response,
        mock_media_response
    ]

    # 执行下钻解析
    ts_url = await resolve_first_ts_url(mock_session, "http://test.com/master.m3u8")

    # 应完美下钻 2 层，解析出最终的 TS 切片绝对路径
    assert ts_url == "http://test.com/chunk_01.ts"
