import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Callable, List

from python_engine.src.models import Channel
from python_engine.src.url_policy import contains_sensitive_url


MIN_CHANNEL_COUNT = 1
MAX_RELATIVE_DECLINE = 0.20


def _validate_publication_data(data: List[dict]) -> None:
    if not isinstance(data, list) or not data:
        raise ValueError("channel publication must contain at least one channel")
    for item in data:
        channel = Channel.model_validate(item)
        errors = channel.publication_errors()
        if errors:
            raise ValueError("; ".join(errors))
        for route in item.get("urls", []):
            if isinstance(route, dict):
                route = route.get("url")
            if contains_sensitive_url(route):
                raise ValueError("channel publication contains a sensitive URL parameter")


def _validate_decline(data: List[dict], output_path: str) -> None:
    if not os.path.exists(output_path):
        return
    try:
        with open(output_path, encoding="utf-8") as stream:
            previous = json.load(stream)
    except (OSError, ValueError) as exc:
        raise ValueError("existing channel snapshot is unreadable") from exc
    if not isinstance(previous, list) or not previous:
        return
    baseline = len(previous)
    if len(data) < baseline * (1 - MAX_RELATIVE_DECLINE):
        raise ValueError("channel publication declined by more than 20% versus stable snapshot")


# The engine and player share one canonical snapshot under the repository root.
REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT_PATH = str(REPO_ROOT / "iptv-project" / "data" / "channels.json")

# Compatibility names retained for callers of the old writer API.  Both names
# intentionally resolve to the canonical player snapshot; there is no fallback
# to an engine-local file.
DEFAULT_LOCAL_PATH = DEFAULT_OUTPUT_PATH
DEFAULT_CI_PATH = DEFAULT_OUTPUT_PATH


def determine_output_path() -> str:
    """Return the explicit ``OUTPUT_PATH`` override or the repository snapshot."""
    env_path = os.getenv("OUTPUT_PATH")
    if env_path:
        return env_path
    return DEFAULT_OUTPUT_PATH


def determine_manifest_path(output_path: str = None) -> str:
    """Return the stable manifest path paired with a channel snapshot."""
    env_path = os.getenv("MANIFEST_PATH")
    if env_path:
        return env_path
    snapshot_path = output_path or determine_output_path()
    return os.path.splitext(os.fspath(snapshot_path))[0] + ".manifest.json"


def _fsync_directory(directory: str) -> None:
    if os.name == "nt":
        return
    try:
        descriptor = os.open(directory, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _atomic_write_text(output_path: str, write_content: Callable[[object], None]) -> str:
    """Write text through a same-directory temporary file and atomically replace."""
    output_path = os.fspath(output_path)
    output_directory = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(output_directory, exist_ok=True)

    file_descriptor, temporary_path = tempfile.mkstemp(
        dir=output_directory,
        prefix=f".{os.path.basename(output_path)}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as stream:
            file_descriptor = None
            write_content(stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, output_path)
        _fsync_directory(output_directory)
    except BaseException:
        if file_descriptor is not None:
            try:
                os.close(file_descriptor)
            except OSError:
                pass
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass
        except OSError:
            pass
        raise

    return output_path


def _stage_text(output_path: str, content: str) -> str:
    output_path = os.fspath(output_path)
    output_directory = os.path.dirname(os.path.abspath(output_path))
    os.makedirs(output_directory, exist_ok=True)
    descriptor, temporary_path = tempfile.mkstemp(
        dir=output_directory,
        prefix=f".{os.path.basename(output_path)}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            descriptor = None
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass
        try:
            os.unlink(temporary_path)
        except OSError:
            pass
        raise
    return temporary_path


def publish_text_files(files: dict[str, str]) -> None:
    """Commit several text files as one rollback-safe publication transaction."""
    staged: dict[str, str] = {}
    backups: dict[str, str] = {}
    committed: list[str] = []
    try:
        for output_path, content in files.items():
            staged[os.fspath(output_path)] = _stage_text(output_path, content)

        for output_path in staged:
            if not os.path.exists(output_path):
                continue
            directory = os.path.dirname(os.path.abspath(output_path))
            descriptor, backup_path = tempfile.mkstemp(
                dir=directory,
                prefix=f".{os.path.basename(output_path)}.",
                suffix=".bak",
            )
            os.close(descriptor)
            shutil.copyfile(output_path, backup_path)
            backups[output_path] = backup_path

        for output_path, temporary_path in staged.items():
            os.replace(temporary_path, output_path)
            committed.append(output_path)
            _fsync_directory(os.path.dirname(os.path.abspath(output_path)))
    except BaseException:
        for output_path in reversed(committed):
            backup_path = backups.get(output_path)
            try:
                if backup_path and os.path.exists(backup_path):
                    os.replace(backup_path, output_path)
                    backups.pop(output_path, None)
                elif os.path.exists(output_path):
                    os.unlink(output_path)
            except OSError:
                pass
        raise
    finally:
        for temporary_path in staged.values():
            try:
                os.unlink(temporary_path)
            except OSError:
                pass
        for backup_path in backups.values():
            try:
                os.unlink(backup_path)
            except OSError:
                pass


def write_publication(
    data: List[dict],
    manifest: dict,
    output_path: str = None,
    manifest_path: str = None,
    extra_files: dict[str, str] | None = None,
) -> str:
    """Publish snapshot, manifest, and optional state files as one pair-safe unit."""
    snapshot_path = output_path or determine_output_path()
    _validate_publication_data(data)
    _validate_decline(data, snapshot_path)
    stable_manifest_path = manifest_path or determine_manifest_path(snapshot_path)
    files = {
        snapshot_path: json.dumps(data, ensure_ascii=False, indent=2),
        stable_manifest_path: json.dumps(manifest, ensure_ascii=False, indent=2),
    }
    if extra_files:
        files.update({os.fspath(path): content for path, content in extra_files.items()})
    publish_text_files(files)
    return os.fspath(snapshot_path)


def write_channels_json(data: List[dict]) -> str:
    """Validate and atomically write the player-compatible JSON snapshot."""
    output_path = determine_output_path()
    _validate_publication_data(data)
    _validate_decline(data, output_path)
    return _atomic_write_text(
        output_path,
        lambda stream: json.dump(data, stream, ensure_ascii=False, indent=2),
    )


def write_manifest(manifest: dict, output_path: str = None) -> str:
    """Atomically write the metrics manifest paired with a stable snapshot."""
    manifest_path = output_path or determine_manifest_path()
    return _atomic_write_text(
        manifest_path,
        lambda stream: json.dump(manifest, stream, ensure_ascii=False, indent=2),
    )


def write_channels_m3u(data: List[dict], output_path: str = None) -> str:
    """Atomically export channels as an M3U playlist."""
    if output_path is None:
        json_path = determine_output_path()
        output_path = os.path.splitext(json_path)[0] + ".m3u"

    lines = ["#EXTM3U"]
    for ch in data:
        urls = ch.get("urls", [])
        if not urls:
            continue
        if ch.get("is_multicast", False):
            continue  # 组播源对公网用户不可用
        name = ch.get("name", "")
        group = ch.get("group", "")
        logo = ch.get("logo", "")
        tvg_id = ch.get("tvg_id", "")

        attrs = []
        if tvg_id:
            attrs.append(f'tvg-id="{tvg_id}"')
        if name:
            attrs.append(f'tvg-name="{name}"')
        if logo:
            attrs.append(f'tvg-logo="{logo}"')
        if group:
            attrs.append(f'group-title="{group}"')

        lines.append(f'#EXTINF:-1 {" ".join(attrs)},{name}')
        lines.append(urls[0])

    serialized = "\n".join(lines) + "\n"
    return _atomic_write_text(output_path, lambda stream: stream.write(serialized))
