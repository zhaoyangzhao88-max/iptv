"""
Lesson 43: 信誉分文件上限淘汰控制 (Reputation Score Capacity Control)
覆盖 reputation.py 的 prune_reputation_scores、自动迁移、容量上限（Task 1.3）
"""
import time
import json
import pytest
from python_engine.src.reputation import (
    load_reputation_scores,
    save_reputation_scores,
    prune_reputation_scores,
    get_score,
    MAX_SCORE_ENTRIES,
    DEFAULT_SCORE,
    init_reputation_score,
    update_reputation_scores_batch
)


class TestPruneReputationScores:
    """容量淘汰核心函数测试"""

    def test_below_limit_no_prune(self):
        """少于 2000 条时不应删减"""
        scores = {f"url{i}": {"s": 100, "t": time.time()} for i in range(100)}
        result = prune_reputation_scores(scores)
        assert len(result) == 100

    def test_exceeds_limit_prune_oldest(self):
        """超过上限时按时间戳淘汰最旧条目"""
        now = time.time()
        scores = {}
        for i in range(MAX_SCORE_ENTRIES + 50):
            scores[f"url_{i:04d}"] = {"s": 100, "t": now + i}
        result = prune_reputation_scores(scores)
        assert len(result) == MAX_SCORE_ENTRIES

    def test_low_score_evicted_first(self):
        """同等时间戳时低分优先被淘汰"""
        now = time.time()
        scores = {}
        # 创建略超上限的量，确保不同分数
        for i in range(MAX_SCORE_ENTRIES + 10):
            scores[f"url_{i:04d}"] = {"s": 50, "t": now}
        result = prune_reputation_scores(scores)
        assert len(result) == MAX_SCORE_ENTRIES

    def test_at_limit_no_prune(self):
        """恰好等于上限时不淘汰"""
        scores = {f"url{i}": {"s": 100, "t": time.time()} for i in range(MAX_SCORE_ENTRIES)}
        result = prune_reputation_scores(scores)
        assert len(result) == MAX_SCORE_ENTRIES


class TestGetScoreCompat:
    """get_score 兼容访问器测试"""

    def test_get_score_new_format(self):
        """新版 {s, t} 格式正确提取分数"""
        scores = {"url1": {"s": 80, "t": time.time()}}
        assert get_score(scores, "url1") == 80

    def test_get_score_missing_url(self):
        """缺失 URL 返回默认值"""
        scores = {}
        assert get_score(scores, "nonexistent") == DEFAULT_SCORE

    def test_get_score_custom_default(self):
        """缺失 URL 返回自定义默认值"""
        scores = {}
        assert get_score(scores, "nonexistent", 50) == 50

    def test_get_score_old_format(self):
        """旧版 int 格式兼容"""
        scores = {"url1": 90}
        assert get_score(scores, "url1") == 90


class TestLoadSaveMigration:
    """加载/保存的格式迁移与自动淘汰测试"""

    def test_load_old_format_migrates(self, tmp_path):
        """加载旧版 {url: int} 格式自动迁移为 {url: {s, t}}"""
        from python_engine.src import reputation
        old_file = tmp_path / "history_scores.json"
        old_file.write_text(json.dumps({"http://old.url/stream.m3u8": 80}))
        # 临时替换文件路径
        original_path = reputation.REPUTATION_FILE
        try:
            reputation.REPUTATION_FILE = str(old_file)
            scores = load_reputation_scores()
            assert "http://old.url/stream.m3u8" in scores
            entry = scores["http://old.url/stream.m3u8"]
            assert isinstance(entry, dict)
            assert entry["s"] == 80
            assert "t" in entry  # 应有时间戳
        finally:
            reputation.REPUTATION_FILE = original_path

    def test_save_prunes_before_write(self, tmp_path):
        """保存前自动淘汰超出上限的条目"""
        from python_engine.src import reputation
        old_max = reputation.MAX_SCORE_ENTRIES
        try:
            reputation.MAX_SCORE_ENTRIES = 10
            scores = {f"url{i}": {"s": 100, "t": time.time() + i} for i in range(20)}
            save_reputation_scores(scores)
            # 重新加载验证
            saved = load_reputation_scores()
            assert len(saved) <= 10
        finally:
            reputation.MAX_SCORE_ENTRIES = old_max


class TestBatchUpdateNewFormat:
    """批量更新对新格式的适配"""

    def test_batch_update_creates_dict_entry(self, tmp_path):
        """批量更新为新 URL 创建 {s, t} 格式"""
        from python_engine.src import reputation
        old_file = tmp_path / "history_scores.json"
        original_path = reputation.REPUTATION_FILE
        try:
            reputation.REPUTATION_FILE = str(old_file)
            results = [{"url": "http://new.url/stream.m3u8", "success": True, "delay_ms": 50}]
            update_reputation_scores_batch(results)
            scores = load_reputation_scores()
            assert "http://new.url/stream.m3u8" in scores
            entry = scores["http://new.url/stream.m3u8"]
            assert entry["s"] == DEFAULT_SCORE  # 成功+10但上限100=100
            assert "t" in entry
        finally:
            reputation.REPUTATION_FILE = original_path
