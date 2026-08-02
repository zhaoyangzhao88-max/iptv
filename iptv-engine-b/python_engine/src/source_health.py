"""Source-level health state machine and atomic local persistence."""
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

def _default_state() -> dict[str, Any]:
    return {"status": "healthy", "consecutive_failures": 0, "isolated_failures": 0}

def transition_state(state: Mapping[str, Any] | None, success: bool) -> dict[str, Any]:
    current = _default_state(); current.update(dict(state or {})); status = current.get("status", "healthy")
    if success: return _default_state()
    if status == "removed": return current
    if status == "isolated":
        current["isolated_failures"] = int(current.get("isolated_failures", 0)) + 1
        if current["isolated_failures"] >= ISOLATED_FAILURES_TO_REMOVE: current["status"] = "removed"
        return current
    current["consecutive_failures"] = int(current.get("consecutive_failures", 0)) + 1
    if current["consecutive_failures"] >= FAILURES_TO_ISOLATE:
        current["status"] = "isolated"; current["isolated_failures"] = 0
    return current

def load_source_health(path: str = SOURCE_HEALTH_FILE) -> dict[str, dict[str, Any]]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError, TypeError):
        return {}

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
    health = load_source_health(path)
    next_state = transition_state(health.get(source_id), success); health[source_id] = next_state
    save_source_health(health, path); return next_state
