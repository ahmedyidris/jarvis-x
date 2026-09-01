import requests
from unittest.mock import patch, MagicMock
from code.reply.tools.system_stats import SystemStatsTool


def test_system_stats_success():
    tool = SystemStatsTool()
    fake_resp = MagicMock()
    fake_resp.json.return_value = {"cpu_load": [0.1, 0.2, 0.1], "cpu_count": 4}
    fake_resp.raise_for_status.return_value = None
    with patch("requests.get", return_value=fake_resp):
        result = tool.execute({})
    assert result["cpu_count"] == 4


def test_system_stats_connection_failure():
    tool = SystemStatsTool()
    with patch("requests.get", side_effect=requests.Timeout("slow")):
        result = tool.execute({})
    assert "error" in result
