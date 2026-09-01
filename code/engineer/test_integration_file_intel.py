"""Integration test for the file_intel domain's evidence/diagnose seam --
feeds the REAL evidence/file_intel.collect() output into the REAL
diagnose_file_intel.run_rules(), rather than a hand-typed fixture, so a key
rename in one module can't silently drift from the other.
"""
from code.engineer import diagnose_file_intel
from code.engineer.evidence import file_intel


def test_real_collect_output_is_valid_input_to_run_rules(tmp_path, monkeypatch):
    normal_cache = tmp_path / "normal_cache"
    normal_cache.mkdir()
    (normal_cache / "big.whl").write_bytes(b"x" * (150 * 1024 * 1024))

    locked_cache = tmp_path / "locked_cache"
    locked_cache.mkdir()
    (locked_cache / "secret").write_bytes(b"y" * 10)
    locked_cache.chmod(0o000)

    missing_cache = tmp_path / "does-not-exist"

    home_dir = tmp_path / "home"
    home_dir.mkdir()
    (home_dir / "notes.txt.bak").write_bytes(b"z" * 100)

    monkeypatch.setattr(file_intel, "CACHE_PATHS", [
        ("normal", normal_cache),
        ("locked", locked_cache),
        ("missing", missing_cache),
    ])
    monkeypatch.setattr(file_intel, "HOME_DIR", home_dir)

    try:
        evidence = file_intel.collect()
        findings = diagnose_file_intel.run_rules(evidence, previous=None)

        # unavailable caches never surface as a "safe to clear" finding
        assert evidence["caches"]["locked"]["unavailable"] == "path does not exist or is unreadable"
        assert evidence["caches"]["missing"]["unavailable"] == "path does not exist or is unreadable"
        assert all("locked" not in f.issue and "missing" not in f.issue for f in findings)

        # the real large cache does surface
        assert any("normal" in f.issue for f in findings)

        # the real home-wide backup file surfaces
        assert any("backup" in f.issue.lower() for f in findings)
    finally:
        locked_cache.chmod(0o755)
