"""Turns ranked storage findings into the three-section plain-language
report (What I found / What I recommend / What I can do) using the local
model.

Calls Ollama directly -- never via hermes.py's HermesCore.ask(), which
unconditionally logs every call into real chat history (see the wiki
finding recorded 2026-09-01, anchored to hermes.py and code/router.py).
"""
import requests

from code.router import Router

OLLAMA_URL = "http://localhost:11434/api/generate"

SYSTEM_PROMPT = (
    "You are Jarvis, a local systems diagnostic assistant. You are given a "
    "list of findings from a read-only storage scan. Using ONLY the given "
    "findings -- never inventing details -- write a plain-language report "
    "with exactly these three sections: 'What I found', 'What I recommend', "
    "'What I can do'. This build performs no automatic actions, so 'What I "
    "can do' should describe what the user can do manually, not promise "
    "automated fixes. If there are no findings, say the storage looks "
    "healthy."
)


class ExplainBackendError(Exception):
    """The local model backend failed or was unreachable."""


def _findings_to_prompt(findings: list) -> str:
    if not findings:
        return "No findings."
    lines = []
    for f in findings:
        lines.append(
            f"- issue: {f.issue}\n"
            f"  severity: {f.severity}\n"
            f"  evidence: {f.evidence}\n"
            f"  probable_root_cause: {f.probable_root_cause}\n"
            f"  confidence: {f.confidence}\n"
            f"  recommended_action: {f.recommended_action}"
        )
    return "\n".join(lines)


def explain(findings: list, tier: str = "local", timeout: int = 120) -> str:
    """Return the plain-language report for `findings`, or raise
    ExplainBackendError if the local model is unreachable or fails."""
    model, _voice = Router().resolve(tier)
    prompt = SYSTEM_PROMPT + "\n\nFindings:\n" + _findings_to_prompt(findings)
    try:
        resp = requests.post(
            OLLAMA_URL,
            json={"model": model, "prompt": prompt, "stream": False},
            timeout=timeout,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        raise ExplainBackendError(str(e)) from e
    except ValueError as e:  # json decode error
        raise ExplainBackendError(f"unparseable response: {e}") from e
    response = data.get("response", "").strip()
    if not response:
        raise ExplainBackendError("empty response from model")
    return response
