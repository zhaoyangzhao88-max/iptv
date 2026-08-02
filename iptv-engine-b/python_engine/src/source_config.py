"""Explicit configuration for the IPTV sources the engine is allowed to fetch.

This module deliberately contains no discovery logic.  A source enters the
fetch pipeline only when it is present in the configured source list (or is
passed explicitly by a caller using the legacy string API).
"""

from dataclasses import dataclass
from typing import Any, Iterable, Mapping
from urllib.parse import urlparse


@dataclass(frozen=True)
class SourceConfig:
    """One explicitly authorized remote M3U source."""

    url: str
    name: str = ""
    enabled: bool = True
    timeout: int = 8

    def __post_init__(self) -> None:
        parsed = urlparse(self.url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError(f"source URL must be an absolute HTTP(S) URL: {self.url!r}")
        if self.timeout <= 0:
            raise ValueError("source timeout must be positive")

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "SourceConfig":
        return cls(
            url=str(value["url"]),
            name=str(value.get("name", "")),
            enabled=bool(value.get("enabled", True)),
            timeout=int(value.get("timeout", 8)),
        )


# The list is intentionally finite and reviewable.  Do not add discovery or
# wildcard URL matching here.
DEFAULT_SOURCE_CONFIG = tuple(
    SourceConfig(url=url)
    for url in (
        "https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u",
        "https://raw.githubusercontent.com/YueChan/Live/main/APTV.m3u",
        "https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u",
        "https://raw.githubusercontent.com/MellowCo/iptv/main/iptv.m3u",
        "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u",
    )
)


def load_source_config(values: Iterable[SourceConfig | Mapping[str, Any]]) -> tuple[SourceConfig, ...]:
    """Validate and return enabled source entries in declaration order."""
    configs = []
    seen = set()
    for value in values:
        config = value if isinstance(value, SourceConfig) else SourceConfig.from_mapping(value)
        if config.enabled and config.url not in seen:
            configs.append(config)
            seen.add(config.url)
    return tuple(configs)


def authorized_urls(values: Iterable[SourceConfig | Mapping[str, Any]] = DEFAULT_SOURCE_CONFIG) -> frozenset[str]:
    """Return the exact URL allowlist represented by *values*."""
    return frozenset(config.url for config in load_source_config(values))
