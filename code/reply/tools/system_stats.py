from code.reply.tools.base import Tool

import requests

SYSTEM_STATS_URL = "http://127.0.0.1:8002/api/system"


class SystemStatsTool(Tool):
    name = "getSystemStats"
    description = "Get current CPU load, memory, disk usage, and uptime for this machine."
    property_keys = ()

    def execute(self, args: dict) -> dict:
        try:
            resp = requests.get(SYSTEM_STATS_URL, timeout=10)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            return {"error": f"system stats backend unavailable: {e}"}
