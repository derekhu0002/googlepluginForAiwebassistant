from fastapi.testclient import TestClient
from unittest.mock import AsyncMock

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

    assert response.status_code == 500
    assert response.json() == {
        "ok": False,
        "error": {
            "code": "SESSION_AGENT_ENFORCEMENT_ERROR",
            "message": "TARA primary agent enforcement failed: remote session reported primary agent 'other_agent'",
        },
    }


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

    assert response.status_code == 500
    assert response.json() == {
        "ok": False,
        "error": {
            "code": "SESSION_AGENT_ENFORCEMENT_ERROR",
            "message": "TARA primary agent guard failed: missing agent",
        },
    }
