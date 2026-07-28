import pytest
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock
from python_engine.src.speedtest import probe_single_url, probe_all_urls

@pytest.mark.asyncio
@patch("python_engine.src.speedtest.probe_ts_segment")
@patch("python_engine.src.speedtest.resolve_first_ts_url")
async def test_async_single_url_success(mock_resolve, mock_probe):
    """测试异步测速：目标台连通且 TS 验证通过"""
    mock_resolve.return_value = "http://fake.com/segment.ts"
    mock_probe.return_value = True

    mock_session = MagicMock()
    global_sem = asyncio.Semaphore(1)

    result = await probe_single_url(mock_session, "http://fake.com/stream.m3u8", global_sem, {})

    assert result["success"] is True
    assert result["status"] == 200
    assert result["delay_ms"] < 1000
    assert result["error"] is None

@pytest.mark.asyncio
@patch("python_engine.src.speedtest.probe_ts_segment")
@patch("python_engine.src.speedtest.resolve_first_ts_url")
async def test_async_single_url_timeout(mock_resolve, mock_probe):
    """测试异步测速：TS 解析失败时正确报错"""
    mock_resolve.return_value = None  # 模拟解析失败
    mock_probe.return_value = False

    mock_session = MagicMock()
    global_sem = asyncio.Semaphore(1)

    result = await probe_single_url(mock_session, "http://fake.com/stream.m3u8", global_sem, {})

    assert result["success"] is False
    assert result["status"] == 0
    assert "Failed to resolve TS segment URL" == result["error"]

@pytest.mark.asyncio
@patch("python_engine.src.speedtest.probe_ts_segment")
@patch("python_engine.src.speedtest.resolve_first_ts_url")
async def test_async_all_urls_concurrency_scheduling(mock_resolve, mock_probe):
    """测试多路并发调度引擎"""
    mock_resolve.return_value = "http://fake.com/segment.ts"
    mock_probe.return_value = True

    test_urls = ["http://u1.com", "http://u2.com", "http://u3.com"]

    with patch("aiohttp.ClientSession") as mock_session_cls:
        mock_session_instance = MagicMock()
        mock_session_cls.return_value.__aenter__.return_value = mock_session_instance

        results = await probe_all_urls(test_urls, max_concurrent=3)

        assert len(results) == 3
        for res in results:
            assert res["success"] is True
            assert res["status"] == 200
