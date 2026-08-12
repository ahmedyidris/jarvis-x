"""Wires the five agents into a LangGraph StateGraph:

    triage -> retriever -> hypothesis -> critic --(ungrounded, <2 revisions)--> hypothesis
                                             \--(grounded, or out of revisions)--> report_writer -> END
"""
from langgraph.graph import StateGraph, END

from app.state import IncidentState
from agents.triage import triage_node
from agents.retriever import retriever_node
from agents.hypothesis import hypothesis_node
from agents.critic import critic_node
from agents.report_writer import report_writer_node

MAX_REVISIONS = 2


def _route_after_critic(state: IncidentState) -> str:
    critique = state.get("critique", {})
    if critique.get("grounded", True):
        return "report_writer"
    if state.get("revisions", 0) >= MAX_REVISIONS:
        return "report_writer"  # ship the best attempt rather than loop forever
    return "hypothesis"


def build_graph():
    graph = StateGraph(IncidentState)
    graph.add_node("triage", triage_node)
    graph.add_node("retriever", retriever_node)
    graph.add_node("hypothesis", hypothesis_node)
    graph.add_node("critic", critic_node)
    graph.add_node("report_writer", report_writer_node)

    graph.set_entry_point("triage")
    graph.add_edge("triage", "retriever")
    graph.add_edge("retriever", "hypothesis")
    graph.add_edge("hypothesis", "critic")
    graph.add_conditional_edges(
        "critic", _route_after_critic, {"hypothesis": "hypothesis", "report_writer": "report_writer"}
    )
    graph.add_edge("report_writer", END)
    return graph.compile()
