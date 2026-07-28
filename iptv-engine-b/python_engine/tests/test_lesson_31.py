import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from python_engine.src.speedtest import is_direct_stream, probe_single_url

def test_is_direct_stream_pattern_conformance():
    """测试直连流（组播、.ts直链）的自适应规则判定"""
    # 组播代理（udpxy）标准单播流判定
    assert is_direct_stream("http://119.130.1.1:8080/udp/239.93.0.184:8001") is True
    assert is_direct_stream("http://119.130.1.1:8080/rtp/239.93.0.184:8001") is True
    # 显式 .ts 结尾
    assert is_direct_stream("http://119.130.1.1:8080/live/cctv_max.ts") is True

    # 标准 M3U8 列表应该返回 False，继续走下钻流程
    assert is_direct_stream("http://119.130.1.1:8080/live/cctv_max.m3u8") is False

@pytest.mark.asyncio
async def test_udpxy_direct_probe_bypass_success():
    """测试：udpxy 播放链接通过探针直连验证，跳过 M3U8 下钻解析"""
    mock_session = MagicMock()

    # 模拟直接请求该 UDP 单播地址，返回 200，且 content.read 成功读出同步码 0x47
    mock_response = AsyncMock()
    mock_response.status = 200
    mock_response.content.read.return_value = b"G" + b"\x00" * 200

    mock_session.get.return_value.__aenter__.return_value = mock_response

    semaphore = asyncio.Semaphore(1)
    # 对 UDP 代理单播地址发起拨测
    result = await probe_single_url(mock_session, "http://1.1.1.1:8080/udp/239.93.0.1:8001", semaphore, {}, timeout=3.5)

    # 1. 验证探测状态成功
    assert result["success"] is True
    assert result["status"] == 200
    assert result["error"] is None
    # 2. 【最核心断言】：验证 get 仅被调用了 1 次（只发起了 10KB 探针下载，0次 M3U8 网页下载！）
    # 证明 M3U8 网页下钻流程被完美自适应跳过，零网络带宽浪费！
    assert mock_session.get.call_count == 1
