import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest

from python_engine.src.quality_gate import evaluate_quality_gate
from python_engine.src.url_policy import is_special_loopback_url
from python_engine.src.writer import (
    DEFAULT_OUTPUT_PATH,
    determine_output_path,
    write_channels_json,
    write_channels_m3u,
)


def test_special_loopback_routes_are_structural_publication_routes():
    valid = "http://127.0.0.1:3000/api/bilibili/room_1"
    assert is_special_loopback_url(valid)
    assert not is_special_loopback_url("http://127.0.0.1:3000/api/unknown/room_1")
    assert not is_special_loopback_url("http://127.0.0.1:3000/api/bilibili/room_1?token=secret")

    result = evaluate_quality_gate(
        [{"name": "Bilibili", "urls": [valid]}],
        [{"url": valid, "success": False}],
        generation_time="2026-08-03T00:00:00Z",
    )
    assert result.accepted is True
    assert result.manifest["valid_route_count"] == 1
    assert result.manifest["success_rate"] == 0.0


def _channels(count: int, routes_per_channel: int = 1) -> list[dict]:
    return [
        {
            "name": f"Channel {index}",
            "urls": [f"https://stream.example/{index}/{route}.m3u8" for route in range(routes_per_channel)],
        }
        for index in range(count)
    ]


def _probes(count: int, successful: int, *, channel_count: int = 1, routes_per_channel: int = 1) -> list[dict]:
    urls = [
        f"https://stream.example/{channel}/{route}.m3u8"
        for channel in range(channel_count)
        for route in range(routes_per_channel)
    ]
    return [
        {"url": url, "success": index < successful}
        for index, url in enumerate(urls[:count])
    ]


def test_default_output_path_is_repo_relative_and_override_wins():
    assert determine_output_path() == DEFAULT_OUTPUT_PATH
    assert DEFAULT_OUTPUT_PATH.endswith(
        os.path.join("iptv-project", "data", "channels.json")
    )
    assert "E:\\vscode\\iptv-project" not in DEFAULT_OUTPUT_PATH
    assert os.path.join("iptv-engine-b", "data", "channels.json") not in DEFAULT_OUTPUT_PATH

    with patch.dict(os.environ, {"OUTPUT_PATH": "custom/channels.json"}):
        assert determine_output_path() == "custom/channels.json"


def test_json_write_is_atomic_and_keeps_previous_snapshot_on_failure(tmp_path):
    target = tmp_path / "nested" / "channels.json"
    with patch.dict(os.environ, {"OUTPUT_PATH": str(target)}):
        assert write_channels_json([{"name": "stable", "urls": ["https://stable"]}]) == str(target)
        before = target.read_text(encoding="utf-8")

        with patch("python_engine.src.writer.os.fsync", wraps=os.fsync) as fsync, patch(
            "python_engine.src.writer.os.replace", side_effect=OSError("replace failed")
        ):
            with pytest.raises(OSError, match="replace failed"):
                write_channels_json([{"name": "candidate", "urls": ["https://candidate"]}])

        assert fsync.called
        assert target.read_text(encoding="utf-8") == before
        assert list(target.parent.glob("*.tmp")) == []


def test_m3u_write_is_atomic_and_serialized_in_same_directory(tmp_path):
    target = tmp_path / "nested" / "channels.m3u"
    data = [
        {
            "name": "CCTV-1",
            "group": "央视频道",
            "tvg_id": "cctv1",
            "urls": ["https://stream.example/cctv1.m3u8"],
        },
        {"name": "multicast", "urls": ["udp://239.0.0.1"], "is_multicast": True},
    ]

    assert write_channels_m3u(data, target) == str(target)
    assert target.read_text(encoding="utf-8") == (
        '#EXTM3U\n#EXTINF:-1 tvg-id="cctv1" tvg-name="CCTV-1" '
        'group-title="央视频道",CCTV-1\nhttps://stream.example/cctv1.m3u8\n'
    )
    assert list(target.parent.glob("*.tmp")) == []


def test_quality_gate_first_run_builds_metrics_and_accepts_valid_candidate():
    result = evaluate_quality_gate(
        _channels(2, routes_per_channel=2),
        _probes(4, successful=3, channel_count=2, routes_per_channel=2),
        stable_manifest=None,
        generation_time="2026-08-01T00:00:00Z",
    )

    assert result.accepted is True
    assert result.reasons == []
    assert result.manifest == {
        "schema_version": 1,
        "generation_time": "2026-08-01T00:00:00Z",
        "generated_at": "2026-08-01T00:00:00Z",
        "channel_count": 2,
        "valid_route_count": 3,
        "probe_count": 4,
        "success_rate": 0.75,
    }


def test_quality_gate_accepts_exactly_twenty_percent_decline_and_rejects_more(tmp_path):
    stable = {
        "schema_version": 1,
        "generation_time": "2026-07-31T00:00:00Z",
        "channel_count": 10,
        "valid_route_count": 10,
        "probe_count": 10,
        "success_rate": 1.0,
    }
    stable_path = tmp_path / "stable_manifest.json"
    stable_path.write_text(json.dumps(stable), encoding="utf-8")

    accepted = evaluate_quality_gate(
        _channels(8), _probes(8, successful=8, channel_count=8), stable_manifest=stable_path
    )
    assert accepted.accepted is True
    assert accepted.reasons == []

    rejected = evaluate_quality_gate(
        _channels(7), _probes(7, successful=5, channel_count=7), stable_manifest=stable_path
    )
    assert rejected.accepted is False
    assert any("channel count" in reason for reason in rejected.reasons)
    assert any("success rate" in reason for reason in rejected.reasons)


def test_quality_gate_rejects_dead_routes_and_sensitive_url_forms(tmp_path):
    dead = evaluate_quality_gate(
        [{"name": "dead", "urls": ["https://stream.example/dead.m3u8"]}],
        [{"url": "https://stream.example/dead.m3u8", "success": False}],
    )
    assert dead.accepted is False
    assert any("at least one valid route" in reason for reason in dead.reasons)

    for url in [
        "https://user:secret@stream.example/live.m3u8",
        "https://stream.example/live.m3u8?fooTokenBar=value",
        "https://stream.example/live/token/secret.m3u8",
        "https://stream.example/live.m3u8#auth=secret",
    ]:
        result = evaluate_quality_gate(
            [{"name": "private", "urls": [url]}],
            [{"url": url, "success": True}],
        )
        assert result.accepted is False


def test_quality_gate_rejects_missing_corrupt_baselines_and_sensitive_query_keys(tmp_path):
    candidate = [{"name": "private", "urls": ["https://stream.example/live.m3u8?token=secret-value"]}]
    probes = [{"url": candidate[0]["urls"][0], "success": True}]

    missing = evaluate_quality_gate(candidate, probes, tmp_path / "missing-manifest.json")
    assert missing.accepted is False
    assert missing.reasons == [
        "candidate contains a sensitive URL parameter",
        "stable manifest is missing",
    ]

    corrupt_path = tmp_path / "corrupt-manifest.json"
    corrupt_path.write_text("not json", encoding="utf-8")
    corrupt = evaluate_quality_gate(candidate, probes, corrupt_path)
    assert corrupt.accepted is False
    assert corrupt.reasons == [
        "candidate contains a sensitive URL parameter",
        "stable manifest is corrupt",
    ]

    privacy = evaluate_quality_gate(candidate, probes)
    assert privacy.accepted is False
    assert privacy.reasons.count("candidate contains a sensitive URL parameter") == 1
    assert all("token" not in reason.lower() for reason in privacy.reasons)
    assert all("secret-value" not in reason for reason in privacy.reasons)
    assert all(candidate[0]["urls"][0] not in reason for reason in privacy.reasons)
