import pytest
import subprocess
import os
import asyncio
import aiohttp
from aiohttp import web
from unittest.mock import patch, AsyncMock
from python_engine.src.models import RawStream
from python_engine.src.normalizer import rewrite_special_stream_url
from python_engine.src.speedtest import probe_single_url


def test_url_rewriting_conformance():
    """验证 Python 端的 B站/抖音 原始 URL 伪装重写算法"""
    bili_stream = RawStream(raw_url="https://live.bilibili.com/6", raw_name="B站测试房间")
    rewritten_bili = rewrite_special_stream_url(bili_stream)
    assert rewritten_bili.raw_url == "http://localhost:3000/api/bilibili/6"

    douyin_stream = RawStream(raw_url="https://live.douyin.com/775841227732", raw_name="抖音测试房")
    rewritten_douyin = rewrite_special_stream_url(douyin_stream)
    assert rewritten_douyin.raw_url == "http://localhost:3000/api/douyin/775841227732"


async def _start_mock_m3u8_server():
    """启动一个本地模拟 m3u8 + TS 内容的 HTTP 服务器（替代外部 test-stream.com）"""
    async def m3u8_handler(request):
        room_id = request.match_info.get("room_id", "unknown")
        m3u8_body = f"#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:5.0,\nhttp://localhost:3011/ts/{room_id}/chunk_0.ts\n"
        return web.Response(text=m3u8_body, content_type="application/vnd.apple.mpegurl")

    async def ts_handler(request):
        # 返回合法的 TS 二进制数据（以 0x47 开头）
        ts_data = b"\x47" + b"\x00" * 200
        return web.Response(body=ts_data, content_type="video/mp2t")

    app = web.Application()
    app.router.add_get("/bilibili/{room_id}.m3u8", m3u8_handler)
    app.router.add_get("/ts/{room_id}/chunk_0.ts", ts_handler)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "localhost", 3011)
    await site.start()
    return runner


@pytest.mark.asyncio
async def test_double_end_integration_e2e_run():
    """
    【双端 E2E 终大大考】：
    1. 启动真实的 Node.js 重定向服务后台进程（设定端口为 3010 避免冲突）。
    2. 启动本地 Python 模拟服务器（端口 3011）提供 m3u8 + TS 内容。
    3. Node.js 将请求重定向到本地 3011 端口（替代外部 test-stream.com）。
    4. Python 协程客户端对本地 Node.js 接口发起测速，验证 302 深度下钻、TS 探针通过。
    5. 测试完强行杀掉 Node 进程，释放资源。
    """
    # 定位本地 node_api 核心服务物理地址
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    node_server_script = os.path.join(root_dir, "node_api", "src", "redirect_api.js")

    # 启动本地 m3u8 模拟服务器（端口 3011）
    mock_runner = await _start_mock_m3u8_server()

    try:
        # 1. 建立子进程启动环境，强行设置端口为 3010 并强制调用监听
        env = os.environ.copy()
        env["PORT"] = "3010"
        env["NODE_ENV"] = "production"
        # 关键：将重定向目标改为本地 3011 端口（替代外部不可达的 test-stream.com）
        env["M3U8_BASE_URL"] = "http://localhost:3011"

        # 启动 Node.js API 服务器后台进程
        node_process = subprocess.Popen(
            ["node", node_server_script],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )

        # 给 Node.js 服务器 1.5 秒启动、初始化和绑定 3010 端口的时间
        await asyncio.sleep(1.5)

        try:
            # 我们对刚才初始化的 B站模拟接口发起测速
            test_api_url = "http://localhost:3010/api/bilibili/mock_test_room"

            # 使用 Python ClientSession 建立连接池，并发测试 3010 本地 Node 接口
            connector = aiohttp.TCPConnector(ssl=False)
            async with aiohttp.ClientSession(connector=connector) as session:
                semaphore = asyncio.Semaphore(1)
                result = await probe_single_url(session, test_api_url, semaphore, {}, timeout=3.5)

                # 联调大考必须通过！
                assert result["success"] is True
                assert result["status"] == 200
                assert result["delay_ms"] < 3500

        finally:
            # 4. 无论成功还是失败，必须安全销毁后台 Node.js 进程，释放 3010 端口！
            node_process.terminate()
            node_process.wait()
    finally:
        # 清理本地 m3u8 模拟服务器
        await mock_runner.cleanup()
