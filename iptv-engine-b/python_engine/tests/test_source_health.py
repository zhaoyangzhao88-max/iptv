import json

from python_engine.src.source_config import source_id_for_url, source_urls
from python_engine.src.source_health import (
    load_source_health,
    save_source_health,
    transition_state,
    select_recovery_source,
    finalize_recovery,
)


def test_source_failure_transitions_and_recovery():
    state = {"status": "healthy", "consecutive_failures": 0, "isolated_failures": 0}
    state = transition_state(state, False)
    assert state["status"] == "healthy"
    state = transition_state(state, False)
    state = transition_state(state, False)
    assert state["status"] == "isolated"
    state = transition_state(state, False)
    assert state["status"] == "isolated"
    state = transition_state(state, False)
    assert state["status"] == "removed"
    assert transition_state(state, True)["status"] == "healthy"


def test_removed_source_recovery_requires_two_consecutive_successes():
    state = {"status": "removed", "consecutive_recovery_successes": 0}
    state = finalize_recovery(state, True, healthy_streams=1, total_streams=1)
    assert state["status"] == "removed"
    assert state["consecutive_recovery_successes"] == 1
    state = finalize_recovery(state, True, healthy_streams=1, total_streams=1)
    assert state["status"] == "healthy"
    assert state["consecutive_recovery_successes"] == 0


def test_recovery_failure_resets_success_counter():
    state = finalize_recovery({"status": "removed", "consecutive_recovery_successes": 1}, False, healthy_streams=0)
    assert state["status"] == "removed"
    assert state["consecutive_recovery_successes"] == 0


def test_recovery_selection_rotates_after_cursor():
    health = {
        "source_1": {"status": "removed"},
        "source_2": {"status": "removed"},
        "source_3": {"status": "healthy"},
        "_meta": {"recovery_cursor": "source_1"},
    }
    assert select_recovery_source(["source_1", "source_2", "source_3"], health) == "source_2"


def test_load_migrates_legacy_entry_and_metadata(tmp_path):
    path = tmp_path / "source_health.json"
    path.write_text(json.dumps({"source_1": {"status": "removed", "custom": "keep"}}), encoding="utf-8")
    health = load_source_health(str(path))
    assert health["source_1"]["custom"] == "keep"
    assert health["source_1"]["consecutive_recovery_successes"] == 0
    assert health["_meta"]["schema_version"] == 2


def test_corrupt_file_loads_empty_and_save_is_atomic(tmp_path):
    path = tmp_path / "source_health.json"
    path.write_text("{not-json", encoding="utf-8")
    assert load_source_health(str(path)) == {}
    save_source_health({"source_1": {"status": "healthy"}}, str(path))
    assert json.loads(path.read_text(encoding="utf-8"))["source_1"]["status"] == "healthy"
    assert not list(tmp_path.glob(".source_health.*.tmp"))


def test_config_source_mapping_is_stable():
    urls = source_urls()
    assert urls
    assert source_id_for_url(urls[0]) == "source_1"
    assert source_id_for_url("https://example.invalid/test") == "https://example.invalid/test"
