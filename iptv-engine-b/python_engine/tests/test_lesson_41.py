"""
Lesson 41: 域名级测速频控 (Per-Domain Rate Limit)
覆盖 speedtest.py 的 extract_domain 函数与域名级 Semaphore 频控机制（Task 1.1）
"""
import asyncio
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from python_engine.src.speedtest import extract_domain, probe_single_url, probe_all_urls


class TestExtractDomain:
    """域名提取辅助函数测试"""

    def test_normal_http_url(self):
        assert extract_domain("http://example.com/live.m3u8") == "example.com"

    def test_with_port(self):
        # 端口号属于 netloc 的一部分，不同端口的域名应视为不同限流域
        assert extract_domain("http://cdn.example.com:8080/stream.ts") == "cdn.example.com:8080"

    def test_https_url(self):
        assert extract_domain("https://live.cdn.com/playlist.m3u8") == "live.cdn.com"

    def test_with_path(self):
        assert extract_domain("http://123.45.67.89:8080/udp/1234") == "123.45.67.89:8080"

    def test_malformed_url(self):
        assert extract_domain("") == "unknown"

    def test_none_input(self):
        # 测试极端情况
        assert extract_domain(None) == "unknown"


class TestProbeSingleUrlDomainSemaphore:
    """域名级并发信号量隔离测试"""

    @pytest.mark.asyncio
    async def test_domain_semaphore_created(self):
        """验证 probe_single_url 为每个域名创建 Semaphore(3)"""
        session = AsyncMock()
        global_sem = asyncio.Semaphore(50)
        domain_sems = {}

        with patch("python_engine.src.speedtest.is_direct_stream", return_value=True), \
             patch("python_engine.src.speedtest.probe_ts_segment", AsyncMock(return_value=True)):
            result = await probe_single_url(session, "http://example.com/stream.m3u8", global_sem, domain_sems)

        assert "example.com" in domain_sems
        assert isinstance(domain_sems["example.com"], asyncio.Semaphore)

    @pytest.mark.asyncio
    async def test_same_domain_reuses_semaphore(self):
        """同一域名复用同一个 Semaphore 对象"""
        session = AsyncMock()
        global_sem = asyncio.Semaphore(50)
        domain_sems = {}

        with patch("python_engine.src.speedtest.is_direct_stream", return_value=True), \
             patch("python_engine.src.speedtest.probe_ts_segment", AsyncMock(return_value=True)):
            await probe_single_url(session, "http://example.com/1.m3u8", global_sem, domain_sems)
            await probe_single_url(session, "http://example.com/2.m3u8", global_sem, domain_sems)

        assert domain_sems["example.com"] is not None
        # 两次调用应返回同一信号量对象
        assert domain_sems["example.com"] is domain_sems.get("example.com")

    @pytest.mark.asyncio
    async def test_different_domains_independent_semaphores(self):
        """不同域名使用不同 Semaphore，互不影响"""
        session = AsyncMock()
        global_sem = asyncio.Semaphore(50)
        domain_sems = {}

        with patch("python_engine.src.speedtest.is_direct_stream", return_value=True), \
             patch("python_engine.src.speedtest.probe_ts_segment", AsyncMock(return_value=True)):
            await probe_single_url(session, "http://cdn1.example.com/a.m3u8", global_sem, domain_sems)
            await probe_single_url(session, "http://cdn2.example.com/b.m3u8", global_sem, domain_sems)

        assert "cdn1.example.com" in domain_sems
        assert "cdn2.example.com" in domain_sems
        assert domain_sems["cdn1.example.com"] is not domain_sems["cdn2.example.com"]

    @pytest.mark.asyncio
    async def test_probe_all_urls_creates_domain_sems(self):
        """probe_all_urls 集成：自动创建并传递 domain_sems"""
        with patch("python_engine.src.speedtest.probe_single_url", AsyncMock(return_value={
            "url": "http://example.com/t.m3u8", "status": 200, "delay_ms": 100, "success": True
        })):
            results = await probe_all_urls(["http://example.com/a.m3u8", "http://other.com/b.m3u8"], max_concurrent=10)
            assert len(results) == 2
            assert results[0]["success"]
