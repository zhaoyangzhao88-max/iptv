import json

from python_engine.src.source_config import source_id_for_url, source_urls
from python_engine.src.source_health import (
    load_source_health,
    save_source_health,
    transition_state,
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
