"""FastAPI entrypoint: POST /incident runs the full agent graph and
returns the trace + final report. Run with:

    uvicorn app.main:app --reload --port 8420
"""
from fastapi import FastAPI
from pydantic import BaseModel

from app.graph import build_graph

app = FastAPI(title="Sentinel", description="Autonomous incident response copilot")
_graph = build_graph()


class IncidentRequest(BaseModel):
    text: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/incident")
def run_incident(req: IncidentRequest):
    result = _graph.invoke({"raw_input": req.text, "revisions": 0})
    return result
