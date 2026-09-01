"""Orchestrates the tool-calling loop: fast-path skip -> tool router ->
planner -> resolve/execute -> digest -> final synthesis. A drop-in
replacement for a direct hermes.ask(question, model, system=system_msg)
call -- same return type, same HermesBackendError failure mode."""
from code.reply import tool_router, planner, resolver, digest
from code.reply.tools.weather import WeatherTool
from code.reply.tools.system_stats import SystemStatsTool

FAST_PATH_MAX_WORDS = 8

ALL_TOOLS = [WeatherTool(), SystemStatsTool()]


def handle(question: str, model: str, system_msg: str, hermes) -> str:
    candidate_tools = tool_router.route(question, ALL_TOOLS)

    if not candidate_tools and len(question.split()) <= FAST_PATH_MAX_WORDS:
        return hermes.ask(question, model, system=system_msg)

    steps = planner.plan_query(question, candidate_tools, model, hermes)
    if not steps or (len(steps) == 1 and steps[0].strip().lower() == "reply to the user."):
        return hermes.ask(question, model, system=system_msg)

    result_blocks = []
    for step in steps:
        call = resolver.resolve_next_tool_call(step, candidate_tools, model, hermes)
        if call is None:
            continue
        tool = next((t for t in candidate_tools if t.name == call.get("name")), None)
        if tool is None:
            continue
        try:
            raw_result = tool.execute(call.get("arguments") or {})
        except Exception as e:
            raw_result = {"error": str(e)}
        if not isinstance(raw_result, dict):
            # A tool that doesn't honor its contract shouldn't be able to
            # crash the whole reply -- fail open with a note instead.
            result_blocks.append(
                f"TOOL_ERROR: {tool.name} returned an unexpected result type "
                f"({type(raw_result).__name__})"
            )
            continue
        if "error" in raw_result:
            result_blocks.append(f"TOOL_ERROR: {tool.name} unavailable ({raw_result['error']})")
            continue
        result_blocks.append(
            digest.tool_result_digest(tool.name, raw_result, question, model, hermes)
        )

    plan_block = "ACTION PLAN:\n" + "\n".join(f"- {s}" for s in steps)
    full_system = system_msg + "\n\n" + plan_block
    if result_blocks:
        full_system += "\n\n" + "\n".join(result_blocks)

    return hermes.ask(question, model, system=full_system)
