"""Deterministic Python ↔ Node.js integration contract tests."""

import asyncio
import os
import socket
import subprocess

import aiohttp
import pytest

from python_engine.src.models import RawStream
from python_engine.src.normalizer import rewrite_special_stream_url
from python_engine.src.speedtest import probe_single_url


def _free_port():
    """Return an available loopback TCP port for a test fixture."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def _wait_for_fixture(process):
    """Wait for a fixture's explicit readiness line and surface early exits."""
    line = await asyncio.wait_for(
        asyncio.to_thread(process.stdout.readline),
        timeout=5,
    )
    if not line:
        stderr = await asyncio.to_thread(process.stderr.read)
        raise AssertionError(f"fixture exited before readiness: {stderr}")
    assert "[fixture] ready:" in line, line


async def _stop_fixture(process):
    """Terminate a fixture without leaving a child process behind on Windows."""
    if process.poll() is not None:
        return
    process.terminate()
    try:
        await asyncio.to_thread(process.wait, 5)
    except subprocess.TimeoutExpired:
        process.kill()
        await asyncio.to_thread(process.wait)


@pytest.fixture
def node_fixture_path():
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    return os.path.join(root_dir, "node_api", "tests", "fixtures", "integration_server.js")


@pytest.fixture
def chain_fixture_path():
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    return os.path.join(root_dir, "node_api", "tests", "fixtures", "chain_server.js")


class TestUrlRewriting:
    """Verify stable loopback URLs emitted by the Python normalizer."""

    def test_bilibili_rewrite(self):
        stream = RawStream(raw_url="https://live.bilibili.com/6", raw_name="B站测试")
        rewritten = rewrite_special_stream_url(stream)
        assert rewritten.raw_url == "http://127.0.0.1:3000/api/bilibili/6"

    def test_douyin_rewrite(self):
        stream = RawStream(raw_url="https://live.douyin.com/775841227732", raw_name="抖音测试")
        rewritten = rewrite_special_stream_url(stream)
        assert rewritten.raw_url == "http://127.0.0.1:3000/api/douyin/775841227732"

    def test_kuaishou_rewrite(self):
        stream = RawStream(raw_url="https://live.kuaishou.com/u/kpl_live", raw_name="快手测试")
        rewritten = rewrite_special_stream_url(stream)
        assert rewritten.raw_url == "http://127.0.0.1:3000/api/kuaishou/kpl_live"

    def test_non_special_url_passthrough(self):
        stream = RawStream(raw_url="https://example.com/stream.m3u8", raw_name="普通流")
        rewritten = rewrite_special_stream_url(stream)
        assert rewritten.raw_url == "https://example.com/stream.m3u8"


@pytest.fixture
async def started_integration_server(node_fixture_path, request):
    port = _free_port()
    env = os.environ.copy()
    env.update({
        "PORT": str(port),
        "RESOLVER_MODE": getattr(request, "param", "success"),
    })
    process = subprocess.Popen(
        ["node", node_fixture_path],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        await _wait_for_fixture(process)
        yield f"http://127.0.0.1:{port}", process
    finally:
        await _stop_fixture(process)


@pytest.mark.asyncio
@pytest.mark.parametrize("started_integration_server", ["success"], indirect=True)
async def test_node_success_contract(started_integration_server):
    """Successful injected resolvers return validated HTTPS redirects."""
    base_url, _ = started_integration_server
    async with aiohttp.ClientSession() as session:
        async with session.get(f"{base_url}/health") as response:
            assert response.status == 200
            health = await response.json()
            assert health["status"] == "ok"
            assert health["port"] == int(base_url.rsplit(":", 1)[1])

        expected = {
            "bilibili": "12345",
            "douyin": "775841227732",
            "kuaishou": "kpl_live",
        }
        for platform, room_id in expected.items():
            async with session.get(
                f"{base_url}/api/{platform}/{room_id}",
                allow_redirects=False,
            ) as response:
                assert response.status == 302
                assert response.headers["Location"] == (
                    f"https://streams.example/{platform}/{room_id}.m3u8"
                )


@pytest.mark.asyncio
@pytest.mark.parametrize("started_integration_server", ["failure"], indirect=True)
async def test_node_failure_is_retryable_without_placeholder_redirect(started_integration_server):
    """Resolver failure remains visible and never becomes a fake 302 target."""
    base_url, _ = started_integration_server
    async with aiohttp.ClientSession() as session:
        async with session.get(
            f"{base_url}/api/douyin/775841227732",
            allow_redirects=False,
        ) as response:
            assert response.status == 503
            assert "Location" not in response.headers
            body = await response.json()
            assert body["retryable"] is True
            assert body["platform"] == "douyin"


@pytest.mark.asyncio
@pytest.mark.parametrize("started_integration_server", ["success"], indirect=True)
async def test_node_validation_and_health_contract(started_integration_server):
    """Malformed IDs are rejected before resolver invocation."""
    base_url, _ = started_integration_server
    async with aiohttp.ClientSession() as session:
        for path in (
            "/api/bilibili/",
            "/api/bilibili/<script>",
            "/api/douyin/abc/def",
        ):
            async with session.get(f"{base_url}{path}", allow_redirects=False) as response:
                assert response.status == 400

        async with session.get(f"{base_url}/api/unknown", allow_redirects=False) as response:
            assert response.status == 404

        async with session.get(f"{base_url}/health") as response:
            assert response.headers["Access-Control-Allow-Origin"] == "*"


@pytest.mark.asyncio
async def test_full_redirect_chain_with_deterministic_media_fixture(chain_fixture_path):
    """Verify Python probing follows a local redirect, M3U8, and TS segment."""
    redirect_port = _free_port()
    media_port = _free_port()
    env = os.environ.copy()
    env.update({"PORT": str(redirect_port), "MEDIA_PORT": str(media_port)})
    process = subprocess.Popen(
        ["node", chain_fixture_path],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        await _wait_for_fixture(process)
        connector = aiohttp.TCPConnector(ssl=False)
        async with aiohttp.ClientSession(connector=connector) as session:
            result = await probe_single_url(
                session,
                f"http://127.0.0.1:{redirect_port}/api/douyin/775841227732",
                asyncio.Semaphore(1),
                {},
                timeout=5.0,
            )

        assert result["success"] is True
        assert result["status"] == 200
        assert result["delay_ms"] < 5000
    finally:
        await _stop_fixture(process)
