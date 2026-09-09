"""Clipper vertical -- highlight-clip pipeline.

run(source) chains the four stages in this package: ingest a local video
file, transcribe it, score the transcript for highlight-worthy spans, and
render one short clip per pick. Nothing in this vertical publishes
anywhere -- every clip lands in media/clips/ with approved=False in the
manifest, and turning that into a publish is a separate manual step.
"""
import json
from datetime import datetime
from pathlib import Path

from .ingest import ingest
from .render import render_clip
from .score import score as score_segments
from .transcribe import transcribe

PROJECT_ROOT = Path(__file__).resolve().parents[3]
CLIPS_DIR = PROJECT_ROOT / "media" / "clips"
MANIFEST_PATH = CLIPS_DIR / "manifest.json"
LOG_PATH = PROJECT_ROOT / "logs" / "actions.jsonl"

# Same kill-switch file app.py's STOP_FILE checks -- see CLAUDE.md's Safety
# & Governance section. Checked once up front so a stopped agent session
# never kicks off a pipeline run in the first place.
STOP_FILE = PROJECT_ROOT / ".jarvis-x-STOP"


class ClipperStoppedError(Exception):
    """Raised when the kill switch (STOP_FILE) is present."""


def _default_ask(prompt: str) -> str:
    """Resolve to hermes.HermesCore().ask(), with context/log off.

    context=False: each score.py prompt is a self-contained window, not a
    conversational turn -- there's no reason to replay chat history into it.
    log=False: same reasoning as code/engineer/explain.py's direct-Ollama
    calls -- a batch scoring call is not a real chat turn and must not show
    up as one in the next request's build_context().
    """
    from hermes import HermesCore

    core = HermesCore()
    try:
        return core.ask(prompt, context=False, log=False)
    finally:
        core.close()


def _log_action(action: str, **fields) -> None:
    """Append one record to logs/actions.jsonl, matching /api/execute's audit shape in app.py."""
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    record = {"timestamp": datetime.now().isoformat(), "action": action, **fields}
    with open(LOG_PATH, "a") as f:
        json.dump(record, f)
        f.write("\n")


def run(
    source: str,
    n_clips: int = 5,
    aspect: str = "9:16",
    language: str = None,
    model_size: str = "base",
    subtitles: bool = True,
    ask=None,
) -> dict:
    """Run the full clipper pipeline on one local video file.

    Returns {"source": <ingest() result>, "transcript": {...}, "clips": [...]}
    and writes media/clips/manifest.json (every clip approved=False).
    Nothing publishes -- approval is a separate manual step.
    """
    if STOP_FILE.exists():
        raise ClipperStoppedError(f"kill switch present at {STOP_FILE} -- refusing to run")

    ask = ask or _default_ask

    media = ingest(source)
    _log_action("clipper-ingest", source=source, path=media["path"], duration=media["duration"])

    transcript = transcribe(media["path"], media["name"], language=language, model_size=model_size)
    _log_action(
        "clipper-transcribe",
        source=media["name"],
        language=transcript["language"],
        segment_count=len(transcript["segments"]),
    )

    picks = score_segments(transcript["segments"], ask, n=n_clips)
    _log_action("clipper-score", source=media["name"], candidate_count=len(picks))

    stem = Path(media["name"]).stem
    clips = []
    for i, pick in enumerate(picks, start=1):
        output_path = CLIPS_DIR / f"{stem}-clip{i}.mp4"
        try:
            rendered = render_clip(
                media["path"], pick, transcript["segments"], str(output_path),
                aspect=aspect, subtitles=subtitles,
            )
        except Exception as e:
            _log_action("clipper-render", source=media["name"], clip=output_path.name, error=str(e))
            continue

        clip_record = {
            **pick,
            "path": rendered["path"],
            "srt_path": rendered["srt_path"],
            "approved": False,
        }
        clips.append(clip_record)
        _log_action("clipper-render", source=media["name"], clip=output_path.name, approved=False)

    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "source": media,
        "language": transcript["language"],
        "generated_at": datetime.now().isoformat(),
        "clips": clips,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))

    return {"source": media, "transcript": transcript, "clips": clips}
