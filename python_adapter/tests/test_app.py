from fastapi.testclient import TestClient
from unittest.mock import AsyncMock
import httpx

from python_adapter.app import main
from python_adapter.app.config import Settings
from python_adapter.app.models import NormalizedRunEvent

from python_adapter.app.main import app


client = TestClient(app)


def test_start_run_and_answer_flow(monkeypatch) -> None:
    async def fake_stream_events(_run_id: str):
        yield NormalizedRunEvent(
            id="run-1-1",
            runId="run-1",
            type="thinking",
            createdAt="2026-04-01T00:00:00.000Z",
            sequence=1,
            message="thinking",
            title="分析中",
        )
        yield NormalizedRunEvent(
            id="run-1-2",
            runId="run-1",
            type="question",
            createdAt="2026-04-01T00:00:01.000Z",
            sequence=2,
            message="question",
            title="需要确认",
            question={
                "questionId": "question-1",
                "title": "需要确认",
                "message": "question",
                "options": [],
                "allowFreeText": True,
            },
        )

    submit_answer = AsyncMock(return_value=None)

    async def fake_start_run(_request):
        main.adapter._runs["run-1"] = {"session_id": "ses-1", "selected_agent": "TARA_analyst"}
        return "run-1"

    monkeypatch.setattr(main.adapter, "start_run", fake_start_run)
    monkeypatch.setattr(main.adapter, "stream_events", fake_stream_events)
    monkeypatch.setattr(main.adapter, "submit_answer", submit_answer)

    response = client.post(
        "/api/runs",
        json={
            "prompt": "hello",
            "selectedAgent": "TARA_analyst",
            "sessionId": "ses-1",
            "capture": {
                "pageTitle": "Example",
                "pageUrl": "https://example.com",
                "software_version": "v1.0.0",
                "selected_sr": "SR-1",
            },
            "context": {
                "source": "chrome-extension",
                "capturedAt": "2026-04-01T00:00:00.000Z",
                "username": "alice",
                "usernameSource": "dom_text",
                "pageTitle": "Example",
                "pageUrl": "https://example.com",
            },
        },
    )
    assert response.status_code == 200
    run_id = response.json()["data"]["runId"]
    assert response.json()["data"]["sessionId"] == "ses-1"
    assert response.json()["data"]["selectedAgent"] == "TARA_analyst"

    with client.stream("GET", f"/api/runs/{run_id}/events") as stream_response:
        body = "".join(chunk.decode() if isinstance(chunk, bytes) else chunk for chunk in stream_response.iter_text())
        assert "thinking" in body
        assert "question" in body

    answer_response = client.post(
        f"/api/runs/{run_id}/answers",
        json={"questionId": "question-1", "answer": "high", "choiceId": "p1"},
    )
    assert answer_response.status_code == 200
    assert answer_response.json()["data"]["accepted"] is True
    submit_answer.assert_awaited_once()


def test_start_run_returns_active_session_id(monkeypatch) -> None:
    async def fake_start_run(request):
        main.adapter._runs["run-1"] = {"session_id": request.sessionId, "selected_agent": request.selectedAgent}
        return "run-1"

    monkeypatch.setattr(main.adapter, "start_run", fake_start_run)

    response = client.post(
        "/api/runs",
        json={
            "prompt": "hello",
            "selectedAgent": "TARA_analyst",
            "sessionId": "ses-active",
            "capture": {},
            "context": {
                "source": "chrome-extension",
                "capturedAt": "2026-04-01T00:00:00.000Z",
                "username": "alice",
                "usernameSource": "dom_text",
            },
        },
    )

    assert response.status_code == 200
    assert response.json()["data"] == {"runId": "run-1", "sessionId": "ses-active", "selectedAgent": "TARA_analyst"}


def test_start_run_surfaces_session_agent_enforcement_error(monkeypatch) -> None:
    monkeypatch.setattr(main.adapter, "start_run", AsyncMock(side_effect=RuntimeError("Remote canonical agent mismatch: remote session reported agent 'other_agent', expected canonical remote agent 'TARA_analyst'")))

    response = client.post(
        "/api/runs",
        json={
            "prompt": "hello",
            "selectedAgent": "TARA_analyst",
            "capture": {
                "pageTitle": "Example",
                "pageUrl": "https://example.com",
                "software_version": "v1.0.0",
                "selected_sr": "SR-1",
            },
            "context": {
                "source": "chrome-extension",
                "capturedAt": "2026-04-01T00:00:00.000Z",
                "username": "alice",
                "usernameSource": "dom_text",
                "pageTitle": "Example",
                "pageUrl": "https://example.com",
            },
        },
    )

    assert response.status_code == 502
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "ANALYSIS_ERROR"
    assert "opencode 真实运行时 agent 与远端 /agent 选定 canonical agent 不一致" in payload["error"]["message"]
    assert "other_agent" in payload["error"]["message"]


def test_health_exposes_runtime_defaults(monkeypatch) -> None:
    monkeypatch.delenv("OPENCODE_BASE_URL", raising=False)
    monkeypatch.setattr(main, "settings", Settings())

    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["opencode_base_url"] == "http://localhost:8124"
    assert payload["opencode_health_endpoint"] == "/global/health"
    assert payload["opencode_global_event_endpoint"] == "/global/event"
    assert payload["opencode_agent_list_endpoint"] == "/agent"
    assert isinstance(payload["use_mock_opencode"], bool)
    assert isinstance(payload["allow_mock_fallback"], bool)
    assert payload["invocation_log_path"].endswith("python_adapter/logs/invocations.jsonl")


def test_start_run_returns_explicit_error_when_remote_agent_discovery_fails(monkeypatch) -> None:
    monkeypatch.setattr(main.adapter, "start_run", AsyncMock(side_effect=RuntimeError("Remote /agent discovery failed: target analyst agent not found in remote catalog")))

    response = client.post(
        "/api/runs",
        json={
            "prompt": "hello",
            "selectedAgent": "TARA_analyst",
            "capture": {
                "pageTitle": "Example",
                "pageUrl": "https://example.com",
                "software_version": "v1.0.0",
                "selected_sr": "SR-1",
            },
            "context": {
                "source": "chrome-extension",
                "capturedAt": "2026-04-01T00:00:00.000Z",
                "username": "alice",
                "usernameSource": "dom_text",
                "pageTitle": "Example",
                "pageUrl": "https://example.com",
            },
        },
    )

    assert response.status_code == 502
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "ANALYSIS_ERROR"
    assert "opencode 远端 /agent 能力探测失败" in payload["error"]["message"]
    assert "target analyst agent not found" in payload["error"]["message"]


def test_start_run_keeps_unexpected_runtime_errors_as_internal_server_error(monkeypatch) -> None:
    monkeypatch.setattr(main.adapter, "start_run", AsyncMock(side_effect=RuntimeError("unexpected session bootstrap failure")))

    response = client.post(
        "/api/runs",
        json={
            "prompt": "hello",
            "selectedAgent": "TARA_analyst",
            "capture": {
                "pageTitle": "Example",
                "pageUrl": "https://example.com",
                "software_version": "v1.0.0",
                "selected_sr": "SR-1",
            },
            "context": {
                "source": "chrome-extension",
                "capturedAt": "2026-04-01T00:00:00.000Z",
                "username": "alice",
                "usernameSource": "dom_text",
                "pageTitle": "Example",
                "pageUrl": "https://example.com",
            },
        },
    )

    assert response.status_code == 500
    assert response.json() == {
        "ok": False,
        "error": {
            "code": "ANALYSIS_ERROR",
            "message": "unexpected session bootstrap failure",
        },
    }


def test_start_run_rejects_disallowed_selected_agent(monkeypatch) -> None:
    monkeypatch.setattr(main.adapter, "start_run", AsyncMock(side_effect=RuntimeError("Requested main agent is not allowed: 'OtherAgent'; allowed=['TARA_analyst', 'ThreatIntelliganceCommander']")))

    response = client.post(
        "/api/runs",
        json={
            "prompt": "hello",
            "selectedAgent": "OtherAgent",
            "capture": {},
            "context": {
                "source": "chrome-extension",
                "capturedAt": "2026-04-01T00:00:00.000Z",
                "username": "alice",
                "usernameSource": "dom_text",
            },
        },
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_start_run_rejects_when_requested_agent_missing_from_remote_catalog(monkeypatch) -> None:
    monkeypatch.setattr(main.adapter, "start_run", AsyncMock(side_effect=RuntimeError("Remote /agent discovery failed: requested agent is unavailable in remote catalog; requested='ThreatIntelliganceCommander'; got ['TARA_analyst']")))

    response = client.post(
        "/api/runs",
        json={
            "prompt": "hello",
            "selectedAgent": "ThreatIntelliganceCommander",
            "capture": {},
            "context": {
                "source": "chrome-extension",
                "capturedAt": "2026-04-01T00:00:00.000Z",
                "username": "alice",
                "usernameSource": "dom_text",
            },
        },
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "ANALYSIS_ERROR"
    assert "用户所选主 AGENT" in response.json()["error"]["message"]


def test_message_feedback_proxies_to_backend_boundary(monkeypatch) -> None:
    captured_request: dict[str, object] = {}
    original_async_client = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        captured_request["url"] = str(request.url)
        captured_request["headers"] = dict(request.headers)
        captured_request["json"] = __import__("json").loads(request.content.decode())
        return httpx.Response(
            200,
            json={
                "ok": True,
                "data": {
                    "accepted": True,
                    "runId": "run-1",
                    "messageId": "message-1",
                    "feedback": "like",
                    "updatedAt": "2026-04-08T00:00:00.000Z",
                },
            },
        )

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            self._client = original_async_client(transport=httpx.MockTransport(handler))

        async def __aenter__(self):
            return self._client

        async def __aexit__(self, exc_type, exc, tb) -> None:
            await self._client.aclose()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(main, "settings", Settings(api_key="secret-key", feedback_backend_base_url="http://127.0.0.1:8787"))

    response = client.post(
        "/api/message-feedback",
        headers={"x-api-key": "secret-key"},
        json={"runId": "run-1", "messageId": "message-1", "feedback": "like"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["feedback"] == "like"
    assert captured_request["url"] == "http://127.0.0.1:8787/api/message-feedback"
    assert captured_request["json"] == {"runId": "run-1", "messageId": "message-1", "feedback": "like"}
    assert captured_request["headers"]["x-api-key"] == "secret-key"


def test_message_feedback_surfaces_backend_failure(monkeypatch) -> None:
    original_async_client = httpx.AsyncClient

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            502,
            json={"ok": False, "error": {"code": "ANALYSIS_ERROR", "message": "feedback backend unavailable"}},
        )

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs) -> None:
            self._client = original_async_client(transport=httpx.MockTransport(handler))

        async def __aenter__(self):
            return self._client

        async def __aexit__(self, exc_type, exc, tb) -> None:
            await self._client.aclose()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeAsyncClient)

    response = client.post(
        "/api/message-feedback",
        json={"runId": "run-1", "messageId": "message-1", "feedback": "dislike"},
    )

    assert response.status_code == 502
    assert response.json() == {
        "ok": False,
        "error": {"code": "ANALYSIS_ERROR", "message": "feedback backend unavailable"},
    }


def test_stream_events_returns_404_for_unknown_run() -> None:
    response = client.get("/api/runs/run-missing/events")

    assert response.status_code == 404
    assert response.json() == {
        "ok": False,
        "error": {
            "code": "RUN_NOT_FOUND",
            "message": "Run 'run-missing' 不存在或已过期，请重新发起新的 run。",
        },
    }


def test_submit_answer_returns_404_for_unknown_run() -> None:
    response = client.post(
        "/api/runs/run-missing/answers",
        json={"questionId": "question-1", "answer": "high", "choiceId": "p1"},
    )

    assert response.status_code == 404
    assert response.json() == {
        "ok": False,
        "error": {
            "code": "RUN_NOT_FOUND",
            "message": "Run 'run-missing' 不存在或已过期，请重新发起新的 run。",
        },
    }
