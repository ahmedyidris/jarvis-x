import pytest
from pathlib import Path
from unittest.mock import patch

from code.verticals.clipper.render import _aspect_filter, _format_srt_timestamp, _write_srt, RenderError
from code.verticals.clipper.score import _chunk_segments, _parse_candidates, score as score_segments
from code.verticals.clipper import run as clipper_run, ClipperStoppedError


def test_aspect_filter():
    f = _aspect_filter("9:16")
    assert "scale=1080:1920" in f
    assert "crop=" in f

    with pytest.raises(RenderError):
        _aspect_filter("21:9")


def test_format_srt_timestamp():
    assert _format_srt_timestamp(0) == "00:00:00,000"
    assert _format_srt_timestamp(65.123) == "00:01:05,123"
    assert _format_srt_timestamp(3661.050) == "01:01:01,050"


def test_write_srt(tmp_path):
    segments = [
        {"start": 5.0, "end": 10.0, "text": "First segment"},
        {"start": 10.0, "end": 20.0, "text": "Second segment"},
        {"start": 25.0, "end": 35.0, "text": "Third segment (outside)"},
    ]
    srt_file = tmp_path / "test.srt"
    _write_srt(segments, clip_start=8.0, clip_end=22.0, srt_path=srt_file)
    content = srt_file.read_text()
    assert "First segment" in content
    assert "Second segment" in content
    assert "Third segment" not in content


def test_parse_candidates():
    raw = """
    ```json
    [
        {"start": 10.0, "end": 30.0, "hook": "Look at this", "score": 8.5, "reason": "Engaging hook"}
    ]
    ```
    """
    candidates = _parse_candidates(raw)
    assert len(candidates) == 1
    assert candidates[0]["start"] == 10.0
    assert candidates[0]["hook"] == "Look at this"
    assert candidates[0]["score"] == 8.5


def test_clipper_stopped_error(tmp_path):
    with patch("code.verticals.clipper.STOP_FILE", tmp_path / ".jarvis-x-STOP"):
        (tmp_path / ".jarvis-x-STOP").touch()
        with pytest.raises(ClipperStoppedError):
            clipper_run("fake_path.mp4")


def test_app_clipper_validation():
    from fastapi.testclient import TestClient
    import app as app_module

    client = TestClient(app_module.app)

    # Invalid aspect
    res = client.post("/api/verticals/clipper", json={"source": "v.mp4", "aspect": "3:2"})
    assert res.status_code == 400
    assert "aspect" in res.json()["detail"]

    # Invalid n_clips
    res = client.post("/api/verticals/clipper", json={"source": "v.mp4", "n_clips": 99})
    assert res.status_code == 400
    assert "n_clips" in res.json()["detail"]

    # Valid validation shape
    with patch.object(app_module, "_run_clipper_job"):
        res = client.post("/api/verticals/clipper", json={"source": "v.mp4", "aspect": "9:16", "n_clips": 3})
        assert res.status_code == 200
        data = res.json()
        assert "job_id" in data
        assert data["status"] == "running"

        # Check job status endpoint
        res_status = client.get(f"/api/verticals/clipper/{data['job_id']}")
        assert res_status.status_code == 200
        assert res_status.json()["status"] == "running"
