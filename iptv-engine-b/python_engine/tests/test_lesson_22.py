import os
from unittest.mock import patch
from python_engine.src.reputation import (
    load_reputation_scores,
    update_reputation_scores_batch,
    REPUTATION_FILE
)

def test_batch_reputation_updating_conformance(tmp_path):
    """测试：批量信誉积分结算算法与 I/O 熔断机制"""
    temp_scores_file = os.path.join(tmp_path, "history_scores.json")

    with patch("python_engine.src.reputation.REPUTATION_FILE", temp_scores_file):
        # 模拟测速引擎并发跑完 3 个源后吐出的结果
        mock_probe_results = [
            {"url": "http://ok.com/cctv1.m3u8", "success": True, "delay_ms": 120},
            {"url": "http://ok.com/cctv2.m3u8", "success": True, "delay_ms": 230},
            {"url": "http://bad.com/die.m3u8", "success": False, "delay_ms": 9999}
        ]

        # 执行一键批量刷分
        update_reputation_scores_batch(mock_probe_results)

        # 加载结果验证
        scores = load_reputation_scores()

        # 成功者：因初始得 100 满分，成功加 10 分但不能超过上限，依然是 100 分
        assert scores["http://ok.com/cctv1.m3u8"]["s"] == 100
        assert scores["http://ok.com/cctv2.m3u8"]["s"] == 100

        # 失败者：因初始得 100 满分，扣 20 分后，应当得到 80 分
        assert scores["http://bad.com/die.m3u8"]["s"] == 80
