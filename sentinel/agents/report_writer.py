"""Report-writer agent — covers HF's Summarization task: turn the
triage/retrieval/hypothesis/critique trail into a single incident report.
"""
from agents.llm import get_llm

PROMPT = """Write a concise incident report in markdown with these sections:
## Summary, ## Severity & Category, ## Evidence, ## Root Cause Hypothesis,
## Confidence, ## Recommended Next Steps. Keep it under 200 words. Base it
strictly on the data below — do not invent details.

Incident: {incident}
Severity/category: {severity} / {category}
Entities: {entities}
Evidence used: {evidence}
Hypothesis: {hypothesis}
Groundedness: {critique}
"""


def report_writer_node(state: dict) -> dict:
    llm = get_llm()
    resp = llm.invoke(
        PROMPT.format(
            incident=state["raw_input"],
            severity=state.get("severity", "unknown"),
            category=state.get("category", "unknown"),
            entities=state.get("entities", {}),
            evidence=[r["text"][:150] for r in state.get("retrieved", [])],
            hypothesis=state.get("hypothesis", ""),
            critique=state.get("critique", {}),
        )
    )
    return {"report": resp.content.strip()}
