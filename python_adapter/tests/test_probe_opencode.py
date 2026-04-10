import json
from urllib.error import HTTPError

from python_adapter.scripts import probe_opencode
from python_adapter.scripts.probe_opencode import is_valid_agent_response, is_valid_health_response


def test_probe_rejects_html_200() -> None:
    assert is_valid_health_response("text/html", "<!doctype html><html></html>") is False


def test_probe_accepts_json_health_payload() -> None:
    payload = json.dumps({"status": "ok", "version": "1.3.10"})
    assert is_valid_health_response("application/json", payload) is True


def test_probe_accepts_agent_catalog_payload() -> None:
    payload = json.dumps({"agents": [{"id": "TARA_analyst"}]})
    assert is_valid_agent_response(payload) is True


def test_probe_rejects_invalid_agent_catalog_payload() -> None:
    payload = json.dumps({"ok": True})
    assert is_valid_agent_response(payload) is False


class _FakeResponse:
    def __init__(self, status: int, body: str, content_type: str = "application/json") -> None:
        self.status = status
        self._body = body.encode("utf-8")
        self.headers = {"Content-Type": content_type}

    def read(self, _limit: int) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


def test_probe_main_requires_both_health_and_agent_checks(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        probe_opencode,
        "get_settings",
        lambda: ("http://opencode.test", "/global/health", "/agent", "/repo path", None),
    )

    def fake_urlopen(url: str, timeout: int):
        assert timeout == 5
        if url == "http://opencode.test/global/health":
            return _FakeResponse(200, json.dumps({"ok": True, "version": "1.3.10"}))
        if url == "http://opencode.test/agent?directory=%2Frepo%20path":
            return _FakeResponse(200, json.dumps({"ok": True}))
        if url == "http://opencode.test/":
            return _FakeResponse(200, "root ok", "text/plain")
        raise AssertionError(f"unexpected url: {url}")

    monkeypatch.setattr(probe_opencode.request, "urlopen", fake_urlopen)

    exit_code = probe_opencode.main()
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 1
    assert output["ok"] is False
    assert any(item["kind"] == "health" and item["ok"] is True for item in output["attempts"])
    assert any(item["kind"] == "agent" and item["ok"] is False for item in output["attempts"])


def test_probe_main_accepts_health_and_agent_checks(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        probe_opencode,
        "get_settings",
        lambda: ("http://opencode.test", "/global/health", "/agent", "/repo", "wk"),
    )

    def fake_urlopen(url: str, timeout: int):
        assert timeout == 5
        if url == "http://opencode.test/global/health":
            return _FakeResponse(200, json.dumps({"status": "ok"}))
        if url == "http://opencode.test/agent?directory=%2Frepo&workspace=wk":
            return _FakeResponse(200, json.dumps({"agents": [{"id": "TARA_analyst"}]}))
        if url == "http://opencode.test/":
            return _FakeResponse(200, "root ok", "text/plain")
        raise AssertionError(f"unexpected url: {url}")

    monkeypatch.setattr(probe_opencode.request, "urlopen", fake_urlopen)

    exit_code = probe_opencode.main()
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert output["ok"] is True
    assert output["workspace"] == "wk"
    assert any(item["kind"] == "agent" and item["ok"] is True for item in output["attempts"])


def test_probe_main_records_http_error_for_agent_check(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        probe_opencode,
        "get_settings",
        lambda: ("http://opencode.test", "/global/health", "/agent", "/repo", None),
    )

    def fake_urlopen(url: str, timeout: int):
        assert timeout == 5
        if url == "http://opencode.test/global/health":
            return _FakeResponse(200, json.dumps({"status": "ok"}))
        if url == "http://opencode.test/agent?directory=%2Frepo":
            raise HTTPError(url, 503, "Service Unavailable", hdrs=None, fp=None)
        if url == "http://opencode.test/":
            return _FakeResponse(200, "root ok", "text/plain")
        raise AssertionError(f"unexpected url: {url}")

    monkeypatch.setattr(probe_opencode.request, "urlopen", fake_urlopen)

    exit_code = probe_opencode.main()
    output = json.loads(capsys.readouterr().out)

    assert exit_code == 1
    agent_attempt = next(item for item in output["attempts"] if item["kind"] == "agent")
    assert agent_attempt["status_code"] == 503
    assert agent_attempt["ok"] is False
