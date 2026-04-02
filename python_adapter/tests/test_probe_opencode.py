import json

from python_adapter.scripts.probe_opencode import is_valid_health_response


def test_probe_rejects_html_200() -> None:
    assert is_valid_health_response("text/html", "<!doctype html><html></html>") is False


def test_probe_accepts_json_health_payload() -> None:
    payload = json.dumps({"status": "ok", "version": "1.3.10"})
    assert is_valid_health_response("application/json", payload) is True
