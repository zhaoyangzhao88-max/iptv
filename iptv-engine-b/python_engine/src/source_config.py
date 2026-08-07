"""Explicit, finite configuration for authorized IPTV sources."""
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping
from urllib.parse import urlparse

from python_engine.src.url_policy import is_safe_fetch_url

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
    "https://raw.githubusercontent.com/YueChan/Live/main/IPTV.m3u",
    "https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u",
    "https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u",
))

SOURCE_CONFIG = {f"source_{i + 1}": item.url for i, item in enumerate(DEFAULT_SOURCE_CONFIG)}
DISCOVERED_SOURCES_PATH = Path(__file__).resolve().parents[1] / "data" / "discovered_sources.json"


def _load_discovered_sources(path: Path = DISCOVERED_SOURCES_PATH) -> tuple[SourceConfig, ...]:
    try:
        with path.open(encoding="utf-8") as stream:
            records = json.load(stream)
    except (OSError, json.JSONDecodeError):
        return ()
    if not isinstance(records, list):
        return ()
    values = []
    for record in records:
        if not isinstance(record, Mapping):
            continue
        if record.get("audit_status") != "accepted" or not record.get("enabled", False):
            continue
        if record.get("trust_tier") != "discovered-low":
            continue
        try:
            url = str(record["url"])
            if not is_safe_fetch_url(url):
                continue
            values.append(SourceConfig(url=url, name="discovered-low"))
        except (KeyError, TypeError, ValueError):
            continue
    return load_source_config(values)


def _all_source_configs() -> tuple[SourceConfig, ...]:
    return load_source_config((*DEFAULT_SOURCE_CONFIG, *_load_discovered_sources()))


def load_source_config(values: Iterable[SourceConfig | Mapping[str, Any]]) -> tuple[SourceConfig, ...]:
    configs, seen = [], set()
    for value in values:
        config = value if isinstance(value, SourceConfig) else SourceConfig.from_mapping(value)
        if config.enabled and config.url not in seen:
            configs.append(config); seen.add(config.url)
    return tuple(configs)

def authorized_urls(values=None) -> frozenset[str]:
    return frozenset(config.url for config in load_source_config(values if values is not None else _all_source_configs()))


def get_source_config() -> dict[str, str]:
    return {f"source_{i + 1}": item.url for i, item in enumerate(_all_source_configs())}


def source_urls(config: dict[str, str] | None = None) -> list[str]:
    return list((config or get_source_config()).values())


def source_id_for_url(url: str, config: dict[str, str] | None = None) -> str:
    for source_id, configured_url in (config or get_source_config()).items():
        if configured_url == url: return source_id
    return url


def normalize_source_config(config: dict[str, str] | None = None) -> dict[str, str]:
    return {str(source_id): str(url) for source_id, url in (config or get_source_config()).items() if source_id and url}
