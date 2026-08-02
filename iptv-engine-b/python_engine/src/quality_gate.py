"""Deterministic quality checks for candidate channel publications.

The gate intentionally has no I/O side effects.  Callers provide the candidate
channels, probe results, and (when available) the previous stable manifest.  A
manifest path is accepted as a convenience for callers that keep the manifest
on disk; a missing or malformed path is a failed baseline, not a first run.
"""

from __future__ import annotations

import json
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence
from urllib.parse import parse_qsl, urlsplit

SCHEMA_VERSION = 1
MAX_RELATIVE_DECLINE = 0.20
MIN_CHANNEL_COUNT = 1
MIN_VALID_ROUTE_COUNT = 1

_SENSITIVE_KEY_NAMES = frozenset(
    {
        "accountinfo",
        "apikey",
        "auth",
        "authorization",
        "cookie",
        "credential",
        "credentials",
        "password",
        "passwd",
        "secret",
        "sessionid",
        "sessiontoken",
        "sig",
        "signature",
        "token",
        "txsecret",
        "accesstoken",
        "refreshtoken",
    }
)
_SENSITIVE_KEY_PARTS = frozenset(
    {
        "account",
        "apikey",
        "auth",
        "authorization",
        "cookie",
        "credential",
        "credentials",
        "password",
        "passwd",
        "secret",
        "session",
        "sig",
        "signature",
        "token",
    }
)


class QualityGateResult(dict):
    """Mapping result with attribute access for small callers and tests."""

    def __init__(self, accepted: bool, reasons: list[str], manifest: dict[str, Any]):
        super().__init__(accepted=accepted, reasons=reasons, manifest=manifest)

    @property
    def accepted(self) -> bool:
        return self["accepted"]

    @property
    def accept(self) -> bool:
        """Short compatibility alias for callers using ``result.accept``."""
        return self["accepted"]

    @property
    def reasons(self) -> list[str]:
        return self["reasons"]

    @property
    def manifest(self) -> dict[str, Any]:
        return self["manifest"]


def _generation_time(value: Any = None) -> str:
    if value is None:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
            "+00:00", "Z"
        )
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat().replace("+00:00", "Z")
    return str(value)


def _route_value(route: Any) -> str | None:
    if isinstance(route, str):
        value = route.strip()
    elif isinstance(route, Mapping):
        value = route.get("url")
        if not isinstance(value, str):
            return None
        value = value.strip()
    else:
        return None
    if not value or any(character.isspace() for character in value):
        return None
    return value


def _channel_routes(channel: Mapping[str, Any]) -> tuple[list[Any], bool]:
    """Return routes and whether the route container has the expected shape."""
    route_key = "urls" if "urls" in channel else "routes"
    if route_key not in channel:
        return [], True
    routes = channel[route_key]
    if isinstance(routes, (str, bytes)) or not isinstance(routes, Sequence):
        return [], False
    return list(routes), True


def _probe_success(probe: Mapping[str, Any]) -> bool | None:
    """Return a conservative probe result, rejecting contradictory evidence."""
    success = probe.get("success")
    status = probe.get("status")
    ok = probe.get("ok")
    status_success = None
    if isinstance(status, int) and not isinstance(status, bool):
        status_success = 200 <= status < 400
    if isinstance(success, bool):
        if status_success is not None:
            return success and status_success
        return success
    if status_success is not None:
        return status_success
    if isinstance(ok, bool):
        return ok
    return None


def _candidate_metrics(
    candidate_data: Any, probe_results: Any
) -> tuple[dict[str, Any], list[str], list[Any], list[Any]]:
    reasons: list[str] = []
    if not isinstance(candidate_data, Sequence) or isinstance(
        candidate_data, (str, bytes, bytearray)
    ):
        channels: list[Any] = []
        reasons.append("candidate_data must be a list of channel objects")
    else:
        channels = list(candidate_data)

    candidate_urls: set[str] = set()
    for channel in channels:
        if not isinstance(channel, Mapping):
            reasons.append("candidate_data contains a non-object channel")
            continue
        name = channel.get("name")
        if not isinstance(name, str) or not name.strip():
            reasons.append("candidate_data contains a channel without a valid name")
        routes, valid_shape = _channel_routes(channel)
        if not valid_shape:
            reasons.append("candidate_data contains a channel with invalid routes")
            continue
        for route in routes:
            route_value = _route_value(route)
            if route_value is not None:
                candidate_urls.add(route_value)

    if not isinstance(probe_results, Sequence) or isinstance(
        probe_results, (str, bytes, bytearray)
    ):
        probes: list[Any] = []
        reasons.append("probe_results must be a list of probe objects")
    else:
        probes = list(probe_results)

    successful_urls: set[str] = set()
    successful_probe_count = 0
    valid_probe_count = 0
    for probe in probes:
        if not isinstance(probe, Mapping):
            reasons.append("probe_results contains a non-object result")
            continue
        probe_url = _route_value(probe.get("url"))
        if probe_url is None:
            reasons.append("probe_results contains a result without a valid URL")
            continue
        if probe_url not in candidate_urls:
            reasons.append("probe_results contains a URL not present in candidate routes")
            continue
        success = _probe_success(probe)
        if success is None:
            reasons.append("probe_results contains a result without a valid status")
            continue
        valid_probe_count += 1
        successful_probe_count += int(success)
        if success:
            successful_urls.add(probe_url)

    probe_count = len(probes)
    success_rate = successful_probe_count / valid_probe_count if valid_probe_count else 0.0
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "generation_time": _generation_time(),
        # ``generated_at`` keeps the manifest easy to consume by older tools;
        # both values are deliberately identical and contain no URL data.
        "generated_at": None,
        "channel_count": len(channels),
        "valid_route_count": len(successful_urls),
        "probe_count": probe_count,
        "success_rate": success_rate,
    }
    manifest["generated_at"] = manifest["generation_time"]
    return manifest, reasons, channels, probes


def build_manifest(
    candidate_data: Any,
    probe_results: Any,
    generation_time: Any = None,
    *,
    generated_at: Any = None,
) -> dict[str, Any]:
    """Build the stable metrics manifest for a candidate publication.

    ``generation_time`` is injectable so tests and reproducible jobs can avoid
    depending on the wall clock.  ``generated_at`` is accepted as an alias.
    """
    manifest, _, _, _ = _candidate_metrics(candidate_data, probe_results)
    chosen_time = generation_time if generation_time is not None else generated_at
    if chosen_time is not None:
        manifest["generation_time"] = _generation_time(chosen_time)
        manifest["generated_at"] = manifest["generation_time"]
    return manifest


def _normalise_key(key: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(key).lower())


def _is_sensitive_key(key: Any) -> bool:
    normalised = _normalise_key(key)
    if not normalised:
        return False
    if normalised in _SENSITIVE_KEY_NAMES:
        return True
    parts = [part for part in re.split(r"[^a-z0-9]+", str(key).lower()) if part]
    return any(part in _SENSITIVE_KEY_PARTS for part in parts) or any(
        normalised.startswith(part) or normalised.endswith(part)
        for part in _SENSITIVE_KEY_PARTS
        if len(part) >= 4
    )


def _sensitive_keys(value: Any, found: set[str]) -> None:
    if isinstance(value, Mapping):
        for key, nested in value.items():
            if _is_sensitive_key(key):
                found.add(str(key).lower())
            _sensitive_keys(nested, found)
        return
    if isinstance(value, (list, tuple, set)):
        for nested in value:
            _sensitive_keys(nested, found)
        return
    if not isinstance(value, str):
        return

    try:
        parsed = urlsplit(value)
    except ValueError:
        parsed = None
    if parsed is None:
        return

    if parsed.username or parsed.password:
        found.add('userinfo')

    components = [parsed.path, parsed.fragment]
    for key, _ in parse_qsl(parsed.query, keep_blank_values=True):
        if _is_sensitive_key(key):
            found.add(str(key).lower())
        else:
            components.append(key)
    for component in components:
        decoded = str(component).lower()
        if any(part in _SENSITIVE_KEY_PARTS for part in re.findall(r'[a-z0-9]+', decoded)):
            found.add('url-sensitive-component')
        compact = _normalise_key(decoded)
        if any(part in compact for part in _SENSITIVE_KEY_PARTS if len(part) >= 4):
            found.add('url-sensitive-component')


def _baseline_from_input(stable_manifest: Any) -> tuple[Mapping[str, Any] | None, str | None]:
    if stable_manifest is None:
        return None, None

    if isinstance(stable_manifest, (str, os.PathLike)):
        path = Path(stable_manifest)
        if not path.exists():
            return None, "stable manifest is missing"
        try:
            with path.open("r", encoding="utf-8") as stream:
                stable_manifest = json.load(stream)
        except (OSError, ValueError, TypeError):
            return None, "stable manifest is corrupt"

    if not isinstance(stable_manifest, Mapping) or not stable_manifest:
        return None, "stable manifest is corrupt"
    return stable_manifest, None


def _number(value: Any, *, integer: bool = False) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(float(value)):
        return None
    if integer:
        if int(value) != value or value < 0:
            return None
        return int(value)
    return float(value)


def _validated_baseline(stable_manifest: Mapping[str, Any]) -> tuple[dict[str, float], str | None]:
    schema_version = stable_manifest.get("schema_version")
    if schema_version != SCHEMA_VERSION:
        return {}, "stable manifest is corrupt"

    metrics: dict[str, float] = {}
    for key in ("channel_count", "valid_route_count", "probe_count"):
        value = _number(stable_manifest.get(key), integer=True)
        if value is None:
            return {}, "stable manifest is corrupt"
        metrics[key] = float(value)

    success_rate = _number(stable_manifest.get("success_rate"))
    if success_rate is None or not 0 <= success_rate <= 1:
        return {}, "stable manifest is corrupt"
    metrics["success_rate"] = success_rate

    generation_time = stable_manifest.get("generation_time", stable_manifest.get("generated_at"))
    if not isinstance(generation_time, str) or not generation_time.strip():
        return {}, "stable manifest is corrupt"
    return metrics, None


def _relative_decline(candidate: float, baseline: float) -> bool:
    if baseline <= 0:
        return False
    return candidate < baseline * (1 - MAX_RELATIVE_DECLINE) - 1e-12


def evaluate_quality_gate(
    candidate_data: Any,
    probe_results: Any,
    stable_manifest: Any = None,
    *,
    generation_time: Any = None,
    generated_at: Any = None,
) -> QualityGateResult:
    """Evaluate a candidate against minimums, privacy, and a stable baseline."""
    manifest, reasons, _, _ = _candidate_metrics(candidate_data, probe_results)
    chosen_time = generation_time if generation_time is not None else generated_at
    if chosen_time is not None:
        manifest["generation_time"] = _generation_time(chosen_time)
        manifest["generated_at"] = manifest["generation_time"]

    if manifest["channel_count"] < MIN_CHANNEL_COUNT:
        reasons.append("candidate must contain at least one channel")
    if manifest["valid_route_count"] < MIN_VALID_ROUTE_COUNT:
        reasons.append("candidate must contain at least one valid route")

    sensitive_keys: set[str] = set()
    _sensitive_keys(candidate_data, sensitive_keys)
    _sensitive_keys(probe_results, sensitive_keys)
    for key in sorted(sensitive_keys):
        reasons.append(f"sensitive key '{key}' is not allowed")

    baseline, baseline_error = _baseline_from_input(stable_manifest)
    if baseline_error is not None:
        reasons.append(baseline_error)
    elif baseline is not None:
        baseline_metrics, validation_error = _validated_baseline(baseline)
        if validation_error is not None:
            reasons.append(validation_error)
        else:
            comparisons = (
                ("channel_count", "channel count"),
                ("valid_route_count", "valid route count"),
                ("success_rate", "success rate"),
            )
            for metric_key, label in comparisons:
                candidate_value = float(manifest[metric_key])
                if _relative_decline(candidate_value, baseline_metrics[metric_key]):
                    reasons.append(f"{label} declined by more than 20% versus stable baseline")

    # Preserve deterministic ordering if a malformed candidate generated the
    # same structural reason more than once across repeated invocations.
    deduplicated_reasons = list(dict.fromkeys(reasons))
    return QualityGateResult(
        accepted=not deduplicated_reasons,
        reasons=deduplicated_reasons,
        manifest=manifest,
    )


# Descriptive aliases keep the public API discoverable without duplicating logic.
run_quality_gate = evaluate_quality_gate
check_quality_gate = evaluate_quality_gate
quality_gate = evaluate_quality_gate

__all__ = [
    "MAX_RELATIVE_DECLINE",
    "MIN_CHANNEL_COUNT",
    "MIN_VALID_ROUTE_COUNT",
    "SCHEMA_VERSION",
    "QualityGateResult",
    "build_manifest",
    "check_quality_gate",
    "evaluate_quality_gate",
    "quality_gate",
    "run_quality_gate",
]
