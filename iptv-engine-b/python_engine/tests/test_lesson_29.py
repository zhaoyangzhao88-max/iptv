import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from python_engine.src.cdn_scanner import scan_provincial_cdn

@pytest.mark.asyncio
async def test_provincial_cdn_scanning_and_group_injection():
    """测试多协程 CDN 爆破扫参：模拟部分成功、部分失败，验证过滤和分组标签注入机制"""
    mock_session = MagicMock()

    # 广东广电字典含有 3 个频道：cctv1, gdtv, sztv
    # 我们模拟测速结果：
    # 1. cctv1 -> 成功 (status=200, success=True, delay_ms=80)
    # 2. gdtv  -> 成功 (status=200, success=True, delay_ms=120)
    # 3. sztv  -> 失败 (status=0, success=False)

    mock_cctv_result = {"url": "http://gd-cdn.com/cctv1/cctv1.m3u8", "status": 200, "delay_ms": 80, "success": True, "error": None}
    mock_gdtv_result = {"url": "http://gd-cdn.com/gdtv/gdtv.m3u8", "status": 200, "delay_ms": 120, "success": True, "error": None}
    mock_sztv_result = {"url": "http://gd-cdn.com/sztv/sztv.m3u8", "status": 0, "delay_ms": 9999, "success": False, "error": "Timeout"}

    # 拦截 probe_single_url 探针，防止进行真实的公网测速
    with patch("python_engine.src.cdn_scanner.probe_single_url") as mock_probe:
        mock_probe.side_effect = [
            mock_cctv_result,
            mock_gdtv_result,
            mock_sztv_result
        ]

        semaphore = asyncio.Semaphore(5)
        # 执行并发爆破扫描
        scan_results = await scan_provincial_cdn(mock_session, "广东广电", "gd-cdn.com", semaphore)

        # 断言：成功的 2 个频道被留存，失败的 1 个（sztv）被抛弃
        assert len(scan_results) == 2

        # 验证 cctv1
        cctv = next(r for r in scan_results if r["channel_key"] == "cctv1")
        assert cctv["url"] == "http://gd-cdn.com/cctv1/cctv1.m3u8"
        assert cctv["success"] is True
        assert cctv["delay_ms"] == 80
        # 验证 suggested_group 是否自动注入成了"广东频道"
        assert cctv["suggested_group"] == "广东频道"

        # 验证 gdtv
        gdtv = next(r for r in scan_results if r["channel_key"] == "gdtv")
        assert gdtv["url"] == "http://gd-cdn.com/gdtv/gdtv.m3u8"
        assert gdtv["suggested_group"] == "广东频道"
