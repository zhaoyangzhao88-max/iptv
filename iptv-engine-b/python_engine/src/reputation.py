import os
import json
import time
import logging
from typing import Dict, List, Optional, Union

logger = logging.getLogger(__name__)

# 物理信誉分文本存储路径
REPUTATION_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "history_scores.json")

DEFAULT_SCORE = 100
MIN_SCORE = 0
MAX_SCORE_ENTRIES = 2000
DECAY_POINTS = 20    # 每次拨测失败扣除 20 分
RECOVER_POINTS = 10  # 每次拨测成功恢复 10 分 (上限 100 分)


def prune_reputation_scores(scores: Dict[str, dict]) -> Dict[str, dict]:
    """
    容量上限淘汰控制。
    若信誉分条目超过 MAX_SCORE_ENTRIES（默认 2000），按时间戳升序淘汰最旧条目。
    同等时间戳时按 URL 字母序淘汰。记录日志。
    """
    if len(scores) <= MAX_SCORE_ENTRIES:
        return scores
    sorted_urls = sorted(
        scores.keys(),
        key=lambda u: (scores[u].get("t", 0), u)
    )
    excess = len(scores) - MAX_SCORE_ENTRIES
    for url in sorted_urls[:excess]:
        del scores[url]
    logger.warning(
        "Reputation scores pruned: %d -> %d entries (evicted %d oldest)",
        len(scores) + excess, len(scores), excess
    )
    return scores


def get_score(scores: Dict[str, dict], url: str, default: int = DEFAULT_SCORE) -> int:
    """
    兼容访问器：从新版 {url: {s, t}} 格式中安全提取分数。
    若条目缺失或格式异常，返回默认值。
    """
    entry = scores.get(url)
    if entry is None:
        return default
    if isinstance(entry, dict):
        return entry.get("s", default)
    if isinstance(entry, (int, float)):
        return int(entry)
    return default


def load_reputation_scores() -> Dict[str, dict]:
    """
    加载本地历史信誉分 JSON 文件。若缺失则优雅返回空字典。
    支持旧版 {url: int} 格式自动迁移至新版 {url: {s: int, t: float}} 格式。
    加载后自动执行容量淘汰（上限 MAX_SCORE_ENTRIES 条）。
    """
    if not os.path.exists(REPUTATION_FILE):
        os.makedirs(os.path.dirname(REPUTATION_FILE), exist_ok=True)
        return {}
    try:
        with open(REPUTATION_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        migrated = {}
        now = time.time()
        for url, value in data.items():
            if isinstance(value, dict) and "s" in value:
                migrated[url] = value
            elif isinstance(value, (int, float)):
                migrated[url] = {"s": int(value), "t": now}
        pruned = prune_reputation_scores(migrated)
        return pruned
    except Exception:
        return {}


def save_reputation_scores(scores: Dict[str, dict]):
    """
    将信誉分字典物理写入本地 JSON 文件中。
    写入前自动执行容量淘汰（上限 MAX_SCORE_ENTRIES 条），防无限增长。
    """
    scores = prune_reputation_scores(scores)
    os.makedirs(os.path.dirname(REPUTATION_FILE), exist_ok=True)
    try:
        with open(REPUTATION_FILE, "w", encoding="utf-8") as f:
            json.dump(scores, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def init_reputation_score(url: str, scores: Dict[str, dict] = None) -> int:
    """
    初始化单个播放链接的信誉积分。
    若外部传入 dict，不自动刷盘（由调用方负责）。
    """
    is_external_dict = True
    if scores is None:
        scores = load_reputation_scores()
        is_external_dict = False

    if url not in scores:
        scores[url] = {"s": DEFAULT_SCORE, "t": time.time()}
        if not is_external_dict:
            save_reputation_scores(scores)

    return get_score(scores, url)


def update_reputation_score(url: str, success: bool) -> int:
    """
    [调试专用] 单条更新信誉积分。生产环境请使用 update_reputation_scores_batch()。
    """
    scores = load_reputation_scores()
    init_reputation_score(url, scores)
    current_score = get_score(scores, url)

    if success:
        new_score = min(DEFAULT_SCORE, current_score + RECOVER_POINTS)
    else:
        new_score = max(MIN_SCORE, current_score - DECAY_POINTS)

    scores[url] = {"s": new_score, "t": time.time()}
    save_reputation_scores(scores)
    return new_score


def update_reputation_scores_batch(results: List[dict]):
    """
    【高性能优化】：批量更新信誉分。
    整个批处理过程只进行 1 次磁盘读取和 1 次磁盘写入。
    避免上百条线路并发测试完后，频繁写入磁盘导致 I/O 炸裂、硬件卡顿。
    """
    scores = load_reputation_scores()
    now = time.time()

    for res in results:
        url = res.get("url")
        if not url:
            continue
        success = res.get("success", False)

        # 确保该 URL 已经在字典中，若没有则原地初始化
        if url not in scores:
            scores[url] = {"s": DEFAULT_SCORE, "t": now}

        current_score = get_score(scores, url)
        if success:
            new_score = min(DEFAULT_SCORE, current_score + RECOVER_POINTS)
        else:
            new_score = max(MIN_SCORE, current_score - DECAY_POINTS)

        scores[url] = {"s": new_score, "t": now}

    # 一次性物理刷盘，减少磁盘写磨损
    save_reputation_scores(scores)
