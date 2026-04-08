from __future__ import annotations

from collections import deque
from pathlib import Path

import httpx
import anyio
import pytest

from python_adapter.app.config import Settings
from python_adapter.app.models import QuestionAnswerRequest, RunContext, RunStartRequest
from python_adapter.app.opencode_adapter import OpencodeAdapter


def create_request() -> RunStartRequest:
    return RunStartRequest(
        prompt="hello from adapter",
        capture={
            "pageTitle": "Example",
            "pageUrl": "https://example.com",
            "software_version": "v1.0.0",
            "selected_sr": "SR-1",
        },
        context=RunContext(
            source="chrome-extension",
            capturedAt="2026-04-01T00:00:00.000Z",
            username="alice",
            usernameSource="dom_text",
            pageTitle="Example",
            pageUrl="https://example.com",
        ),
    )


def create_request_without_capture() -> RunStartRequest:
    return RunStartRequest(
        prompt="hello from adapter",
        context=RunContext(
            source="chrome-extension",
            capturedAt="2026-04-01T00:00:00.000Z",
            username="unknown",
            usernameSource="unresolved_login_state",
        ),
    )


class FakeStreamContext:
    def __init__(self, response: httpx.Response) -> None:
        self._response = response

    async def __aenter__(self) -> httpx.Response:
        return self._response

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


class FakeAsyncClient:
    def __init__(self, responses: list[tuple[str, str, httpx.Response | Exception]]) -> None:
        self._responses = deque(responses)
        self.calls: list[tuple[str, str, dict | None, dict | None]] = []

    async def __aenter__(self) -> "FakeAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def post(self, url: str, *, params=None, json=None):
        self.calls.append(("POST", url, params, json))
        return self._take("POST", url)

    async def get(self, url: str, *, params=None):
        self.calls.append(("GET", url, params, None))
        return self._take("GET", url)

    def stream(self, method: str, url: str, *, params=None):
        self.calls.append((method, url, params, None))
        response = self._take(method, url)
        if isinstance(response, Exception):
            raise response
        return FakeStreamContext(response)

    def _take(self, method: str, url: str):
        expected_method, expected_url, result = self._responses.popleft()
        assert expected_method == method
        assert expected_url == url
        if isinstance(result, Exception):
            raise result
        return result


def make_response(method: str, url: str, *, status_code: int = 200, json_body=None, text_body: str | None = None, headers: dict[str, str] | None = None) -> httpx.Response:
    request = httpx.Request(method, f"http://testserver{url}")
    if json_body is not None:
        return httpx.Response(status_code, json=json_body, headers=headers, request=request)
    return httpx.Response(status_code, text=text_body or "", headers=headers, request=request)


def make_sse_response(events: list[dict]) -> httpx.Response:
    body = "\n\n".join(f"data: {payload}" for payload in [__import__("json").dumps(event) for event in events]) + "\n\n"
    request = httpx.Request("GET", "http://testserver/global/event")
    return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"}, request=request)


def test_real_contract_uses_session_prompt_async_and_question_reply() -> None:
    session_payload = {
        "id": "ses-1",
        "slug": "slug",
        "projectID": "proj",
        "directory": "/repo",
        "title": "title",
        "version": "1.3.10",
        "time": {"created": 1, "updated": 1},
    }
    sse_events = [
        {"directory": "/repo", "payload": {"type": "session.status", "properties": {"sessionID": "ses-1", "status": {"type": "busy"}}}},
        {"directory": "/repo", "payload": {"type": "question.asked", "properties": {"id": "req-1", "sessionID": "ses-1", "questions": [{"header": "请选择优先级", "question": "当前请求优先级是什么？", "options": [{"label": "高", "description": "高优"}], "custom": True}]}}},
        {"directory": "/repo", "payload": {"type": "question.replied", "properties": {"sessionID": "ses-1", "requestID": "req-1", "answers": [["高"]]}}},
        {"directory": "/repo", "payload": {"type": "message.part.delta", "agent": "TARA_analyst", "properties": {"sessionID": "ses-1", "messageID": "msg-1", "partID": "part-1", "field": "text", "delta": "partial result"}}},
        {"directory": "/repo", "payload": {"type": "session.idle", "properties": {"sessionID": "ses-1"}}},
    ]
    messages_payload = [
        {
            "agent": "TARA_analyst",
            "info": {"id": "msg-1", "sessionID": "ses-1", "role": "assistant", "time": {"created": 1, "completed": 2}},
            "parts": [{"type": "text", "text": "final answer from session"}],
        }
    ]

    clients: list[FakeAsyncClient] = []
    response_sets = [
        [("POST", "/session", make_response("POST", "/session", json_body=session_payload))],
        [("POST", "/session/ses-1/prompt_async", make_response("POST", "/session/ses-1/prompt_async", status_code=204))],
        [
            ("GET", "/global/event", make_sse_response(sse_events)),
        ],
        [("POST", "/question/req-1/reply", make_response("POST", "/question/req-1/reply", json_body=True))],
        [("GET", "/session/ses-1/message", make_response("GET", "/session/ses-1/message", json_body=messages_payload))],
    ]

    def factory(_timeout):
        client = FakeAsyncClient(response_sets.pop(0))
        clients.append(client)
        return client

    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=factory)
        run_id = await adapter.start_run(create_request())
        events = []
        stream = adapter.stream_events(run_id)
        events.append(await stream.__anext__())
        events.append(await stream.__anext__())
        events.append(await stream.__anext__())
        assert events[-1].type == "thinking"
        events.append(await stream.__anext__())
        assert events[-1].type == "question"
        await adapter.submit_answer(run_id, QuestionAnswerRequest(questionId="req-1", answer="高"))
        remaining = [event async for event in stream]

        all_events = events + remaining
        assert [event.type for event in all_events] == ["thinking", "tool_call", "thinking", "question", "thinking", "thinking", "result"]
        assert all_events[-1].message == "final answer from session"
        assert clients[0].calls[0][1] == "/session"
        assert clients[0].calls[0][3] == {
            "title": "SR SR-1",
        }
        assert clients[1].calls[0][1] == "/session/ses-1/prompt_async"
        assert clients[1].calls[0][3] == {
            "agent": "TARA_analyst",
            "parts": [{"type": "text", "text": "hello from adapter"}],
        }
        assert clients[2].calls[0][1] == "/global/event"
        assert clients[3].calls[0][1] == "/question/req-1/reply"
        assert clients[4].calls[0][1] == "/session/ses-1/message"

    anyio.run(scenario)


def test_request_without_capture_defaults_to_generic_session_title() -> None:
    session_payload = {
        "id": "ses-1",
        "slug": "slug",
        "projectID": "proj",
        "directory": "/repo",
        "title": "title",
        "version": "1.3.10",
        "time": {"created": 1, "updated": 1},
    }

    response_sets = [
        [("POST", "/session", make_response("POST", "/session", json_body=session_payload))],
        [("POST", "/session/ses-1/prompt_async", make_response("POST", "/session/ses-1/prompt_async", status_code=204))],
        [("GET", "/global/event", make_sse_response([]))],
    ]

    clients: list[FakeAsyncClient] = []

    def factory(_timeout):
        client = FakeAsyncClient(response_sets.pop(0))
        clients.append(client)
        return client

    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=factory)
        await adapter.start_run(create_request_without_capture())

        assert clients[0].calls[0][3] == {
            "title": "SR analysis",
        }

    anyio.run(scenario)


def test_real_contract_reuses_existing_session_for_follow_up_prompt() -> None:
    response_sets = [
        [("POST", "/session/ses-existing/prompt_async", make_response("POST", "/session/ses-existing/prompt_async", status_code=204))],
    ]

    clients: list[FakeAsyncClient] = []

    def factory(_timeout):
        client = FakeAsyncClient(response_sets.pop(0))
        clients.append(client)
        return client

    async def scenario() -> None:
        request = create_request().model_copy(update={"sessionId": "ses-existing"})
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=factory)
        run_id = await adapter.start_run(request)

        assert run_id.startswith("run-")
        assert len(clients) == 1
        assert clients[0].calls[0][1] == "/session/ses-existing/prompt_async"
        assert adapter._runs[run_id]["session_id"] == "ses-existing"
        assert all(event.data and event.data.get("session_reused") is True for event in adapter._runs[run_id]["events"])

    anyio.run(scenario)


def test_real_path_returns_error_when_session_create_fails() -> None:
    def factory(_timeout):
        return FakeAsyncClient([
            ("POST", "/session", httpx.ConnectError("boom")),
        ])

    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=factory)
        run_id = await adapter.start_run(create_request())
        events = [event async for event in adapter.stream_events(run_id)]

        assert events[-1].type == "error"
        assert "初始化失败" in events[-1].message

    anyio.run(scenario)


def test_explicit_mock_fallback_keeps_flow_when_real_contract_fails() -> None:
    def factory(_timeout):
        return FakeAsyncClient([
            ("POST", "/session", httpx.ConnectError("boom")),
        ])

    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver", allow_mock_fallback=True), client_factory=factory)
        run_id = await adapter.start_run(create_request())
        await adapter.submit_answer(run_id, QuestionAnswerRequest(questionId="question-1", answer="high", choiceId="p1"))
        events = [event async for event in adapter.stream_events(run_id)]

        assert events[-1].type == "result"
        assert events[-1].data is not None
        assert events[-1].data["opencode_mode"] == "mock-fallback"

    anyio.run(scenario)


def test_default_client_factory_disables_environment_proxy_inheritance() -> None:
    adapter = OpencodeAdapter(Settings(opencode_base_url="http://localhost:8123"))
    client = adapter._default_client_factory(30.0)

    try:
        assert client.base_url == httpx.URL("http://localhost:8123")
        assert client.timeout.connect == 30.0
        assert client.trust_env is False
    finally:
        anyio.run(client.aclose)


def test_tool_call_messages_are_simplified_for_users(tmp_path: Path) -> None:
    config_path = tmp_path / "opencode.json"
    agent_path = tmp_path / "TARA_analyst.md"
    config_path.write_text('{"default_agent": "TARA_analyst"}', encoding="utf-8")
    agent_path.write_text("# TARA analyst", encoding="utf-8")

    adapter = OpencodeAdapter(Settings(
        opencode_base_url="http://testserver",
        opencode_config_path=str(config_path),
        opencode_tara_agent_path=str(agent_path),
    ))

    message = adapter._simplify_tool_call_message("grep", "running", "raw title")
    assert message == "正在检索相关信息。"


def test_primary_agent_guard_rejects_wrong_default_agent(tmp_path: Path) -> None:
    config_path = tmp_path / "opencode.json"
    agent_path = tmp_path / "TARA_analyst.md"
    config_path.write_text('{"default_agent": "other_agent"}', encoding="utf-8")
    agent_path.write_text("# TARA analyst", encoding="utf-8")

    adapter = OpencodeAdapter(Settings(
        opencode_base_url="http://testserver",
        opencode_config_path=str(config_path),
        opencode_tara_agent_path=str(agent_path),
    ))

    with pytest.raises(RuntimeError, match="default_agent must be 'TARA_analyst'"):
        adapter._ensure_tara_primary_agent()


def test_primary_agent_guard_rejects_missing_agent_file(tmp_path: Path) -> None:
    config_path = tmp_path / "opencode.json"
    config_path.write_text('{"default_agent": "TARA_analyst"}', encoding="utf-8")

    adapter = OpencodeAdapter(Settings(
        opencode_base_url="http://testserver",
        opencode_config_path=str(config_path),
        opencode_tara_agent_path=str(tmp_path / "missing.md"),
    ))

    with pytest.raises(RuntimeError, match="unable to read"):
        adapter._ensure_tara_primary_agent()


def test_primary_agent_guard_accepts_valid_configuration(tmp_path: Path) -> None:
    config_path = tmp_path / "opencode.json"
    agent_path = tmp_path / "TARA_analyst.md"
    config_path.write_text('{"default_agent": "TARA_analyst"}', encoding="utf-8")
    agent_path.write_text("# TARA analyst", encoding="utf-8")

    adapter = OpencodeAdapter(Settings(
        opencode_base_url="http://testserver",
        opencode_config_path=str(config_path),
        opencode_tara_agent_path=str(agent_path),
    ))

    adapter._ensure_tara_primary_agent()


def test_real_contract_allows_session_payload_without_agent_confirmation() -> None:
    session_payload = {
        "id": "ses-1",
        "slug": "slug",
        "projectID": "proj",
        "directory": "/repo",
        "title": "title",
        "version": "1.3.10",
        "time": {"created": 1, "updated": 1},
    }

    clients: list[FakeAsyncClient] = []
    response_sets = [
        [("POST", "/session", make_response("POST", "/session", json_body=session_payload))],
        [("POST", "/session/ses-1/prompt_async", make_response("POST", "/session/ses-1/prompt_async", status_code=204))],
    ]

    def factory(_timeout):
        client = FakeAsyncClient(response_sets.pop(0))
        clients.append(client)
        return client

    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=factory)
        run_id = await adapter.start_run(create_request())

        assert run_id.startswith("run-")
        assert clients[1].calls[0][1] == "/session/ses-1/prompt_async"
        assert clients[0].calls == [("POST", "/session", {"directory": adapter.settings.opencode_directory}, {"title": "SR SR-1"})]

    anyio.run(scenario)


def test_real_contract_fails_when_message_event_reports_wrong_primary_agent() -> None:
    session_payload = {
        "id": "ses-1",
        "slug": "slug",
        "projectID": "proj",
        "directory": "/repo",
        "title": "title",
        "version": "1.3.10",
        "time": {"created": 1, "updated": 1},
    }

    response_sets = [
        [("POST", "/session", make_response("POST", "/session", json_body=session_payload))],
        [("POST", "/session/ses-1/prompt_async", make_response("POST", "/session/ses-1/prompt_async", status_code=204))],
        [(
            "GET",
            "/global/event",
            make_sse_response([
                {"directory": "/repo", "payload": {"type": "message.part.delta", "agent": "other_agent", "properties": {"sessionID": "ses-1", "messageID": "msg-1", "partID": "part-1", "field": "text", "delta": "partial result"}}}
            ]),
        )],
    ]

    def factory(_timeout):
        return FakeAsyncClient(response_sets.pop(0))

    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=factory)
        run_id = await adapter.start_run(create_request())
        events = [event async for event in adapter.stream_events(run_id)]

        assert events[-1].type == "error"
        assert "other_agent" in events[-1].message
        assert "event message.part.delta" in events[-1].message

    anyio.run(scenario)


def test_real_contract_fails_when_assistant_message_reports_wrong_primary_agent() -> None:
    session_payload = {
        "id": "ses-1",
        "slug": "slug",
        "projectID": "proj",
        "directory": "/repo",
        "title": "title",
        "version": "1.3.10",
        "time": {"created": 1, "updated": 1},
    }
    messages_payload = [
        {
            "agent": "other_agent",
            "info": {"id": "msg-1", "sessionID": "ses-1", "role": "assistant", "time": {"created": 1, "completed": 2}},
            "parts": [{"type": "text", "text": "final answer from session"}],
        }
    ]

    response_sets = [
        [("POST", "/session", make_response("POST", "/session", json_body=session_payload))],
        [("POST", "/session/ses-1/prompt_async", make_response("POST", "/session/ses-1/prompt_async", status_code=204))],
        [(
            "GET",
            "/global/event",
            make_sse_response([
                {"directory": "/repo", "payload": {"type": "session.idle", "properties": {"sessionID": "ses-1"}}}
            ]),
        )],
        [("GET", "/session/ses-1/message", make_response("GET", "/session/ses-1/message", json_body=messages_payload))],
    ]

    def factory(_timeout):
        return FakeAsyncClient(response_sets.pop(0))

    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=factory)
        run_id = await adapter.start_run(create_request())
        events = [event async for event in adapter.stream_events(run_id)]

        assert events[-1].type == "error"
        assert "message msg-1" in events[-1].message
        assert "other_agent" in events[-1].message

    anyio.run(scenario)


def test_real_contract_does_not_fail_when_runtime_omits_agent_evidence() -> None:
    session_payload = {
        "id": "ses-1",
        "slug": "slug",
        "projectID": "proj",
        "directory": "/repo",
        "title": "title",
        "version": "1.3.10",
        "time": {"created": 1, "updated": 1},
    }
    sse_events = [
        {"directory": "/repo", "payload": {"type": "message.part.delta", "properties": {"sessionID": "ses-1", "messageID": "msg-1", "partID": "part-1", "field": "text", "delta": "partial result"}}},
        {"directory": "/repo", "payload": {"type": "session.idle", "properties": {"sessionID": "ses-1"}}},
    ]
    messages_payload = [
        {
            "info": {"id": "msg-1", "sessionID": "ses-1", "role": "assistant", "time": {"created": 1, "completed": 2}},
            "parts": [{"type": "text", "text": "final answer without agent evidence"}],
        }
    ]

    response_sets = [
        [("POST", "/session", make_response("POST", "/session", json_body=session_payload))],
        [("POST", "/session/ses-1/prompt_async", make_response("POST", "/session/ses-1/prompt_async", status_code=204))],
        [("GET", "/global/event", make_sse_response(sse_events))],
        [("GET", "/session/ses-1/message", make_response("GET", "/session/ses-1/message", json_body=messages_payload))],
    ]

    def factory(_timeout):
        return FakeAsyncClient(response_sets.pop(0))

    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=factory)
        run_id = await adapter.start_run(create_request())
        events = [event async for event in adapter.stream_events(run_id)]

        assert events[-1].type == "result"
        assert events[-1].message == "final answer without agent evidence"

    anyio.run(scenario)


def test_real_contract_does_not_preflight_remote_agent_catalog() -> None:
    clients: list[FakeAsyncClient] = []
    session_payload = {
        "id": "ses-1",
        "slug": "slug",
        "projectID": "proj",
        "directory": "/repo",
        "title": "title",
        "version": "1.3.10",
        "time": {"created": 1, "updated": 1},
    }
    response_sets = [
        [("POST", "/session", make_response("POST", "/session", json_body=session_payload))],
        [("POST", "/session/ses-1/prompt_async", make_response("POST", "/session/ses-1/prompt_async", status_code=204))],
    ]

    def factory(_timeout):
        client = FakeAsyncClient(response_sets.pop(0))
        clients.append(client)
        return client

    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=factory)
        run_id = await adapter.start_run(create_request())

        assert run_id.startswith("run-")
        assert len(clients) == 2
        assert clients[0].calls[0][1] == "/session"
        assert clients[1].calls[0][1] == "/session/ses-1/prompt_async"

    anyio.run(scenario)
