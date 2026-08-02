"""Pure helpers for recording source-fetch health without network discovery."""

from dataclasses import dataclass
from typing import Iterable, Mapping


@dataclass(frozen=True)
class SourceHealth:
    url: str
    success: bool
    status_code: int | None = None
    error: str | None = None


def assess_source_health(
    configured_urls: Iterable[str],
    results: Mapping[str, str],
) -> tuple[SourceHealth, ...]:
    """Summarize only configured URLs; unknown result keys are ignored."""
    return tuple(
        SourceHealth(
            url=url,
            success=bool(results.get(url)),
            error=None if results.get(url) else "empty or unavailable response",
        )
        for url in configured_urls
    )


def healthy_urls(health: Iterable[SourceHealth]) -> tuple[str, ...]:
    """Return successful URLs while preserving the supplied order."""
    return tuple(item.url for item in health if item.success)
