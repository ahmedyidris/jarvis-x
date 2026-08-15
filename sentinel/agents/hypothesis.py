"""Root-cause hypothesis agent — grounded text generation over the
retrieved runbooks/past incidents. If the critic sends this back
(state["critique"]["grounded"] is False), the feedback is folded into the
next attempt instead of silently repeating the same guess.
"""
from agents.llm import get_llm
from agents.util import format_evidence

PROMPT = """You are an SRE root-cause analyst. Using ONLY the evidence below,
propose the single most likely root cause in 1-3 sentences. If the evidence
does not support a confident answer, say so explicitly instead of guessing.

Incident:
\"\"\"{incident}\"\"\"

Extracted entities: {entities}
Severity/category: {severity} / {category}

Retrieved evidence:
{evidence}
{feedback_block}
Root cause hypothesis:
"""


def hypothesis_node(state: dict) -> dict:
    llm = get_llm()
    feedback_block = ""
    if state.get("critique") and not state["critique"].get("grounded", True):
        feedback_block = (
            f"\nA previous hypothesis was rejected as ungrounded: "
            f"{state['critique'].get('notes', '')}\nRevise accordingly.\n"
        )
    resp = llm.invoke(
        PROMPT.format(
            incident=state["raw_input"],
            entities=state.get("entities", {}),
            severity=state.get("severity", "unknown"),
            category=state.get("category", "unknown"),
            evidence=format_evidence(state.get("retrieved", []), show_score=True),
            feedback_block=feedback_block,
        )
    )
    return {"hypothesis": resp.content.strip()}
