"""Clipper vertical -- stage 3: score.

Scores transcript segments for highlight-worthy clips by chunking them into
overlapping windows and asking an LLM (Hermes, by default -- see
__init__.py's _default_ask) to propose candidate {start, end, hook, score,
reason} spans per window. The model call is injected as `ask(prompt) -> str`
so this module has zero direct dependency on hermes.py and can be tested
with a stub.
"""
import json
import re

WINDOW_SECONDS = 480
OVERLAP_SECONDS = 60
MIN_CLIP_SECONDS = 15
MAX_CLIP_SECONDS = 60
DEDUPE_WINDOW_SECONDS = 5

PROMPT_TEMPLATE = """You are selecting short highlight clips from a video transcript for social media.

Below is one window of a transcript, with each line's start/end time in seconds.

{window_text}

Return ONLY a JSON array (no prose, no markdown fences) of candidate clips, each shaped exactly like:
{{"start": <seconds float>, "end": <seconds float>, "hook": "<short attention-grabbing line, in the SAME language as the transcript>", "score": <0-10 float, higher is more compelling>, "reason": "<one sentence, why this is a good clip>"}}

Only include spans that make sense as a standalone 15-60 second clip. If nothing in this window is worth clipping, return [].
"""


def _chunk_segments(segments: list) -> list:
    """Split segments into WINDOW_SECONDS windows overlapping by OVERLAP_SECONDS."""
    if not segments:
        return []

    total_end = max(seg["end"] for seg in segments)
    windows = []
    window_start = 0.0
    step = WINDOW_SECONDS - OVERLAP_SECONDS
    while window_start < total_end:
        window_end = window_start + WINDOW_SECONDS
        window_segments = [
            seg for seg in segments
            if seg["start"] < window_end and seg["end"] > window_start
        ]
        if window_segments:
            windows.append(window_segments)
        window_start += step
    return windows


def _format_window(segments: list) -> str:
    return "\n".join(f"[{seg['start']:.1f}-{seg['end']:.1f}] {seg['text']}" for seg in segments)


def _parse_candidates(raw: str) -> list:
    """Defensively parse the model's response into a list of candidate dicts.

    Strips markdown code fences, regexes out the first JSON array literal,
    and returns [] for anything that doesn't parse -- a malformed or empty
    response from a small local model is expected, not exceptional.
    """
    if not raw:
        return []

    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()

    match = re.search(r"\[.*\]", text, flags=re.DOTALL)
    if not match:
        return []

    try:
        candidates = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []

    if not isinstance(candidates, list):
        return []

    valid = []
    for c in candidates:
        if not isinstance(c, dict):
            continue
        try:
            valid.append({
                "start": float(c["start"]),
                "end": float(c["end"]),
                "hook": str(c.get("hook", "")).strip(),
                "score": float(c.get("score", 0)),
                "reason": str(c.get("reason", "")).strip(),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return valid


def _is_near_duplicate(candidate: dict, picks: list) -> bool:
    return any(abs(candidate["start"] - p["start"]) < DEDUPE_WINDOW_SECONDS for p in picks)


def score(segments: list, ask, n: int = 5) -> list:
    """Score transcript segments and return the top `n` highlight candidates.

    `ask` is a callable(prompt: str) -> str, injected so tests can stub the
    model. Returns a list of {"start", "end", "hook", "score", "reason"}
    sorted by score descending, filtered to MIN_CLIP_SECONDS-MAX_CLIP_SECONDS
    duration with near-duplicates (within DEDUPE_WINDOW_SECONDS of an
    already-picked start) dropped.
    """
    all_candidates = []
    for window_segments in _chunk_segments(segments):
        prompt = PROMPT_TEMPLATE.format(window_text=_format_window(window_segments))
        try:
            raw = ask(prompt)
        except Exception:
            continue
        all_candidates.extend(_parse_candidates(raw))

    filtered = [
        c for c in all_candidates
        if MIN_CLIP_SECONDS <= (c["end"] - c["start"]) <= MAX_CLIP_SECONDS
    ]
    filtered.sort(key=lambda c: c["score"], reverse=True)

    picks = []
    for c in filtered:
        if _is_near_duplicate(c, picks):
            continue
        picks.append(c)
        if len(picks) >= n:
            break

    return picks
