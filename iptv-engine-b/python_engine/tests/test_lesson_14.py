import os
from unittest.mock import patch
from python_engine.src.reputation import (
    load_reputation_scores,
    init_reputation_score,
    update_reputation_score,
    DEFAULT_SCORE
)

def test_reputation_lifecycle_isolated(tmp_path):
    """测试信誉积分的完整生命周期：初始化、查询、失败扣分、成功恢复、触底扣光"""
    # 产生测试专用的隔离路径文件
    temp_scores_file = os.path.join(tmp_path, "history_scores.json")

    # 使用 patch 机制，强行把代码里的 REPUTATION_FILE 替换成临时路径
    with patch("python_engine.src.reputation.REPUTATION_FILE", temp_scores_file):
        # 1. 验证初始状态为空
        assert load_reputation_scores() == {}

        # 2. 模拟新发现一条 CCTV-1 线路，初始化它，应当得到默认的 100 分
        test_url = "http://temp.com/cctv1.m3u8"
        score = init_reputation_score(test_url)
        assert score == DEFAULT_SCORE
        assert load_reputation_scores()[test_url]["s"] == DEFAULT_SCORE

        # 3. 模拟该线路测试失败 1 次（扣 20 分）
        new_score = update_reputation_score(test_url, success=False)
        assert new_score == 80
        assert load_reputation_scores()[test_url]["s"] == 80

        # 4. 模拟该线路测试成功 1 次（恢复 10 分）
        new_score = update_reputation_score(test_url, success=True)
        assert new_score == 90
        assert load_reputation_scores()[test_url]["s"] == 90

        # 5. 模拟该线路测试成功 2 次（验证积分上限不超过 100 分）
        update_reputation_score(test_url, success=True)
        new_score = update_reputation_score(test_url, success=True)
        assert new_score == 100

        # 6. 模拟连续失败 5 次（验证积分触底到 0 分分值，且不再继续扣为负数）
        for _ in range(6):
            new_score = update_reputation_score(test_url, success=False)
        assert new_score == 0
        assert load_reputation_scores()[test_url]["s"] == 0
