"""Bounded local-input discovery and source registration workflow."""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from python_engine.src.parser import parse_m3u_content
from python_engine.src.request_client import smart_request_get
from python_engine.src.url_policy import contains_sensitive_url, is_safe_fetch_url, sanitize_url
from python_engine.src.writer import publish_text_files

MAX_RESULTS = 100
MAX_PER_DOMAIN = 10
DEFAULT_TIMEOUT = 8
MAX_SOURCE_BYTES = 4 * 1024 * 1024

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
CANDIDATES_PATH = DATA_DIR / "discovery_candidates.json"
ACCEPTED_PATH = DATA_DIR / "discovered_sources.json"


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_url(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = urlsplit(value.strip())
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
            return None
        hostname = parsed.hostname.lower().rstrip(".")
        netloc = hostname
        if parsed.port:
            netloc = f"{hostname}:{parsed.port}"
        return urlunsplit((parsed.scheme.lower(), netloc, parsed.path or "/", parsed.query, ""))
    except ValueError:
        return None


def load_provider_results(path: str | os.PathLike[str]) -> list[dict]:
    with open(path, encoding="utf-8") as stream:
        payload = json.load(stream)
    if isinstance(payload, list):
        results = payload
    elif isinstance(payload, dict):
        results = payload.get("results")
        if results is None and isinstance(payload.get("web"), dict):
            results = payload["web"].get("results")
    else:
        results = None
    if not isinstance(results, list):
        raise ValueError("discovery input must contain a results array")
    return [item for item in results if isinstance(item, dict)]


def _candidate_from_result(result: dict, query: str) -> dict | None:
    url = normalize_url(result.get("url"))
    if not url:
        return None
    page_url = normalize_url(result.get("page_url") or result.get("source_page"))
    profile = result.get("profile") if isinstance(result.get("profile"), dict) else {}
    return {
        "url": url,
        "source_page": sanitize_url(page_url) if page_url else None,
        "title": str(result.get("title", ""))[:500],
        "description": str(result.get("description", ""))[:1000],
        "discovery_provider": str(result.get("provider", "local-json")),
        "search_query": query[:500],
        "source_domain": str(profile.get("long_name", ""))[:255],
        "discovered_at": _now(),
    }


def collect_candidates(results: list[dict], *, query: str = "", max_results: int = MAX_RESULTS,
                       max_per_domain: int = MAX_PER_DOMAIN) -> list[dict]:
    if max_results <= 0 or max_per_domain <= 0:
        return []
    candidates: list[dict] = []
    seen: set[str] = set()
    domains: Counter[str] = Counter()
    for result in results:
        candidate = _candidate_from_result(result, query)
        if not candidate or candidate["url"] in seen:
            continue
        domain = urlsplit(candidate["url"]).hostname or ""
        if domains[domain] >= max_per_domain:
            continue
        seen.add(candidate["url"])
        domains[domain] += 1
        candidates.append(candidate)
        if len(candidates) >= max_results:
            break
    return candidates


def _response_text(response: object) -> str:
    text = getattr(response, "text", "")
    if not isinstance(text, str):
        content = getattr(response, "content", b"")
        text = content.decode("utf-8", errors="replace") if isinstance(content, bytes) else str(content)
    if len(text.encode("utf-8", errors="replace")) > MAX_SOURCE_BYTES:
        raise ValueError("source response exceeds maximum size")
    return text


def validate_candidate(candidate: dict, *, timeout: int = DEFAULT_TIMEOUT) -> dict:
    url = candidate.get("url")
    result = dict(candidate)
    result.update({
        "checked_at": _now(),
        "audit_status": "rejected",
        "security_status": "failed",
        "content_status": "failed",
        "quality_status": "failed",
        "trust_tier": "candidate",
        "enabled": False,
        "failure_reason": None,
    })
    normalized = normalize_url(url)
    if not normalized or contains_sensitive_url(normalized) or not is_safe_fetch_url(normalized):
        result["failure_reason"] = "candidate URL failed safety policy"
        result["url"] = sanitize_url(url)
        return result
    result["url"] = normalized
    result["security_status"] = "passed"
    try:
        response = smart_request_get(normalized, timeout=timeout)
        if getattr(response, "status_code", None) != 200:
            raise ValueError("source request returned a non-success status")
        content = _response_text(response)
        if not content.lstrip().startswith("#EXTM3U"):
            raise ValueError("source content is not an M3U playlist")
        streams = parse_m3u_content(content, source_id="discovered")
        if not streams:
            raise ValueError("source playlist contains no usable entries")
    except Exception:
        result["failure_reason"] = "candidate validation failed"
        return result
    result.update({
        "audit_status": "accepted",
        "content_status": "passed",
        "quality_status": "passed",
        "trust_tier": "discovered-low",
        "enabled": True,
    })
    return result


def _read_records(path: str | os.PathLike[str]) -> list[dict]:
    try:
        with open(path, encoding="utf-8") as stream:
            value = json.load(stream)
        return value if isinstance(value, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def persist_discovery(candidates: list[dict], *, candidates_path=CANDIDATES_PATH,
                      accepted_path=ACCEPTED_PATH) -> None:
    accepted = [item for item in candidates if item.get("audit_status") == "accepted" and item.get("enabled")]
    existing = {item.get("url"): item for item in _read_records(accepted_path)}
    for item in accepted:
        existing[item["url"]] = item
    files = {
        os.fspath(candidates_path): json.dumps(candidates, ensure_ascii=False, indent=2),
        os.fspath(accepted_path): json.dumps(list(existing.values()), ensure_ascii=False, indent=2),
    }
    publish_text_files(files)


def discover_from_json(path: str | os.PathLike[str], *, query: str = "", max_results: int = MAX_RESULTS,
                       max_per_domain: int = MAX_PER_DOMAIN, timeout: int = DEFAULT_TIMEOUT,
                       candidates_path=CANDIDATES_PATH, accepted_path=ACCEPTED_PATH) -> list[dict]:
    raw = load_provider_results(path)
    candidates = collect_candidates(raw, query=query, max_results=max_results, max_per_domain=max_per_domain)
    checked = [validate_candidate(item, timeout=timeout) for item in candidates]
    persist_discovery(checked, candidates_path=candidates_path, accepted_path=accepted_path)
    return checked


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Discover IPTV M3U sources from a local JSON provider result")
    parser.add_argument("input", help="JSON file containing results[] or web.results[]")
    parser.add_argument("--query", default="", help="audit query associated with the results")
    parser.add_argument("--max-results", type=int, default=MAX_RESULTS)
    parser.add_argument("--max-per-domain", type=int, default=MAX_PER_DOMAIN)
    args = parser.parse_args(argv)
    records = discover_from_json(args.input, query=args.query, max_results=args.max_results,
                                 max_per_domain=args.max_per_domain)
    print(json.dumps({"accepted": sum(item["audit_status"] == "accepted" for item in records),
                      "rejected": sum(item["audit_status"] != "accepted" for item in records),
                      "total": len(records)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
