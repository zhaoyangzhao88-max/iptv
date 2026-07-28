"""
test_node_integration.py — Phase 4: Python ↔ Node.js 集成联调测试

验证 normalizer.py 的 rewrite_special_stream_url() 与
重构后的 Node.js 模块化微服务的连通性与重定向结果。
"""
import pytest
import subprocess
import os
import socket
import json
import asyncio
import aiohttp
from aiohttp import web

from python_engine.src.models import RawStream
from python_engine.src.normalizer import rewrite_special_stream_url


def _free_port():
    """Helper: find an available random TCP port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


class TestUrlRewriting:
    """验证 Python 端 URL 重写算法正确性"""

    def test_bilibili_rewrite(self):
        stream = RawStream(raw_url="https://live.bilibili.com/6", raw_name="B站测试")
        rewritten = rewrite_special_stream_url(stream)
        assert rewritten.raw_url == "http://localhost:3000/api/bilibili/6"

    def test_douyin_rewrite(self):
        stream = RawStream(raw_url="https://live.douyin.com/775841227732", raw_name="抖音测试")
        rewritten = rewrite_special_stream_url(stream)
        assert rewritten.raw_url == "http://localhost:3000/api/douyin/775841227732"

    def test_kuaishou_rewrite(self):
        stream = RawStream(raw_url="https://live.kuaishou.com/u/kpl_live", raw_name="快手测试")
        rewritten = rewrite_special_stream_url(stream)
        assert rewritten.raw_url == "http://localhost:3000/api/kuaishou/kpl_live"

    def test_non_special_url_passthrough(self):
        """非特殊平台的 URL 应保持原样"""
        stream = RawStream(raw_url="https://example.com/stream.m3u8", raw_name="普通流")
        rewritten = rewrite_special_stream_url(stream)
        assert rewritten.raw_url == "https://example.com/stream.m3u8"


@pytest.mark.asyncio
class TestNodeApiIntegration:
    """集成测试：启动真实 Node.js 服务并验证接口行为"""

    @pytest.fixture(autouse=True)
    async def _start_node_server(self):
        """在集成测试中启动真实 Node.js 重定向服务"""
        root_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        node_script = os.path.join(root_dir, "node_api", "src", "redirect_api.js")

        self.node_port = _free_port()
        self.m3u8_port = _free_port()

        env = os.environ.copy()
        env["PORT"] = str(self.node_port)
        env["M3U8_BASE_URL"] = f"http://localhost:{self.m3u8_port}"

        self.node_process = subprocess.Popen(
            ["node", node_script],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        # Give Node.js time to start and bind the port
        await asyncio.sleep(1.0)

        yield  # Run the tests

        # Cleanup
        self.node_process.terminate()
        try:
            self.node_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.node_process.kill()
            self.node_process.wait()

    @property
    def _base_url(self):
        return f"http://localhost:{self.node_port}"

    async def test_health_endpoint(self):
        """验证 /health 接口返回 200 OK"""
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{self._base_url}/health") as resp:
                assert resp.status == 200
                data = await resp.json()
                assert data["status"] == "ok"
                assert int(data["port"]) == self.node_port

    async def test_bilibili_redirect_302(self):
        """验证 B站有效房间号返回 302 重定向（含真实流或 fallback 路径）"""
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self._base_url}/api/bilibili/12345", allow_redirects=False
            ) as resp:
                assert resp.status == 302
                location = resp.headers.get("Location", "")
                # 可能返回真实流 URL（API 成功）或 fallback 路径
                assert any([
                    "/bilibili/12345" in location,  # fallback
                    location.startswith("https://") or location.startswith("http://"),  # real URL
                ])

    async def test_bilibili_invalid_room_400(self):
        """验证 B站非法房间号返回 400"""
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self._base_url}/api/bilibili/<script>", allow_redirects=False
            ) as resp:
                assert resp.status == 400

    async def test_bilibili_empty_room_400(self):
        """验证 B站空房间号（仅斜杠）返回 400"""
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self._base_url}/api/bilibili/", allow_redirects=False
            ) as resp:
                # May be 400 or 404 depending on route matching
                assert resp.status in (400, 404)

    async def test_douyin_redirect_302(self):
        """验证抖音有效房间号返回 302"""
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self._base_url}/api/douyin/775841227732", allow_redirects=False
            ) as resp:
                assert resp.status == 302
                location = resp.headers.get("Location", "")
                assert "/douyin/775841227732.m3u8" in location

    async def test_douyin_invalid_room_400(self):
        """验证抖音非法房间号返回 400"""
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self._base_url}/api/douyin/abc/def", allow_redirects=False
            ) as resp:
                assert resp.status == 400

    async def test_kuaishou_redirect_302(self):
        """验证快手有效用户ID返回 302"""
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self._base_url}/api/kuaishou/kpl_live", allow_redirects=False
            ) as resp:
                assert resp.status == 302
                location = resp.headers.get("Location", "")
                assert "/kuaishou/kpl_live.m3u8" in location

    async def test_kuaishou_invalid_room_400(self):
        """验证快手非法ID返回 400"""
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self._base_url}/api/kuaishou/<script>alert(1)</script>",
                allow_redirects=False,
            ) as resp:
                assert resp.status == 400

    async def test_unknown_route_404(self):
        """验证未知路径返回 404"""
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self._base_url}/api/unknown", allow_redirects=False
            ) as resp:
                assert resp.status == 404

    async def test_cors_header_present(self):
        """验证所有响应包含 CORS 头"""
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{self._base_url}/health") as resp:
                assert resp.headers.get("Access-Control-Allow-Origin") == "*"


@pytest.mark.asyncio
class TestFullRedirectChainE2E:
    """端到端测试：Python → Node.js 302 → 模拟 M3U8 → TS 探测"""

    @pytest.fixture(autouse=True)
    async def _setup_servers(self):
        """启动 Node.js 服务 + Python 模拟 M3U8 服务器"""
        root_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        node_script = os.path.join(root_dir, "node_api", "src", "redirect_api.js")

        self.node_port = _free_port()
        self.m3u8_port = _free_port()

        # Start mock M3U8 server
        self.mock_runner = await self._start_mock_m3u8_server(self.m3u8_port)

        # Start Node.js redirect server
        env = os.environ.copy()
        env["PORT"] = str(self.node_port)
        env["M3U8_BASE_URL"] = f"http://localhost:{self.m3u8_port}"

        self.node_process = subprocess.Popen(
            ["node", node_script],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        await asyncio.sleep(1.0)

        yield

        # Cleanup
        self.node_process.terminate()
        try:
            self.node_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.node_process.kill()
            self.node_process.wait()
        await self.mock_runner.cleanup()

    async def _start_mock_m3u8_server(self, port):
        """启动本地模拟 M3U8 + TS 内容的 HTTP 服务器"""

        async def m3u8_handler(request):
            room_id = request.match_info.get("room_id", "unknown")
            m3u8_body = (
                "#EXTM3U\n"
                "#EXT-X-VERSION:3\n"
                f"#EXTINF:5.0,\n"
                f"http://localhost:{port}/ts/{room_id}/chunk_0.ts\n"
            )
            return web.Response(text=m3u8_body, content_type="application/vnd.apple.mpegurl")

        async def ts_handler(request):
            ts_data = b"\x47" + b"\x00" * 200  # Valid TS sync byte
            return web.Response(body=ts_data, content_type="video/mp2t")

        app = web.Application()
        app.router.add_get("/bilibili/{room_id}.m3u8", m3u8_handler)
        app.router.add_get("/douyin/{room_id}.m3u8", m3u8_handler)
        app.router.add_get("/kuaishou/{room_id}.m3u8", m3u8_handler)
        app.router.add_get("/ts/{room_id}/chunk_0.ts", ts_handler)

        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "localhost", port)
        await site.start()
        return runner

    async def test_full_bilibili_redirect_chain(self):
        """验证完整的 B站重定向链：Node 302 → mock M3U8 → TS"""
        from python_engine.src.speedtest import probe_single_url

        connector = aiohttp.TCPConnector(ssl=False)
        async with aiohttp.ClientSession(connector=connector) as session:
            global_sem = asyncio.Semaphore(1)
            result = await probe_single_url(
                session,
                f"http://localhost:{self.node_port}/api/bilibili/test_room",
                global_sem,
                {},
                timeout=5.0,
            )
            assert result["success"] is True
            assert result["status"] == 200
            assert result["delay_ms"] < 5000

    async def test_full_douyin_redirect_chain(self):
        """验证完整的抖音重定向链"""
        from python_engine.src.speedtest import probe_single_url

        connector = aiohttp.TCPConnector(ssl=False)
        async with aiohttp.ClientSession(connector=connector) as session:
            global_sem = asyncio.Semaphore(1)
            result = await probe_single_url(
                session,
                f"http://localhost:{self.node_port}/api/douyin/775841227732",
                global_sem,
                {},
                timeout=5.0,
            )
            assert result["success"] is True
            assert result["status"] == 200
            assert result["delay_ms"] < 5000
