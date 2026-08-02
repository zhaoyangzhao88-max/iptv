"""Explicit, finite configuration for authorized IPTV sources."""
from dataclasses import dataclass
from typing import Any, Iterable, Mapping
from urllib.parse import urlparse

@dataclass(frozen=True)
class SourceConfig:
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
        return cls(url=str(value["url"]), name=str(value.get("name", "")), enabled=bool(value.get("enabled", True)), timeout=int(value.get("timeout", 8)))

DEFAULT_SOURCE_CONFIG = tuple(SourceConfig(url=url) for url in (
    "https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u",
    "https://raw.githubusercontent.com/YueChan/Live/main/APTV.m3u",
    "https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u",
    "https://raw.githubusercontent.com/MellowCo/iptv/main/iptv.m3u",
    "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u",
))

SOURCE_CONFIG = {f"source_{i + 1}": item.url for i, item in enumerate(DEFAULT_SOURCE_CONFIG)}

def load_source_config(values: Iterable[SourceConfig | Mapping[str, Any]]) -> tuple[SourceConfig, ...]:
    configs, seen = [], set()
    for value in values:
        config = value if isinstance(value, SourceConfig) else SourceConfig.from_mapping(value)
        if config.enabled and config.url not in seen:
            configs.append(config); seen.add(config.url)
    return tuple(configs)

def authorized_urls(values=DEFAULT_SOURCE_CONFIG) -> frozenset[str]:
    return frozenset(config.url for config in load_source_config(values))

def get_source_config() -> dict[str, str]:
    return dict(SOURCE_CONFIG)

def source_urls(config: dict[str, str] | None = None) -> list[str]:
    return list((config or SOURCE_CONFIG).values())

def source_id_for_url(url: str, config: dict[str, str] | None = None) -> str:
    for source_id, configured_url in (config or SOURCE_CONFIG).items():
        if configured_url == url: return source_id
    return url

def normalize_source_config(config: dict[str, str] | None = None) -> dict[str, str]:
    return {str(source_id): str(url) for source_id, url in (config or SOURCE_CONFIG).items() if source_id and url}
