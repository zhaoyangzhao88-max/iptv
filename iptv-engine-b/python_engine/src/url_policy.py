"""URL privacy helpers shared by publication and diagnostics."""

from __future__ import annotations

import re
import socket
from collections.abc import Mapping
from ipaddress import ip_address
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

SENSITIVE_KEY_PARTS = frozenset(
    {
        "account",
        "apikey",
        "auth",
        "authorization",
        "cookie",
        "credential",
        "password",
        "passwd",
        "secret",
        "session",
        "signature",
        "sig",
        "token",
        "txsecret",
        "streamkey",
        "streamid",
        "migutoken",
        "wstime",
        "wssecret",
    }
)

_SPECIAL_PLATFORM_HOSTS = frozenset({"bilibili", "douyin", "kuaishou"})
_SPECIAL_ROOM_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_BLOCKED_HOSTNAMES = frozenset({
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
    "metadata",
})


def _public_hostname(hostname: str) -> bool:
    normalized = hostname.rstrip(".").lower()
    if not normalized or normalized in _BLOCKED_HOSTNAMES or normalized.endswith(".localhost"):
        return False
    try:
        address = ip_address(normalized)
    except ValueError:
        try:
            resolved = socket.getaddrinfo(normalized, None, type=socket.SOCK_STREAM)
        except OSError:
            return False
        return bool(resolved) and all(_public_ip(item[4][0]) for item in resolved)
    return _public_ip(address)


def _public_ip(address: object) -> bool:
    try:
        value = ip_address(address)
    except ValueError:
        return False
    return not (
        value.is_private
        or value.is_loopback
        or value.is_link_local
        or value.is_reserved
        or value.is_multicast
        or value.is_unspecified
    )


def is_safe_fetch_url(value: object, *, allow_loopback: bool = False) -> bool:
    """Allow only absolute HTTP(S) URLs that do not target local networks."""
    if not isinstance(value, str):
        return False
    try:
        parsed = urlsplit(value.strip())
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return False
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not parsed.netloc
        or not hostname
        or parsed.username
        or parsed.password
        or parsed.fragment
    ):
        return False
    if allow_loopback and is_special_loopback_url(value):
        return True
    return _public_hostname(hostname) and port != 0


def validate_redirect_url(value: object) -> str:
    """Validate a redirect target and return its normalized URL."""
    if not is_safe_fetch_url(value):
        raise ValueError("unsafe redirect target")
    return str(value).strip()

def is_special_loopback_url(value: object) -> bool:
    """Return whether *value* is a stable, supported Node resolver route."""
    if not isinstance(value, str):
        return False
    try:
        parsed = urlsplit(value.strip())
        port = parsed.port
    except ValueError:
        return False
    if (
        parsed.scheme.lower() != "http"
        or parsed.hostname != "127.0.0.1"
        or port != 3000
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        return False
    parts = [part for part in parsed.path.split("/") if part]
    return (
        len(parts) == 3
        and parts[0].lower() == "api"
        and parts[1].lower() in _SPECIAL_PLATFORM_HOSTS
        and bool(_SPECIAL_ROOM_ID.fullmatch(parts[2]))
    )


def _normalise_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def is_sensitive_key(value: object) -> bool:
    compact = _normalise_key(value)
    if not compact:
        return False
    return any(
        compact == part or compact.startswith(part) or compact.endswith(part)
        for part in SENSITIVE_KEY_PARTS
        if len(part) >= 4
    )


def contains_sensitive_url(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    if parsed.username or parsed.password:
        return True
    if any(is_sensitive_key(key) for key, _ in parse_qsl(parsed.query, keep_blank_values=True)):
        return True
    path_and_fragment = f"{parsed.path}#{parsed.fragment}".lower()
    return any(part in re.findall(r"[a-z0-9]+", path_and_fragment) for part in SENSITIVE_KEY_PARTS)


def sanitize_url(value: object) -> str:
    """Return a display/publication-safe URL without credential material."""
    if not isinstance(value, str):
        return ""
    try:
        parsed = urlsplit(value.strip())
    except ValueError:
        return "[redacted-url]"
    if not parsed.scheme or not parsed.netloc:
        return "[redacted-url]"

    hostname = parsed.hostname or ""
    if ":" in hostname and not hostname.startswith("["):
        hostname = f"[{hostname}]"
    netloc = hostname
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"

    safe_query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True)
        if not is_sensitive_key(key)
    ]
    # Fragments are never needed for a public stream URL and often carry tokens.
    safe_path = parsed.path
    path_parts = [part for part in safe_path.split("/") if part]
    if any(is_sensitive_key(part) for part in path_parts):
        safe_path = "/" + "/".join("[redacted]" if is_sensitive_key(part) else part for part in path_parts)
    return urlunsplit((parsed.scheme, netloc, safe_path, urlencode(safe_query), ""))


def sanitize_value(value: object) -> object:
    if isinstance(value, str):
        return sanitize_url(value) if "://" in value else value
    if isinstance(value, Mapping):
        return {key: sanitize_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_value(item) for item in value]
    return value
