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
    monkeypatch.setattr(main.adapter, "start_run", AsyncMock(return_value="run-1"))
    monkeypatch.setattr(main.adapter, "stream_events", fake_stream_events)
    monkeypatch.setattr(main.adapter, "submit_answer", submit_answer)

    response = client.post(
        "/api/runs",
        json={
            "prompt": "hello",
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


def test_start_run_surfaces_session_agent_enforcement_error(monkeypatch) -> None:
    monkeypatch.setattr(main.adapter, "start_run", AsyncMock(side_effect=RuntimeError("TARA primary agent enforcement failed: remote session reported primary agent 'other_agent'")))

    response = client.post(
        "/api/runs",
        json={
            "prompt": "hello",
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
    assert "opencode 主分析代理预检失败" in payload["error"]["message"]
    assert "other_agent" in payload["error"]["message"]


def test_health_exposes_runtime_defaults(monkeypatch) -> None:
    monkeypatch.delenv("OPENCODE_BASE_URL", raising=False)
    monkeypatch.setattr(main, "settings", Settings())

    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["opencode_base_url"] == "http://localhost:8123"
    assert payload["opencode_health_endpoint"] == "/global/health"
    assert payload["opencode_global_event_endpoint"] == "/global/event"
    assert isinstance(payload["use_mock_opencode"], bool)
    assert isinstance(payload["allow_mock_fallback"], bool)
    assert payload["invocation_log_path"].endswith("python_adapter/logs/invocations.jsonl")


def test_start_run_returns_explicit_error_when_primary_agent_guard_fails(monkeypatch) -> None:
    monkeypatch.setattr(main.adapter, "start_run", AsyncMock(side_effect=RuntimeError("TARA primary agent guard failed: missing agent")))

    response = client.post(
        "/api/runs",
        json={
            "prompt": "hello",
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
    assert "opencode 主分析代理预检失败" in payload["error"]["message"]
    assert "missing agent" in payload["error"]["message"]


def test_start_run_keeps_unexpected_runtime_errors_as_internal_server_error(monkeypatch) -> None:
    monkeypatch.setattr(main.adapter, "start_run", AsyncMock(side_effect=RuntimeError("unexpected session bootstrap failure")))

    response = client.post(
        "/api/runs",
        json={
            "prompt": "hello",
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
