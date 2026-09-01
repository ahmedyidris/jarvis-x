from pathlib import Path

import pytest

from code.engineer.evidence import storage


# --- dir_size_bytes ---------------------------------------------------

def test_dir_size_bytes_sums_files(tmp_path):
    (tmp_path / "a.txt").write_bytes(b"x" * 100)
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "b.txt").write_bytes(b"y" * 50)
    assert storage.dir_size_bytes(tmp_path) == 150


def test_dir_size_bytes_returns_none_for_missing_path(tmp_path):
    assert storage.dir_size_bytes(tmp_path / "missing") is None


def test_dir_size_bytes_does_not_double_count_symlinks(tmp_path):
    real = tmp_path / "real.txt"
    real.write_bytes(b"z" * 10)
    (tmp_path / "link.txt").symlink_to(real)
    assert storage.dir_size_bytes(tmp_path) == 10


# --- _downloads_path ----------------------------------------------------

def test_downloads_path_prefers_chromeos_mount_when_present(tmp_path):
    marker = tmp_path / "Downloads"
    marker.mkdir()
    assert storage._downloads_path(marker) == marker


def test_downloads_path_falls_back_to_home_when_chromeos_mount_absent(tmp_path):
    marker = tmp_path / "does-not-exist"
    assert storage._downloads_path(marker) == Path.home() / "Downloads"


# --- _scan_backup_files ---------------------------------------------------

def test_scan_backup_files_finds_bak_variants(tmp_path):
    (tmp_path / "app.py.bak").write_bytes(b"a" * 10)
    (tmp_path / "app.py.bak2").write_bytes(b"b" * 20)
    (tmp_path / "app.py").write_bytes(b"c" * 30)  # not a match
    result = storage._scan_backup_files(tmp_path)
    assert result["count"] == 2
    assert result["total_bytes"] == 30


def test_scan_backup_files_skips_git_and_node_modules(tmp_path):
    git_dir = tmp_path / ".git"
    git_dir.mkdir()
    (git_dir / "x.bak").write_bytes(b"a" * 10)
    result = storage._scan_backup_files(tmp_path)
    assert result["count"] == 0


# --- collect ---------------------------------------------------------

def test_collect_reports_candidate_sizes(tmp_path, monkeypatch):
    candidate_dir = tmp_path / "candidate"
    candidate_dir.mkdir()
    (candidate_dir / "f.txt").write_bytes(b"x" * 42)
    monkeypatch.setattr(storage, "CANDIDATE_PATHS", [("test-candidate", candidate_dir)])
    monkeypatch.setattr(storage, "JARVIS_X_ROOT", tmp_path)
    evidence = storage.collect()
    assert evidence["disk_usage"]["total_bytes"] > 0
    assert evidence["candidates"]["test-candidate"]["size_bytes"] == 42
    assert "backup_files" in evidence


def test_collect_marks_missing_candidate_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "CANDIDATE_PATHS", [("missing", tmp_path / "nope")])
    monkeypatch.setattr(storage, "JARVIS_X_ROOT", tmp_path)
    evidence = storage.collect()
    assert "unavailable" in evidence["candidates"]["missing"]
