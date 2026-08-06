"""Source-level health state machine, recovery selection, and atomic persistence."""
import json
import os
import tempfile
from dataclasses import dataclass
from typing import Any, Iterable, Mapping
from python_engine.src.config import DATA_DIR

SOURCE_HEALTH_FILE = os.path.join(DATA_DIR, "source_health.json")
FAILURES_TO_ISOLATE = 3
ISOLATED_FAILURES_TO_REMOVE = 2
RECOVERY_SUCCESS_THRESHOLD = 2
HEALTH_SCHEMA_VERSION = 2

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
    return {
        "status": "candidate",
        "consecutive_failures": 0,
        "isolated_failures": 0,
        "total_streams": 0,
        "healthy_streams": 0,
        "consecutive_recovery_successes": 0,
        "last_recovery_attempt": None,
    }


def _migrate_entry(value: Any) -> dict[str, Any]:
    entry = _default_state()
    if isinstance(value, Mapping):
        entry.update(dict(value))
    return entry


def _migrate_health(data: Mapping[str, Any]) -> dict[str, Any]:
    migrated: dict[str, Any] = {}
    for key, value in data.items():
        if key == "_meta":
            continue
        migrated[str(key)] = _migrate_entry(value)
    meta = data.get("_meta")
    meta = dict(meta) if isinstance(meta, Mapping) else {}
    cursor = meta.get("recovery_cursor")
    migrated["_meta"] = {
        **meta,
        "schema_version": HEALTH_SCHEMA_VERSION,
        "recovery_cursor": cursor if isinstance(cursor, str) else None,
    }
    return migrated


def transition_state(state: Mapping[str, Any] | None, success: bool, *, healthy_streams: int | None = None, total_streams: int | None = None) -> dict[str, Any]:
    current = _migrate_entry(state)
    status = current.get("status", "candidate")
    if total_streams is not None:
        current["total_streams"] = int(total_streams)
    if healthy_streams is not None:
        current["healthy_streams"] = int(healthy_streams)
    effective_success = bool(success and (healthy_streams is None or healthy_streams > 0))
    if effective_success:
        current.update({"status": "healthy", "consecutive_failures": 0, "isolated_failures": 0})
        return current
    if status == "removed":
        return current
    if status == "isolated":
        current["isolated_failures"] = int(current.get("isolated_failures", 0)) + 1
        if current["isolated_failures"] >= ISOLATED_FAILURES_TO_REMOVE:
            current["status"] = "removed"
        return current
    current["consecutive_failures"] = int(current.get("consecutive_failures", 0)) + 1
    if status == "candidate":
        return current
    if current["consecutive_failures"] >= FAILURES_TO_ISOLATE:
        current["status"] = "isolated"
        current["isolated_failures"] = 0
    return current


def select_recovery_source(source_ids: Iterable[str], health: Mapping[str, Any]) -> str | None:
    """Select one removed source after the persisted cursor, in stable config order."""
    ordered = [str(source_id) for source_id in source_ids]
    removed = [source_id for source_id in ordered if isinstance(health.get(source_id), Mapping) and health[source_id].get("status") == "removed"]
    if not removed:
        return None
    meta = health.get("_meta") if isinstance(health.get("_meta"), Mapping) else {}
    cursor = meta.get("recovery_cursor")
    if cursor in removed:
        return removed[(removed.index(cursor) + 1) % len(removed)]
    return removed[0]


def mark_recovery_attempt(health: dict[str, Any], source_id: str, *, timestamp: Any = None) -> None:
    meta = health.setdefault("_meta", {"schema_version": HEALTH_SCHEMA_VERSION, "recovery_cursor": None})
    if not isinstance(meta, dict):
        meta = {"schema_version": HEALTH_SCHEMA_VERSION, "recovery_cursor": None}
        health["_meta"] = meta
    meta["schema_version"] = HEALTH_SCHEMA_VERSION
    meta["recovery_cursor"] = source_id
    entry = health.setdefault(source_id, _default_state())
    entry["last_recovery_attempt"] = timestamp


def finalize_recovery(state: Mapping[str, Any] | None, success: bool, *, healthy_streams: int = 0, total_streams: int = 0) -> dict[str, Any]:
    """Apply the two-consecutive-success recovery policy to a removed source."""
    current = _migrate_entry(state)
    current.update({"status": "removed", "healthy_streams": int(healthy_streams), "total_streams": int(total_streams)})
    if not success or healthy_streams <= 0:
        current["consecutive_recovery_successes"] = 0
        return current
    successes = int(current.get("consecutive_recovery_successes", 0)) + 1
    current["consecutive_recovery_successes"] = successes
    if successes >= RECOVERY_SUCCESS_THRESHOLD:
        current.update({"status": "healthy", "consecutive_failures": 0, "isolated_failures": 0, "consecutive_recovery_successes": 0})
    return current


def update_source_health_batch(source_sync: Mapping[str, bool], url_to_sources: Mapping[str, Iterable[str] | str], probe_results: Iterable[Mapping[str, Any]], path: str = SOURCE_HEALTH_FILE) -> dict[str, Any]:
    stats = compute_source_stats(url_to_sources, probe_results)
    health = load_source_health(path)
    for source_id, sync_ok in source_sync.items():
        entry = stats.get(source_id, {})
        existing = health.get(source_id)
        if isinstance(existing, Mapping) and existing.get("status") == "removed":
            continue
        health[source_id] = transition_state(existing, sync_ok, healthy_streams=entry.get("healthy_streams", 0), total_streams=entry.get("total_streams", 0))
    save_source_health(health, path)
    return health


def load_source_health(path: str = SOURCE_HEALTH_FILE) -> dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return _migrate_health(data) if isinstance(data, Mapping) else {"_meta": {"schema_version": HEALTH_SCHEMA_VERSION, "recovery_cursor": None}}
    except (OSError, ValueError, TypeError):
        return {}


def save_source_health(health: dict[str, Any], path: str = SOURCE_HEALTH_FILE) -> None:
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    normalized = _migrate_health(health)
    fd, temporary = tempfile.mkstemp(prefix=".source_health.", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(normalized, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def update_source_health(source_id: str, success: bool, path: str = SOURCE_HEALTH_FILE) -> dict[str, Any]:
    health = load_source_health(path)
    next_state = transition_state(health.get(source_id), success)
    health[source_id] = next_state
    save_source_health(health, path)
    return next_state

load = load_source_health
save = save_source_health
transition = transition_state
