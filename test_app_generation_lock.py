"""
Tests for the P7 advisory lock (REMAINING_WORK.md P7 follow-up): /api/ask
should fail fast and honestly while a Phase B generation job is running,
instead of silently queuing behind it inside Ollama's single-slot request
queue for up to two minutes.

Run with: ~/venv-ai/bin/python3 -m pytest test_app_generation_lock.py -v
"""
from fastapi.testclient import TestClient
import pytest

import app as app_module

client = TestClient(app_module.app)


@pytest.fixture(autouse=True)
def clean_jobs():
    app_module._generation_jobs.clear()
    yield
    app_module._generation_jobs.clear()


# ---------------------------------------------------------------------------
# _generation_job_in_progress() -- the pure lookup
# ---------------------------------------------------------------------------

def test_no_job_running_returns_none():
    assert app_module._generation_job_in_progress() is None


def test_running_vertical_job_is_detected():
    app_module._generation_jobs["letters"] = {
        "vertical": "letters", "status": "running",
        "started_at": "2026-08-30T12:00:00",
    }
    busy = app_module._generation_job_in_progress()
    assert busy is not None
    assert busy["vertical"] == "letters"


def test_finished_vertical_job_is_not_detected():
    app_module._generation_jobs["letters"] = {
        "vertical": "letters", "status": "done",
        "finished_at": "2026-08-30T12:00:00",
    }
    assert app_module._generation_job_in_progress() is None


def test_running_test_suite_job_does_not_count():
    # _run_test_suite_job() runs scripts/status.sh -- no Ollama call, so it
    # doesn't contend for Ollama's single-slot queue and shouldn't block chat.
    app_module._generation_jobs["_test_run"] = {
        "vertical": "_test_run", "status": "running",
        "started_at": "2026-08-30T12:00:00",
    }
    assert app_module._generation_job_in_progress() is None


# ---------------------------------------------------------------------------
# /api/ask -- fails fast instead of hanging behind Ollama's queue
# ---------------------------------------------------------------------------

def test_ask_returns_503_while_generation_running():
    app_module._generation_jobs["letters"] = {
        "vertical": "letters", "status": "running",
        "started_at": "2026-08-30T12:00:00",
    }
    resp = client.post("/api/ask", json={"question": "hello"})
    assert resp.status_code == 503
    assert "letters" in resp.json()["detail"]
