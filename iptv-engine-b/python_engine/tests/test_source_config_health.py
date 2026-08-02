from python_engine.src.fetcher import DEFAULT_SOURCES, fetch_all_sources
from python_engine.src.source_config import SourceConfig, authorized_urls, load_source_config
from python_engine.src.source_health import assess_source_health, healthy_urls


def test_default_config_preserves_legacy_urls():
    assert set(DEFAULT_SOURCES) == authorized_urls()


def test_config_rejects_unknown_protocol_and_filters_disabled_duplicates():
    try:
        SourceConfig(url="file:///tmp/source.m3u")
    except ValueError:
        pass
    else:
        raise AssertionError("non-HTTP source must be rejected")

    configs = load_source_config([
        {"url": "https://authorized.example/a.m3u", "enabled": True},
        {"url": "https://authorized.example/a.m3u", "enabled": True},
        {"url": "https://authorized.example/disabled.m3u", "enabled": False},
    ])
    assert [item.url for item in configs] == ["https://authorized.example/a.m3u"]


def test_health_reports_only_configured_sources():
    health = assess_source_health(
        ["https://authorized.example/a.m3u", "https://authorized.example/b.m3u"],
        {"https://authorized.example/a.m3u": "#EXTM3U", "https://unknown.example/x.m3u": "data"},
    )
    assert healthy_urls(health) == ("https://authorized.example/a.m3u",)
    assert [item.url for item in health] == [
        "https://authorized.example/a.m3u",
        "https://authorized.example/b.m3u",
    ]


def test_fetcher_accepts_legacy_strings_and_does_not_discover(monkeypatch):
    calls = []

    def fake_fetch(url, timeout=8):
        calls.append((url, timeout))
        return "#EXTM3U"

    monkeypatch.setattr("python_engine.src.fetcher.fetch_single_source", fake_fetch)
    result = fetch_all_sources(urls=["https://authorized.example/a.m3u"], max_workers=1)
    assert result == {"https://authorized.example/a.m3u": "#EXTM3U"}
    assert calls == [("https://authorized.example/a.m3u", 8)]
