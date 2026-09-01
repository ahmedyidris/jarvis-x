import requests

from code.reply.tools.base import Tool

WEATHER_URL = "http://127.0.0.1:8002/api/weather"


class WeatherTool(Tool):
    name = "getWeather"
    description = "Get current weather conditions for the configured city."
    property_keys = ()

    def execute(self, args: dict) -> dict:
        try:
            resp = requests.get(WEATHER_URL, timeout=10)
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as e:
            return {"error": f"weather backend unavailable: {e}"}
        if "error" in data:
            return {"error": f"weather backend error: {data['error']}"}
        return data
