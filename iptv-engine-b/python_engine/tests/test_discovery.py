import json

from python_engine.src import discovery


M3U = "#EXTM3U\n#EXTINF:-1,News\nhttps://stream.example/live.m3u8\n"


def test_collect_candidates_deduplicates_and_limits_domains():
    results = [
        {"url": "https://a.example/one.m3u", "title": "one"},
        {"url": "https://a.example/one.m3u#fragment", "title": "duplicate"},
        {"url": "https://a.example/two.m3u", "title": "two"},
        {"url": "https://a.example/three.m3u", "title": "three"},
        {"url": "https://b.example/four.m3u", "title": "four"},
    ]
    candidates = discovery.collect_candidates(results, max_results=3, max_per_domain=2)
    assert [item["url"] for item in candidates] == [
        "https://a.example/one.m3u",
        "https://a.example/two.m3u",
        "https://b.example/four.m3u",
    ]


def test_discover_from_json_separates_candidates_and_accepts_safe_m3u(tmp_path, monkeypatch):
    provider = tmp_path / "results.json"
    provider.write_text(json.dumps({"web": {"results": [
        {"url": "https://public.example/list.m3u", "title": "Public list", "page_url": "https://public.example/page"},
        {"url": "http://127.0.0.1/private.m3u", "title": "Private"},
        {"url": "https://public.example/not-playlist.txt", "title": "Bad content"},
    ]}}, ensure_ascii=False), encoding="utf-8")
    candidates_path = tmp_path / "candidates.json"
    accepted_path = tmp_path / "accepted.json"

    class Response:
        status_code = 200
        text = M3U

    def fake_get(url, timeout=8):
        if url.endswith("not-playlist.txt"):
            return type("Response", (), {"status_code": 200, "text": "not m3u"})()
        return Response()

    monkeypatch.setattr(discovery, "smart_request_get", fake_get)
    monkeypatch.setattr(discovery, "is_safe_fetch_url", lambda url: "127.0.0.1" not in url)
    records = discovery.discover_from_json(
        provider, query="m3u", candidates_path=candidates_path, accepted_path=accepted_path,
    )
    assert len(records) == 3
    assert sum(item["audit_status"] == "accepted" for item in records) == 1
    accepted = json.loads(accepted_path.read_text(encoding="utf-8"))
    assert len(accepted) == 1
    assert accepted[0]["trust_tier"] == "discovered-low"
    assert accepted[0]["source_page"] == "https://public.example/page"
    rejected = [item for item in records if item["audit_status"] != "accepted"]
    assert all(item["enabled"] is False for item in rejected)


def test_validate_candidate_does_not_log_sensitive_url(monkeypatch):
    record = {"url": "https://public.example/list.m3u?token=secret", "title": "x"}
    result = discovery.validate_candidate(record)
    assert result["audit_status"] == "rejected"
    assert "secret" not in json.dumps(result)


def test_sensitive_candidate_is_redacted_before_persistence(tmp_path, monkeypatch):
    provider = tmp_path / "results.json"
    provider.write_text(json.dumps({"results": [
        {"url": "https://public.example/list.m3u?token=secret#fragment", "page_url": "https://public.example/page?api_key=page-secret"},
    ]}), encoding="utf-8")
    candidates_path = tmp_path / "candidates.json"
    accepted_path = tmp_path / "accepted.json"
    monkeypatch.setattr(discovery, "is_safe_fetch_url", lambda url: True)
    records = discovery.discover_from_json(provider, candidates_path=candidates_path, accepted_path=accepted_path)
    serialized = candidates_path.read_text(encoding="utf-8") + accepted_path.read_text(encoding="utf-8")
    assert records[0]["audit_status"] == "rejected"
    assert "secret" not in serialized
    assert "page-secret" not in serialized
    assert "token=" not in serialized


def test_validation_failure_reason_is_generic(monkeypatch):
    class Response:
        status_code = 200
        text = M3U

    monkeypatch.setattr(discovery, "is_safe_fetch_url", lambda url: True)
    monkeypatch.setattr(discovery, "smart_request_get", lambda *args, **kwargs: (_ for _ in ()).throw(
        RuntimeError("provider leaked https://public.example/list.m3u?token=secret")))
    result = discovery.validate_candidate({"url": "https://public.example/list.m3u"})
    assert result["failure_reason"] == "candidate validation failed"
    serialized = json.dumps(result)
    assert "provider leaked" not in serialized
    assert "token=secret" not in serialized
    assert "secret" not in serialized


def test_source_config_rejects_hand_authored_unsafe_accepted_record(tmp_path):
    from python_engine.src.source_config import _load_discovered_sources

    path = tmp_path / "discovered.json"
    path.write_text(json.dumps([
        {"url": "http://127.0.0.1/admin.m3u", "audit_status": "accepted", "enabled": True, "trust_tier": "discovered-low"},
        {"url": "https://public.example/list.m3u", "audit_status": "accepted", "enabled": True, "trust_tier": "candidate"},
    ]), encoding="utf-8")
    assert _load_discovered_sources(path) == ()
