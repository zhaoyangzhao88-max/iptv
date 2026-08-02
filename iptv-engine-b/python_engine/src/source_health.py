"""Source-level health state machine, statistics, and atomic persistence."""
import json
import os
import tempfile
from dataclasses import dataclass
from typing import Any, Iterable, Mapping
from python_engine.src.config import DATA_DIR

SOURCE_HEALTH_FILE = os.path.join(DATA_DIR, "source_health.json")
FAILURES_TO_ISOLATE = 3
ISOLATED_FAILURES_TO_REMOVE = 2

@dataclass(frozen=True)
class SourceHealth:
    url: str
    success: bool
    status_code: int | None = None
    error: str | None = None

def assess_source_health(configured_urls: Iterable[str], results: Mapping[str, str]) -> tuple[SourceHealth, ...]:
    return tuple(SourceHealth(url=url, success=bool(results.get(url)), error=None if results.get(url) else "empty or unavailable response") for url in configured_urls)

def healthy_urls(health: Iterable[SourceHealth]) -> tuple[str, ...]:
    return tuple(item.url for item in health if item.success)

def compute_source_stats(url_to_sources: Mapping[str, Iterable[str] | str], probe_results: Iterable[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    """Count distinct probe candidates and successful probes per source."""
    stats: dict[str, dict[str, Any]] = {}
    success_by_url = {str(item.get("url")): bool(item.get("success") is True) for item in probe_results if item.get("url")}
    for url, sources in url_to_sources.items():
        source_ids = [sources] if isinstance(sources, str) else list(sources)
        for source_id in source_ids:
            entry = stats.setdefault(source_id, {"total_streams": 0, "healthy_streams": 0, "success_urls": []})
            entry["total_streams"] += 1
            if success_by_url.get(url, False):
                entry["healthy_streams"] += 1
                entry["success_urls"].append(url)
    return stats

def _default_state() -> dict[str, Any]:
    return {"status": "candidate", "consecutive_failures": 0, "isolated_failures": 0, "total_streams": 0, "healthy_streams": 0}

def transition_state(state: Mapping[str, Any] | None, success: bool, *, healthy_streams: int | None = None, total_streams: int | None = None) -> dict[str, Any]:
    current = _default_state(); current.update(dict(state or {})); status = current.get("status", "candidate")
    if total_streams is not None: current["total_streams"] = int(total_streams)
    if healthy_streams is not None: current["healthy_streams"] = int(healthy_streams)
    effective_success = bool(success and (healthy_streams is None or healthy_streams > 0))
    if effective_success:
        current.update({"status": "healthy", "consecutive_failures": 0, "isolated_failures": 0}); return current
    if status == "removed": return current
    if status == "isolated":
        current["isolated_failures"] = int(current.get("isolated_failures", 0)) + 1
        if current["isolated_failures"] >= ISOLATED_FAILURES_TO_REMOVE: current["status"] = "removed"
        return current
    current["consecutive_failures"] = int(current.get("consecutive_failures", 0)) + 1
    if status == "candidate": return current
    if current["consecutive_failures"] >= FAILURES_TO_ISOLATE:
        current["status"] = "isolated"; current["isolated_failures"] = 0
    return current

def update_source_health_batch(source_sync: Mapping[str, bool], url_to_sources: Mapping[str, Iterable[str] | str], probe_results: Iterable[Mapping[str, Any]], path: str = SOURCE_HEALTH_FILE) -> dict[str, dict[str, Any]]:
    stats = compute_source_stats(url_to_sources, probe_results)
    health = load_source_health(path)
    for source_id, sync_ok in source_sync.items():
        entry = stats.get(source_id, {})
        health[source_id] = transition_state(health.get(source_id), sync_ok, healthy_streams=entry.get("healthy_streams", 0), total_streams=entry.get("total_streams", 0))
    save_source_health(health, path)
    return health

def load_source_health(path: str = SOURCE_HEALTH_FILE) -> dict[str, dict[str, Any]]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError, TypeError): return {}

def save_source_health(health: dict[str, dict[str, Any]], path: str = SOURCE_HEALTH_FILE) -> None:
    directory = os.path.dirname(path) or "."; os.makedirs(directory, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".source_health.", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(health, handle, ensure_ascii=False, indent=2); handle.flush(); os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)

def update_source_health(source_id: str, success: bool, path: str = SOURCE_HEALTH_FILE) -> dict[str, Any]:
    health = load_source_health(path); next_state = transition_state(health.get(source_id), success); health[source_id] = next_state; save_source_health(health, path); return next_state

load = load_source_health
save = save_source_health
transition = transition_state
