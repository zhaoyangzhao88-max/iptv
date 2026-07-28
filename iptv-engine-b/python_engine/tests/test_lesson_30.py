import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from python_engine.src.hotel_scanner import detect_hotel_gateway

@pytest.mark.asyncio
async def test_udpxy_gateway_detection_success():
    """测试标准 udpxy 状态网页特征的精准识别"""
    mock_session = MagicMock()

    # 模拟请求 /status 返回含有 udpxy 特征字样的标准状态 HTML 页面
    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.text.return_value = "<html><head><title>udpxy status</title></head><body>udpxy version 1.0.23-9</body></html>"

    mock_session.get.return_value.__aenter__.return_value = mock_response

    res = await detect_hotel_gateway(mock_session, "1.1.1.1:8080")
    assert res == "udpxy"

@pytest.mark.asyncio
async def test_hotel_iptv_gateway_detection_success():
    """测试商用酒店 IPTV 自定义有线网关特征精准识别"""
    mock_session = MagicMock()

    # 模拟情况：第一步请求 /status 失败抛错，第二步请求 / 成功并返回 Hilton 酒店网关
    mock_response_root = AsyncMock()
    mock_response_root.status = 200
    mock_response_root.text.return_value = "<html><body>Welcome to Hilton Hotel Guest IPTV Gateway 3.0</body></html>"

    # 串联模拟
    mock_session.get.return_value.__aenter__.side_effect = [
        Exception("mock: status path not found"),  # 模拟请求 status 报错
        mock_response_root                         # 模拟请求 / 成功
    ]

    res = await detect_hotel_gateway(mock_session, "2.2.2.2:8001")
    assert res == "hotel_iptv"

@pytest.mark.asyncio
async def test_unrecognized_normal_website():
    """测试安全兜底：如果是普通无关网页，探测引擎应优雅返回 None，不产生误判"""
    mock_session = MagicMock()

    # 模拟一个普通的个人博客页面
    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.text.return_value = "<html><body>This is Jack's Personal Tech Blog Page. Welcome!</body></html>"

    mock_session.get.return_value.__aenter__.return_value = mock_response

    res = await detect_hotel_gateway(mock_session, "3.3.3.3:80")
    assert res is None
