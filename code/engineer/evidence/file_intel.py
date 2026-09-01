"""File Intelligence evidence collection (Observe) for the file_intel
domain: package-manager caches and home-wide old backup-file clutter.

Collects raw facts only -- no diagnosis happens here. See
code/engineer/diagnose_file_intel.py for the rules that turn this into
findings. Deliberately does not import evidence/storage.py -- domain
evidence modules stay independent, duplicating the small amount of shared
logic (dir_size_bytes, backup-file scanning) rather than coupling to
another domain's module.
"""
import os
import re
from pathlib import Path

_BACKUP_PATTERN = re.compile(r"\.bak\d*$")
_SKIP_DIRS = {
    ".git", "node_modules", "__pycache__",
    "venv-ai", ".cache", ".npm", ".pyenv", ".rustup", ".cargo", ".venvs",
}

HOME_DIR = Path.home()

CACHE_PATHS: list[tuple[str, Path]] = [
    ("pip cache", Path.home() / ".cache" / "pip"),
    ("npm cache", Path.home() / ".npm"),
    ("apt archive cache", Path("/var/cache/apt/archives")),
]


def dir_size_bytes(path: Path) -> int | None:
    """Total size in bytes of all regular files under `path`, or None if
    `path` doesn't exist or is not readable. Unreadable files/dirs are
    skipped, not raised. (Same defensive logic as evidence/storage.py's
    dir_size_bytes, duplicated deliberately -- see module docstring.)"""
    if not path.exists():
        return None
    if not os.access(path, os.R_OK | os.X_OK):
        return None
    total = 0
    for root, _dirs, files in os.walk(path, onerror=lambda e: None):
        for name in files:
            fp = Path(root) / name
            try:
                if fp.is_file() and not fp.is_symlink():
                    total += fp.stat().st_size
            except OSError:
                continue
    return total


def _scan_backup_files(root: Path) -> dict:
    """Find files matching *.bak / *.bak<N> under `root`, skipping .git,
    node_modules, __pycache__, and large dependency/env directories that
    aren't worth walking into for stray backup files."""
    matches: list[str] = []
    total = 0
    for dirpath, dirnames, filenames in os.walk(root, onerror=lambda e: None):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
        for name in filenames:
            if _BACKUP_PATTERN.search(name):
                fp = Path(dirpath) / name
                try:
                    if fp.is_file() and not fp.is_symlink():
                        matches.append(str(fp))
                        total += fp.stat().st_size
                except OSError:
                    continue
    return {"count": len(matches), "total_bytes": total, "paths": matches}


def collect() -> dict:
    """Observe: gather file-intelligence evidence (package caches +
    home-wide backup-file clutter). Makes no changes."""
    caches: dict[str, dict] = {}
    for label, path in CACHE_PATHS:
        size = dir_size_bytes(path)
        if size is None:
            caches[label] = {"path": str(path), "unavailable": "path does not exist or is unreadable"}
        else:
            caches[label] = {"path": str(path), "size_bytes": size}

    return {
        "caches": caches,
        "backup_files": _scan_backup_files(HOME_DIR),
    }
