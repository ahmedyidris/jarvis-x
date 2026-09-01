import requests
from unittest.mock import patch, MagicMock
from code.reply.tools.weather import WeatherTool


def test_weather_success():
    tool = WeatherTool()
    fake_resp = MagicMock()
    fake_resp.json.return_value = {"temp_c": "28", "condition": "Sunny", "city": "Cairo"}
    fake_resp.raise_for_status.return_value = None
    with patch("requests.get", return_value=fake_resp):
        result = tool.execute({})
    assert result == {"temp_c": "28", "condition": "Sunny", "city": "Cairo"}


def test_weather_backend_returns_error_shape():
    tool = WeatherTool()
    fake_resp = MagicMock()
    fake_resp.json.return_value = {"error": "wttr.in unreachable"}
    fake_resp.raise_for_status.return_value = None
    with patch("requests.get", return_value=fake_resp):
        result = tool.execute({})
    assert "error" in result


def test_weather_connection_failure():
    tool = WeatherTool()
    with patch("requests.get", side_effect=requests.ConnectionError("refused")):
        result = tool.execute({})
    assert "error" in result
    assert "unavailable" in result["error"]


def test_weather_non_dict_response_does_not_raise():
    """Regression test: backend returns non-dict JSON (e.g. null, number, bool).

    This used to raise TypeError: argument of type 'NoneType' is not iterable
    when checking `"error" in data`. Now we gracefully handle it as malformed data.
    """
    tool = WeatherTool()
    fake_resp = MagicMock()
    fake_resp.json.return_value = None
    fake_resp.raise_for_status.return_value = None
    with patch("requests.get", return_value=fake_resp):
        result = tool.execute({})
    # Should return a dict with error, not None or the raw non-dict data
    assert isinstance(result, dict)
    assert "error" in result
    assert "invalid data" in result["error"]
