import os
import json
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from python_engine.src.main import main

@pytest.mark.asyncio
async def test_grand_finale_e2e_pipeline_and_writing(tmp_path):
    """【第 40 课大结局测试】：验证全链路 14 步从原始抓取到物理写盘的端到端大合练"""
    # 1. 模拟抓取：一个包含 1 条原始流的 M3U 源
    mock_sources = {
        "https://github.com/source1.m3u": "#EXTM3U\n#EXTINF:-1,CCTV-1 [FHD]\nhttp://live.com/cctv1.m3u8"
    }

    # 2. 模拟测速结果：该流测试成功，延迟为 15ms
    mock_probe_results = [
        {"url": "http://live.com/cctv1.m3u8", "status": 200, "delay_ms": 15, "success": True, "error": None}
    ]

    # 3. 将输出文件重定向至临时隔离测试目录，防止污染真正的 E 盘开发文件
    temp_channels_json = os.path.join(tmp_path, "channels.json")
    temp_scores_json = os.path.join(tmp_path, "history_scores.json")

    # 4. 全量 Mock 外部网络访问与磁盘历史文件
    with patch("python_engine.src.main.fetch_all_sources", return_value=mock_sources), \
         patch("python_engine.src.main.probe_all_urls", return_value=mock_probe_results), \
         patch.dict(os.environ, {"OUTPUT_PATH": temp_channels_json}), \
         patch("python_engine.src.reputation.REPUTATION_FILE", temp_scores_json):

        # 5. 一键点击发动机总阀门，启动主程序
        final_list = await main()

        # 6. 断言 A：验证内存数据结构完全对齐契约
        assert len(final_list) == 1
        assert final_list[0]["name"] == "CCTV-1"
        assert final_list[0]["group"] == "央视频道"
        assert final_list[0]["urls"] == ["http://live.com/cctv1.m3u8"]
        assert final_list[0]["delay_ms"] == 15

        # 7. 断言 B：验证物理落盘成功，且写入的数据在硬盘上完全合法且格式精美
        assert os.path.exists(temp_channels_json)
        with open(temp_channels_json, "r", encoding="utf-8") as f:
            disk_data = json.load(f)
            # 硬盘里的数据必须与内存数据完美对齐
            assert disk_data == final_list
