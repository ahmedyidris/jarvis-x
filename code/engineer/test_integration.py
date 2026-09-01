"""Integration test for the seam between evidence collection and diagnosis.

Unit tests in test_diagnose.py exercise run_rules() against hand-typed
fixture dicts, so a key rename or shape change in storage.collect()'s real
output would not be caught by any existing test. This test feeds the real
collect() output straight into the real run_rules() to verify that seam.
"""
from code.engineer import diagnose
from code.engineer.evidence import storage


def test_real_collect_output_is_valid_input_to_run_rules(tmp_path, monkeypatch):
    normal_dir = tmp_path / "normal"
    normal_dir.mkdir()
    (normal_dir / "f.txt").write_bytes(b"x" * 1000)

    missing_dir = tmp_path / "does-not-exist"

    locked_dir = tmp_path / "locked"
    locked_dir.mkdir()
    (locked_dir / "f.txt").write_bytes(b"y" * 10)

    monkeypatch.setattr(storage, "CANDIDATE_PATHS", [
        ("normal", normal_dir),
        ("missing", missing_dir),
        ("locked", locked_dir),
    ])
    monkeypatch.setattr(storage, "JARVIS_X_ROOT", tmp_path)

    try:
        locked_dir.chmod(0o000)
        evidence = storage.collect()
        findings = diagnose.run_rules(evidence, previous=None)  # must not crash
    finally:
        # Restore permissions so pytest's cleanup can remove the directory
        locked_dir.chmod(0o755)

    # The real "unavailable" reason string, not a hand-typed guess at it.
    assert evidence["candidates"]["missing"]["unavailable"] == "path does not exist or is unreadable"
    assert evidence["candidates"]["locked"]["unavailable"] == "path does not exist or is unreadable"
    assert evidence["candidates"]["normal"]["size_bytes"] == 1000
    assert evidence["candidates"]["normal"]["on_root_filesystem"] is True

    assert isinstance(findings, list)

    # Neither unavailable candidate can ever surface as a space-hog finding.
    hog_affected = {
        component
        for f in findings
        if "major space consumer" in f.issue
        for component in f.affected_components
    }
    assert str(missing_dir) not in hog_affected
    assert str(locked_dir) not in hog_affected
