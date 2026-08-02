"""Deterministic Python ↔ Node-style redirect-chain integration tests."""

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
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def _wait_for_fixture(process):
    line = await asyncio.wait_for(asyncio.to_thread(process.stdout.readline), timeout=5)
    if not line:
        stderr = await asyncio.to_thread(process.stderr.read)
        raise AssertionError(f"fixture exited before readiness: {stderr}")
    assert "[fixture] ready:" in line, line


async def _stop_fixture(process):
    if process.poll() is not None:
        return
    process.terminate()
    try:
        await asyncio.to_thread(process.wait, 5)
    except subprocess.TimeoutExpired:
        process.kill()
        await asyncio.to_thread(process.wait)


def test_url_rewriting_conformance():
    """Supported platform pages become stable loopback URLs."""
    bili_stream = RawStream(raw_url="https://live.bilibili.com/6", raw_name="B站测试房间")
    rewritten_bili = rewrite_special_stream_url(bili_stream)
    assert rewritten_bili.raw_url == "http://127.0.0.1:3000/api/bilibili/6"

    douyin_stream = RawStream(raw_url="https://live.douyin.com/775841227732", raw_name="抖音测试房")
    rewritten_douyin = rewrite_special_stream_url(douyin_stream)
    assert rewritten_douyin.raw_url == "http://127.0.0.1:3000/api/douyin/775841227732"


@pytest.mark.asyncio
async def test_double_end_integration_e2e_run():
    """Verify redirect → M3U8 → TS probing without contacting platform APIs."""
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    fixture = os.path.join(root_dir, "node_api", "tests", "fixtures", "chain_server.js")
    redirect_port = _free_port()
    media_port = _free_port()
    env = os.environ.copy()
    env.update({"PORT": str(redirect_port), "MEDIA_PORT": str(media_port)})

    node_process = subprocess.Popen(
        ["node", fixture],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        await _wait_for_fixture(node_process)
        connector = aiohttp.TCPConnector(ssl=False)
        async with aiohttp.ClientSession(connector=connector) as session:
            result = await probe_single_url(
                session,
                f"http://127.0.0.1:{redirect_port}/api/bilibili/mock_test_room",
                asyncio.Semaphore(1),
                {},
                timeout=3.5,
            )

        assert result["success"] is True
        assert result["status"] == 200
        assert result["delay_ms"] < 3500
    finally:
        await _stop_fixture(node_process)
