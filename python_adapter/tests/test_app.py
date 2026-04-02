from fastapi.testclient import TestClient

from python_adapter.app.main import app


client = TestClient(app)


def test_start_run_and_answer_flow() -> None:
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


def test_health_exposes_runtime_defaults() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["opencode_base_url"] == "http://127.0.0.1:4096"
    assert payload["opencode_health_endpoint"] == "/global/health"
    assert payload["opencode_global_event_endpoint"] == "/global/event"
    assert isinstance(payload["use_mock_opencode"], bool)
    assert isinstance(payload["allow_mock_fallback"], bool)
    assert payload["invocation_log_path"].endswith("python_adapter/logs/invocations.jsonl")
