import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from python_engine.src.speedtest import is_valid_media_segment, probe_ts_segment, probe_single_url

def test_is_valid_media_segment_detection():
    """测试二进制音视频指纹检测"""
    valid_ts_data = b"G" + b"\x00" * 187
    assert is_valid_media_segment(valid_ts_data) is True
    valid_mp4_data = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00" + b"\x00" * 180
    assert is_valid_media_segment(valid_mp4_data) is True
    invalid_html_data = b"<!DOCTYPE html><html><body>Error 403</body></html>" + b"\x00" * 150
    assert is_valid_media_segment(invalid_html_data) is False
    assert is_valid_media_segment(b"G\x00\x00") is False

@pytest.mark.asyncio
async def test_probe_ts_segment_success():
    """测试异步 TS 二进制探针下载：模拟合法返回"""
    mock_session = MagicMock()
    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.content.read.return_value = b"G" + b"\x00" * 200
    mock_session.get.return_value.__aenter__.return_value = mock_response

    res = await probe_ts_segment(mock_session, "http://test.com/chunk_0.ts")
    assert res is True
    mock_response.content.read.assert_called_with(10240)

@pytest.mark.asyncio
async def test_probe_single_url_with_full_validation():
    """测试完整深度双重探针联调：从 m3u8 解析到 ts 二进制校验成功"""
    mock_session = MagicMock()
    mock_m3u8_response = AsyncMock()
    mock_m3u8_response.status = 200
    mock_m3u8_response.url = "http://test.com/index.m3u8"
    mock_m3u8_response.text.return_value = "#EXTM3U\n#EXTINF:5.0,\nsegment.ts\n"

    mock_ts_response = AsyncMock()
    mock_ts_response.status = 200
    mock_ts_response.content.read.return_value = b"G" + b"\x00" * 200

    mock_session.get.return_value.__aenter__.side_effect = [
        mock_m3u8_response,
        mock_ts_response
    ]

    semaphore = asyncio.Semaphore(1)
    result = await probe_single_url(mock_session, "http://test.com/index.m3u8", semaphore, {})
    assert result["success"] is True
    assert result["status"] == 200
    assert result["error"] is None
