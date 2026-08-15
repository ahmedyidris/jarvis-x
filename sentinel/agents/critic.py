"""Critic / verifier agent — the LLM-judge groundedness check that keeps
the hypothesis agent honest instead of trusting its first guess. This is
the piece that turns "plausible-sounding" into "defensible."
"""
from agents.llm import get_llm
from agents.util import extract_json, format_evidence

PROMPT = """You are a skeptical reviewer. Does the retrieved evidence below
actually support the hypothesis? Be strict — an unsupported guess should
fail even if it sounds plausible.

Hypothesis:
\"\"\"{hypothesis}\"\"\"

Evidence:
{evidence}

Respond with ONLY JSON: {{"grounded": true/false, "score": 1-5, "notes": "short reason"}}
"""


def critic_node(state: dict) -> dict:
    llm = get_llm()
    resp = llm.invoke(
        PROMPT.format(
            hypothesis=state.get("hypothesis", ""),
            evidence=format_evidence(state.get("retrieved", [])),
        )
    )
    critique = extract_json(resp.content, default={"grounded": False, "score": 1, "notes": "unparseable critic output"})
    return {
        "critique": critique,
        "revisions": state.get("revisions", 0) + 1,
    }
