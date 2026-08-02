import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from python_engine.src.main import main

@pytest.mark.asyncio
async def test_main_pipeline_integrated_runner_success(tmp_path):
    """测试 main.py 流水线大总管：一键大连调测试，确保 13 步串联不会发生逻辑或包导入崩溃"""
    # 模拟第 6 课下载器返回的原始数据
    mock_sources = {
        "https://github.com/source1.m3u": "#EXTM3U\n#EXTINF:-1,CCTV1 [FHD]\nhttp://live.com/cctv.m3u8"
    }

    # 模拟第 16 课测速引擎返回的成功结果
    mock_probe_results = [
        {"url": "http://live.com/cctv.m3u8", "status": 200, "delay_ms": 15, "success": True, "error": None}
    ]

    # 同时拦截外部下载和外部测速，实行百分之百安全的本地测试
    output_path = tmp_path / "channels.json"
    manifest_path = tmp_path / "channels.manifest.json"
    reputation_path = tmp_path / "history_scores.json"
    with patch("python_engine.src.main.fetch_all_sources", return_value=mock_sources), \
         patch("python_engine.src.main.probe_all_urls", return_value=mock_probe_results), \
         patch("python_engine.src.reputation.REPUTATION_FILE", str(reputation_path)), \
         patch.dict("os.environ", {"OUTPUT_PATH": str(output_path), "MANIFEST_PATH": str(manifest_path)}):

        final_list = await main()

        # 验证大合练运行完后，输出的 JSON 契约数据完全符合要求
        assert len(final_list) == 1
        assert final_list[0]["name"] == "CCTV-1"  # 必须已自动去噪
        assert final_list[0]["group"] == "央视频道" # 必须已自动大归组
        assert final_list[0]["urls"] == ["http://live.com/cctv.m3u8"]
        assert final_list[0]["delay_ms"] == 15    # 延迟必须已被高精度覆写
