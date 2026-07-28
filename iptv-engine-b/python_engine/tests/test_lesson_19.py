import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from python_engine.src.speedtest import is_clean_redirect_chain, probe_single_url

def test_is_clean_redirect_chain_logic():
    """测试重定向链条审查逻辑"""
    # 1：最终实际跳转到了 epg.pw 广告台
    mock_bad_final = MagicMock()
    mock_bad_final.url = "http://epg.pw/blue_qrcode.m3u8"
    mock_bad_final.history = []
    assert is_clean_redirect_chain(mock_bad_final) is False

    # 2：初始请求网址正常，但中间跳板历史 (history) 里含有 catvod 广告站
    mock_history_item = MagicMock()
    mock_history_item.url = "http://catvod.com/jump"
    mock_bad_history = MagicMock()
    mock_bad_history.url = "http://normal.com/video.ts"
    mock_bad_history.history = [mock_history_item]
    assert is_clean_redirect_chain(mock_bad_history) is False

    # 3：完全纯净无劫持的链条
    mock_clean = MagicMock()
    mock_clean.url = "http://cctv.com/1.m3u8"
    mock_clean.history = []
    assert is_clean_redirect_chain(mock_clean) is True

@pytest.mark.asyncio
@patch("python_engine.src.speedtest.probe_ts_segment")
@patch("python_engine.src.speedtest.resolve_first_ts_url")
async def test_302_hijack_interception_e2e(mock_resolve, mock_probe):
    """测试端到端拨测时，遇到 302 劫持到黑名单广告台能当场熔断拦截"""
    mock_resolve.return_value = None  # resolve_first_ts_url 内部 is_clean_redirect_chain 拦截 epg.pw
    mock_probe.return_value = False

    mock_session = MagicMock()
    global_sem = asyncio.Semaphore(1)
    result = await probe_single_url(mock_session, "http://good.com/start.m3u8", global_sem, {})

    assert result["success"] is False
    assert "Failed to resolve TS segment URL" == result["error"]
