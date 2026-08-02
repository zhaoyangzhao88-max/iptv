"""Shared configuration and canonical data paths for the engine."""

from pathlib import Path


PYTHON_ENGINE_DIR = Path(__file__).resolve().parents[1]
ENGINE_ROOT = PYTHON_ENGINE_DIR.parent
REPO_ROOT = ENGINE_ROOT.parent
PLAYER_DATA_DIR = REPO_ROOT / "iptv-project" / "data"
RUNTIME_DATA_DIR = PYTHON_ENGINE_DIR / "data"

# Backward-compatible names for legacy modules. Runtime state remains engine-local;
# the published channel snapshot is always under the player data directory.
OUTPUT_DIR = str(RUNTIME_DATA_DIR)
DATA_DIR = str(RUNTIME_DATA_DIR)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Referer": "https://www.google.com/",
}


def canonical_channels_path() -> str:
    return str(PLAYER_DATA_DIR / "channels.json")


def output_path(filename: str) -> str:
    """Return an engine-local runtime path for legacy state files."""
    RUNTIME_DATA_DIR.mkdir(parents=True, exist_ok=True)
    return str(RUNTIME_DATA_DIR / filename)
