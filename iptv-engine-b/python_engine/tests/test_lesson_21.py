import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from python_engine.src.speedtest import probe_single_url

@pytest.mark.asyncio
async def test_high_precision_delay_calculation():
    """测试高精度物理延迟计算：延迟必须专指 TS 切片的纯净下载耗时"""
    mock_session = MagicMock()

    # 模拟 M3U8 解析成功
    mock_m3u8_response = AsyncMock()
    mock_m3u8_response.status = 200
    mock_m3u8_response.url = "http://test.com/index.m3u8"
    mock_m3u8_response.text.return_value = "#EXTM3U\n#EXTINF:5.0,\nsegment.ts\n"

    # 模拟 TS 下载成功，并在 read 时故意延迟 0.1 秒 (100毫秒)，测试高精度计时器是否准确
    mock_ts_response = AsyncMock()
    mock_ts_response.status = 200

    async def slow_read(*args, **kwargs):
        await asyncio.sleep(0.1)  # 故意休眠 100 毫秒，代表网络请求时间
        return b"G" + b"\x00" * 200

    mock_ts_response.content.read.side_effect = slow_read

    mock_session.get.return_value.__aenter__.side_effect = [
        mock_m3u8_response,
        mock_ts_response
    ]

    semaphore = asyncio.Semaphore(1)
    result = await probe_single_url(mock_session, "http://test.com/index.m3u8", semaphore, {}, timeout=3.5)

    assert result["success"] is True
    # 纯净物理延迟不应该包含 M3U8 的建立连接和解析时间，而应在 100 毫秒左右（允许微小系统调度开销，卡在 300 毫秒内）
    assert 90 <= result["delay_ms"] <= 300
    assert result["status"] == 200

@pytest.mark.asyncio
async def test_high_precision_delay_failure_fallback():
    """测试高精度延迟兜底：当校验失败时，delay_ms 必须强制回退至 9999 极值"""
    mock_session = MagicMock()

    # 模拟 M3U8 解析成功
    mock_m3u8_response = AsyncMock()
    mock_m3u8_response.status = 200
    mock_m3u8_response.url = "http://test.com/index.m3u8"
    mock_m3u8_response.text.return_value = "#EXTM3U\n#EXTINF:5.0,\nsegment.ts\n"

    # 模拟 TS 下载失败 (403 错误)
    mock_ts_response = AsyncMock()
    mock_ts_response.status = 403

    mock_session.get.return_value.__aenter__.side_effect = [
        mock_m3u8_response,
        mock_ts_response
    ]

    semaphore = asyncio.Semaphore(1)
    result = await probe_single_url(mock_session, "http://test.com/index.m3u8", semaphore, {}, timeout=3.5)

    assert result["success"] is False
    assert result["delay_ms"] == 9999  # 必须回退到 9999 极值，确保合并排序时自动沉底！
