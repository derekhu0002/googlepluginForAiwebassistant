from __future__ import annotations

from collections import deque
import httpx
import anyio
import pytest

from python_adapter.app.config import Settings
from python_adapter.app.models import QuestionAnswerRequest, RunContext, RunStartRequest
from python_adapter.app.opencode_adapter import OpencodeAdapter, RunNotFoundError


def create_request() -> RunStartRequest:
    return RunStartRequest(
        prompt="hello from adapter",
        selectedAgent="TARA_analyst",
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
        selectedAgent="TARA_analyst",
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


def make_agent_catalog_response(*agents: str, json_body=None, status_code: int = 200) -> httpx.Response:
    if json_body is None:
        json_body = [{"id": agent} for agent in agents]
    return make_response("GET", "/agent", status_code=status_code, json_body=json_body)


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
        [("GET", "/agent", make_agent_catalog_response("TARA_analyst"))],
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
        assert events[-1].type == "tool_call"
        events.append(await stream.__anext__())
        assert events[-1].type == "question"
        await adapter.submit_answer(run_id, QuestionAnswerRequest(questionId="req-1", answer="高"))
        remaining = [event async for event in stream]

        all_events = events + remaining
        assert [event.type for event in all_events] == ["tool_call", "tool_call", "tool_call", "question", "tool_call", "result"]
        assert all_events[-1].message == "final answer from session"
        assert clients[0].calls[0][1] == "/agent"
        assert clients[1].calls[0][1] == "/session"
        assert clients[1].calls[0][3] == {
            "title": "SR SR-1",
        }
        assert clients[2].calls[0][1] == "/session/ses-1/prompt_async"
        assert clients[2].calls[0][3] == {
            "agent": "TARA_analyst",
            "parts": [
                {"type": "text", "text": "hello from adapter"},
                {"type": "text", "text": "[capture]\n{\"pageTitle\": \"Example\", \"pageUrl\": \"https://example.com\", \"software_version\": \"v1.0.0\", \"selected_sr\": \"SR-1\"}"},
                {"type": "text", "text": "[context]\n{\"source\": \"chrome-extension\", \"capturedAt\": \"2026-04-01T00:00:00.000Z\", \"username\": \"alice\", \"usernameSource\": \"dom_text\", \"pageTitle\": \"Example\", \"pageUrl\": \"https://example.com\"}"}
            ],
        }
        assert clients[3].calls[0][1] == "/global/event"
        assert clients[4].calls[0][1] == "/question/req-1/reply"
        assert clients[5].calls[0][1] == "/session/ses-1/message"

    anyio.run(scenario)


def test_start_run_includes_capture_and_context_in_prompt_async_payload() -> None:
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
        [("GET", "/agent", make_agent_catalog_response("TARA_analyst"))],
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
        assert clients[2].calls[0][1] == "/session/ses-1/prompt_async"
        assert clients[2].calls[0][3] == {
            "agent": "TARA_analyst",
            "parts": [
                {"type": "text", "text": "hello from adapter"},
                {"type": "text", "text": "[capture]\n{\"pageTitle\": \"Example\", \"pageUrl\": \"https://example.com\", \"software_version\": \"v1.0.0\", \"selected_sr\": \"SR-1\"}"},
                {"type": "text", "text": "[context]\n{\"source\": \"chrome-extension\", \"capturedAt\": \"2026-04-01T00:00:00.000Z\", \"username\": \"alice\", \"usernameSource\": \"dom_text\", \"pageTitle\": \"Example\", \"pageUrl\": \"https://example.com\"}"}
            ],
        }

    anyio.run(scenario)


def test_reasoning_only_session_message_does_not_become_final_result_text() -> None:
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
        {"directory": "/repo", "payload": {"type": "message.part.delta", "agent": "TARA_analyst", "properties": {"sessionID": "ses-1", "messageID": "msg-1", "partID": "part-1", "field": "text", "delta": "reasoning stream"}}},
        {"directory": "/repo", "payload": {"type": "session.idle", "properties": {"sessionID": "ses-1"}}},
    ]
    messages_payload = [
        {
            "agent": "TARA_analyst",
            "info": {"id": "msg-1", "sessionID": "ses-1", "role": "assistant", "time": {"created": 1, "completed": 2}},
            "parts": [{"type": "reasoning", "text": "reasoning stream"}],
        }
    ]

    response_sets = [
        [("GET", "/agent", make_agent_catalog_response("TARA_analyst"))],
        [("POST", "/session", make_response("POST", "/session", json_body=session_payload))],
        [("POST", "/session/ses-1/prompt_async", make_response("POST", "/session/ses-1/prompt_async", status_code=204))],
        [("GET", "/global/event", make_sse_response(sse_events))],
        [("GET", "/session/ses-1/message", make_response("GET", "/session/ses-1/message", json_body=messages_payload))],
        [("GET", "/session/ses-1/message", make_response("GET", "/session/ses-1/message", json_body=messages_payload))],
    ]

    def factory(_timeout):
        return FakeAsyncClient(response_sets.pop(0))

    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=factory)
        run_id = await adapter.start_run(create_request())

        events = [event async for event in adapter.stream_events(run_id)]

        assert events[-1].type == "result"
        assert events[-1].message == "opencode serve 已完成但未返回可展示文本。"

    anyio.run(scenario)


# @ArchitectureID: ELM-APP-008C
def test_reasoning_part_delta_is_buffered_and_emitted_as_thinking_after_part_type_is_known() -> None:
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
        {"directory": "/repo", "payload": {"type": "message.part.delta", "agent": "TARA_analyst", "properties": {"sessionID": "ses-1", "messageID": "msg-1", "partID": "part-1", "field": "text", "delta": "reasoning stream"}}},
        {"directory": "/repo", "payload": {"type": "message.part.updated", "agent": "TARA_analyst", "properties": {"sessionID": "ses-1", "messageID": "msg-1", "part": {"id": "part-1", "type": "reasoning", "text": "reasoning stream"}}}},
        {"directory": "/repo", "payload": {"type": "session.idle", "properties": {"sessionID": "ses-1"}}},
    ]
    messages_payload = [
        {
            "agent": "TARA_analyst",
            "info": {"id": "msg-1", "sessionID": "ses-1", "role": "assistant", "time": {"created": 1, "completed": 2}},
            "parts": [{"type": "reasoning", "text": "reasoning stream"}],
        }
    ]

    response_sets = [
        [("GET", "/agent", make_agent_catalog_response("TARA_analyst"))],
        [("POST", "/session", make_response("POST", "/session", json_body=session_payload))],
        [("POST", "/session/ses-1/prompt_async", make_response("POST", "/session/ses-1/prompt_async", status_code=204))],
        [("GET", "/global/event", make_sse_response(sse_events))],
        [("GET", "/session/ses-1/message", make_response("GET", "/session/ses-1/message", json_body=messages_payload))],
        [("GET", "/session/ses-1/message", make_response("GET", "/session/ses-1/message", json_body=messages_payload))],
    ]

    def factory(_timeout):
        return FakeAsyncClient(response_sets.pop(0))

    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=factory)
        run_id = await adapter.start_run(create_request())

        events = [event async for event in adapter.stream_events(run_id)]

        reasoning_event = next(event for event in events if event.type == "thinking" and event.message == "reasoning stream")
        assert reasoning_event.data is None
        assert reasoning_event.semantic is not None
        assert reasoning_event.semantic.channel == "reasoning"
        assert reasoning_event.semantic.emissionKind == "delta"
        assert reasoning_event.semantic.messageId == "msg-1"
        assert reasoning_event.semantic.partId == "part-1"
        assert reasoning_event.semantic.identity == "reasoning:msg-1:part-1"
        assert events[-1].message == "opencode serve 已完成但未返回可展示文本。"

    anyio.run(scenario)


# @ArchitectureID: ELM-APP-008C
def test_text_part_delta_is_buffered_and_emitted_as_answer_stream_after_part_type_is_known() -> None:
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
        {"directory": "/repo", "payload": {"type": "message.part.delta", "agent": "TARA_analyst", "properties": {"sessionID": "ses-1", "messageID": "msg-1", "partID": "part-1", "field": "text", "delta": "partial result"}}},
        {"directory": "/repo", "payload": {"type": "message.part.updated", "agent": "TARA_analyst", "properties": {"sessionID": "ses-1", "messageID": "msg-1", "part": {"id": "part-1", "type": "text", "text": "partial result"}}}},
        {"directory": "/repo", "payload": {"type": "session.idle", "properties": {"sessionID": "ses-1"}}},
    ]
    messages_payload = [
        {
            "agent": "TARA_analyst",
            "info": {"id": "msg-1", "sessionID": "ses-1", "role": "assistant", "time": {"created": 1, "completed": 2}},
            "parts": [{"type": "text", "text": "final answer from session"}],
        }
    ]

    response_sets = [
        [("GET", "/agent", make_agent_catalog_response("TARA_analyst"))],
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

        text_event = next(event for event in events if event.type == "thinking" and event.message == "partial result")
        assert text_event.data == {"field": "text", "message_id": "msg-1"}
        assert text_event.semantic is not None
        assert text_event.semantic.channel == "assistant_text"
        assert text_event.semantic.emissionKind == "delta"
        assert text_event.semantic.messageId == "msg-1"
        assert text_event.semantic.partId == "part-1"
        assert text_event.semantic.identity == "assistant_text:msg-1:part-1"
        assert events[-1].message == "final answer from session"

        final_event = events[-1]
        assert final_event.semantic is not None
        assert final_event.semantic.channel == "assistant_text"
        assert final_event.semantic.emissionKind == "final"
        assert final_event.semantic.messageId == "msg-1"
        assert final_event.semantic.identity == "assistant_text:msg-1:message-body"

    anyio.run(scenario)


# @ArchitectureID: ELM-APP-008C
def test_tool_part_snapshot_preserves_compact_tool_metadata_and_semantics() -> None:
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
        {"directory": "/repo", "payload": {"type": "message.part.updated", "agent": "TARA_analyst", "properties": {"sessionID": "ses-1", "messageID": "msg-1", "part": {"id": "part-tool-1", "type": "tool", "tool": "bash", "state": {"status": "running", "title": "shell"}}}}},
        {"directory": "/repo", "payload": {"type": "session.idle", "properties": {"sessionID": "ses-1"}}},
    ]
    messages_payload = [
        {
            "agent": "TARA_analyst",
            "info": {"id": "msg-1", "sessionID": "ses-1", "role": "assistant", "time": {"created": 1, "completed": 2}},
            "parts": [{"type": "text", "text": "final answer from session"}],
        }
    ]

    response_sets = [
        [("GET", "/agent", make_agent_catalog_response("TARA_analyst"))],
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

        tool_event = next(event for event in events if event.type == "tool_call" and event.tool is not None)
        assert tool_event.tool is not None
        assert tool_event.tool.name == "bash"
        assert tool_event.tool.status == "running"
        assert tool_event.tool.title == "shell"
        assert tool_event.tool.callId == "part-tool-1"
        assert tool_event.semantic is not None
        assert tool_event.semantic.channel == "tool"
        assert tool_event.semantic.itemKind == "tool"
        assert tool_event.semantic.messageId == "msg-1"
        assert tool_event.semantic.partId == "part-tool-1"
        assert tool_event.semantic.identity == "tool:msg-1:part-tool-1"

    anyio.run(scenario)


def test_message_completed_does_not_emit_result_before_late_text_stream_finishes() -> None:
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
        {"directory": "/repo", "payload": {"type": "message.updated", "agent": "TARA_analyst", "properties": {"sessionID": "ses-1", "info": {"id": "msg-1", "role": "assistant", "time": {"completed": 2}}}}},
        {"directory": "/repo", "payload": {"type": "message.part.delta", "agent": "TARA_analyst", "properties": {"sessionID": "ses-1", "messageID": "msg-1", "partID": "part-1", "field": "text", "delta": "late text"}}},
        {"directory": "/repo", "payload": {"type": "message.part.updated", "agent": "TARA_analyst", "properties": {"sessionID": "ses-1", "messageID": "msg-1", "part": {"id": "part-1", "type": "text", "text": "late text"}}}},
        {"directory": "/repo", "payload": {"type": "session.idle", "properties": {"sessionID": "ses-1"}}},
    ]
    first_messages_payload = [
        {
            "agent": "TARA_analyst",
            "info": {"id": "msg-1", "sessionID": "ses-1", "role": "assistant", "time": {"created": 1, "completed": 2}},
            "parts": [{"type": "reasoning", "text": "still syncing"}],
        }
    ]
    response_sets = [
        [("GET", "/agent", make_agent_catalog_response("TARA_analyst"))],
        [("POST", "/session", make_response("POST", "/session", json_body=session_payload))],
        [("POST", "/session/ses-1/prompt_async", make_response("POST", "/session/ses-1/prompt_async", status_code=204))],
        [("GET", "/global/event", make_sse_response(sse_events))],
        [("GET", "/session/ses-1/message", make_response("GET", "/session/ses-1/message", json_body=first_messages_payload))],
    ]

    def factory(_timeout):
        return FakeAsyncClient(response_sets.pop(0))

    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=factory)
        run_id = await adapter.start_run(create_request())

        events = [event async for event in adapter.stream_events(run_id)]

        assert [event.type for event in events].count("result") == 1
        assert any(event.type == "thinking" and event.message == "late text" for event in events)
        assert events[-1].type == "result"
        assert events[-1].message == "late text"
        assert not any(event.type == "result" and event.message == "opencode serve 已完成但未返回可展示文本。" for event in events)

    anyio.run(scenario)


# @ArchitectureID: ELM-APP-008C
def test_text_part_snapshot_uses_assistant_text_snapshot_semantics() -> None:
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
        {"directory": "/repo", "payload": {"type": "message.part.updated", "agent": "TARA_analyst", "properties": {"sessionID": "ses-1", "messageID": "msg-1", "part": {"id": "part-1", "type": "text", "text": "full snapshot"}}}},
        {"directory": "/repo", "payload": {"type": "session.idle", "properties": {"sessionID": "ses-1"}}},
    ]
    messages_payload = [
        {
            "agent": "TARA_analyst",
            "info": {"id": "msg-1", "sessionID": "ses-1", "role": "assistant", "time": {"created": 1, "completed": 2}},
            "parts": [{"type": "text", "text": "full snapshot"}],
        }
    ]

    response_sets = [
        [("GET", "/agent", make_agent_catalog_response("TARA_analyst"))],
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

        snapshot_event = next(event for event in events if event.type == "thinking" and event.message == "full snapshot")
        assert snapshot_event.semantic is not None
        assert snapshot_event.semantic.channel == "assistant_text"
        assert snapshot_event.semantic.emissionKind == "snapshot"
        assert snapshot_event.semantic.identity == "assistant_text:msg-1:part-1"

    anyio.run(scenario)


def test_session_idle_without_text_defers_placeholder_until_stream_end() -> None:
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
        {"directory": "/repo", "payload": {"type": "session.idle", "properties": {"sessionID": "ses-1"}}},
        {"directory": "/repo", "payload": {"type": "message.part.delta", "agent": "TARA_analyst", "properties": {"sessionID": "ses-1", "messageID": "msg-1", "partID": "part-1", "field": "text", "delta": "late text"}}},
        {"directory": "/repo", "payload": {"type": "message.part.updated", "agent": "TARA_analyst", "properties": {"sessionID": "ses-1", "messageID": "msg-1", "part": {"id": "part-1", "type": "text", "text": "late text"}}}},
    ]
    first_messages_payload = [
        {
            "agent": "TARA_analyst",
            "info": {"id": "msg-1", "sessionID": "ses-1", "role": "assistant", "time": {"created": 1, "completed": 2}},
            "parts": [{"type": "reasoning", "text": "still syncing"}],
        }
    ]
    final_messages_payload = [
        {
            "agent": "TARA_analyst",
            "info": {"id": "msg-1", "sessionID": "ses-1", "role": "assistant", "time": {"created": 1, "completed": 2}},
            "parts": [{"type": "text", "text": "final answer from session"}],
        }
    ]

    response_sets = [
        [("GET", "/agent", make_agent_catalog_response("TARA_analyst"))],
        [("POST", "/session", make_response("POST", "/session", json_body=session_payload))],
        [("POST", "/session/ses-1/prompt_async", make_response("POST", "/session/ses-1/prompt_async", status_code=204))],
        [("GET", "/global/event", make_sse_response(sse_events))],
        [("GET", "/session/ses-1/message", make_response("GET", "/session/ses-1/message", json_body=first_messages_payload))],
        [("GET", "/session/ses-1/message", make_response("GET", "/session/ses-1/message", json_body=final_messages_payload))],
    ]

    def factory(_timeout):
        return FakeAsyncClient(response_sets.pop(0))

    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=factory)
        run_id = await adapter.start_run(create_request())

        events = [event async for event in adapter.stream_events(run_id)]

        assert any(event.type == "tool_call" and event.title == "会话空闲" for event in events)
        assert events[-1].type == "result"
        assert events[-1].message == "final answer from session"
        assert not any(event.type == "result" and event.message == "opencode serve 已完成但未返回可展示文本。" for event in events)

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
        [("GET", "/agent", make_agent_catalog_response("TARA_analyst"))],
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

        assert clients[1].calls[0][3] == {
            "title": "SR analysis",
        }

    anyio.run(scenario)


def test_real_contract_reuses_existing_session_for_follow_up_prompt() -> None:
    response_sets = [
        [("GET", "/agent", make_agent_catalog_response("TARA_analyst"))],
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
        assert len(clients) == 2
        assert clients[0].calls[0][1] == "/agent"
        assert clients[1].calls[0][1] == "/session/ses-existing/prompt_async"
        assert clients[1].calls[0][3] == {
            "agent": "TARA_analyst",
            "parts": [
                {"type": "text", "text": "hello from adapter"},
                {"type": "text", "text": "[capture]\n{\"pageTitle\": \"Example\", \"pageUrl\": \"https://example.com\", \"software_version\": \"v1.0.0\", \"selected_sr\": \"SR-1\"}"},
                {"type": "text", "text": "[context]\n{\"source\": \"chrome-extension\", \"capturedAt\": \"2026-04-01T00:00:00.000Z\", \"username\": \"alice\", \"usernameSource\": \"dom_text\", \"pageTitle\": \"Example\", \"pageUrl\": \"https://example.com\"}"}
            ],
        }
        assert adapter._runs[run_id]["session_id"] == "ses-existing"
        assert all(event.data and event.data.get("session_reused") is True for event in adapter._runs[run_id]["events"])

    anyio.run(scenario)


def test_real_path_returns_error_when_session_create_fails() -> None:
    response_sets = [
        [("GET", "/agent", make_agent_catalog_response("TARA_analyst"))],
        [("POST", "/session", httpx.ConnectError("boom"))],
    ]

    def factory(_timeout):
        return FakeAsyncClient(response_sets.pop(0))

    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=factory)
        run_id = await adapter.start_run(create_request())
        events = [event async for event in adapter.stream_events(run_id)]

        assert events[-1].type == "error"
        assert "初始化失败" in events[-1].message

    anyio.run(scenario)


def test_explicit_selected_agent_discovery_failure_does_not_mock_fallback_even_when_enabled() -> None:
    def factory(_timeout):
        return FakeAsyncClient([
            ("GET", "/agent", make_agent_catalog_response(status_code=503, json_body={"error": "unavailable"})),
        ])

    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver", allow_mock_fallback=True), client_factory=factory)
        with pytest.raises(RuntimeError, match="Remote /agent discovery failed"):
            await adapter.start_run(create_request())

    anyio.run(scenario)


def test_default_client_factory_disables_environment_proxy_inheritance() -> None:
    adapter = OpencodeAdapter(Settings(opencode_base_url="http://localhost:8124"))
    client = adapter._default_client_factory(30.0)

    try:
        assert client.base_url == httpx.URL("http://localhost:8124")
        assert client.timeout.connect == 30.0
        assert client.trust_env is False
    finally:
        anyio.run(client.aclose)


def test_tool_call_messages_are_simplified_for_users() -> None:
    adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"))

    message = adapter._simplify_tool_call_message("grep", "running", "raw title")
    assert message == "正在检索相关信息。"


def test_remote_agent_alias_is_canonicalized_from_supported_catalog() -> None:
    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=lambda _timeout: FakeAsyncClient([
            ("GET", "/agent", make_agent_catalog_response("tara-analyst", "other_agent")),
        ]))

        selected = await adapter._discover_canonical_remote_agent("TARA_analyst")

        assert selected == "tara-analyst"

    anyio.run(scenario)


def test_remote_agent_discovery_rejects_ambiguous_alias_matches() -> None:
    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=lambda _timeout: FakeAsyncClient([
            ("GET", "/agent", make_agent_catalog_response("TARA_Analyst", "tara-analyst")),
        ]))

        with pytest.raises(RuntimeError, match="ambiguous requested agent aliases"):
            await adapter._discover_canonical_remote_agent("TARA_analyst")

    anyio.run(scenario)


def test_remote_agent_discovery_rejects_missing_target_agent() -> None:
    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=lambda _timeout: FakeAsyncClient([
            ("GET", "/agent", make_agent_catalog_response("other_agent")),
        ]))

        with pytest.raises(RuntimeError, match="requested agent is unavailable in remote catalog"):
            await adapter._discover_canonical_remote_agent("TARA_analyst")

    anyio.run(scenario)


def test_remote_agent_discovery_rejects_invalid_payload() -> None:
    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=lambda _timeout: FakeAsyncClient([
            ("GET", "/agent", make_agent_catalog_response(json_body={"ok": True})),
        ]))

        with pytest.raises(RuntimeError, match="invalid /agent response payload"):
            await adapter._discover_canonical_remote_agent("TARA_analyst")

    anyio.run(scenario)


def test_start_run_raises_when_remote_agent_discovery_fails_without_mock_fallback() -> None:
    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=lambda _timeout: FakeAsyncClient([
            ("GET", "/agent", make_agent_catalog_response(json_body={"ok": True})),
        ]))

        with pytest.raises(RuntimeError, match="Remote /agent discovery failed"):
            await adapter.start_run(create_request())

    anyio.run(scenario)


def test_start_run_raises_when_selected_agent_is_not_whitelisted() -> None:
    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"))

        request = create_request().model_dump()
        request["selectedAgent"] = "OtherAgent"

        with pytest.raises(RuntimeError, match="Requested main agent is not allowed"):
            await adapter.start_run(RunStartRequest.model_construct(**request))

    anyio.run(scenario)


def test_remote_agent_discovery_resolves_second_allowed_agent_without_ui_catalog_expansion() -> None:
    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=lambda _timeout: FakeAsyncClient([
            ("GET", "/agent", make_agent_catalog_response("ThreatIntelliganceCommander", "other_agent")),
        ]))

        selected = await adapter._discover_canonical_remote_agent("ThreatIntelliganceCommander")

        assert selected == "ThreatIntelliganceCommander"

    anyio.run(scenario)


def test_start_run_fails_explicitly_when_requested_agent_not_supported_by_remote() -> None:
    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"), client_factory=lambda _timeout: FakeAsyncClient([
            ("GET", "/agent", make_agent_catalog_response("TARA_analyst")),
        ]))

        request = create_request().model_copy(update={"selectedAgent": "ThreatIntelliganceCommander"})

        with pytest.raises(RuntimeError, match="requested agent is unavailable in remote catalog"):
            await adapter.start_run(request)

    anyio.run(scenario)


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
        [("GET", "/agent", make_agent_catalog_response("TARA_Analyst"))],
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
        assert clients[0].calls == [("GET", "/agent", {"directory": adapter.settings.opencode_directory}, None)]
        assert clients[1].calls == [("POST", "/session", {"directory": adapter.settings.opencode_directory}, {"title": "SR SR-1"})]
        assert clients[2].calls[0][1] == "/session/ses-1/prompt_async"
        assert clients[2].calls[0][3]["agent"] == "TARA_Analyst"
        assert clients[2].calls[0][3]["parts"] == [
            {"type": "text", "text": "hello from adapter"},
            {"type": "text", "text": "[capture]\n{\"pageTitle\": \"Example\", \"pageUrl\": \"https://example.com\", \"software_version\": \"v1.0.0\", \"selected_sr\": \"SR-1\"}"},
            {"type": "text", "text": "[context]\n{\"source\": \"chrome-extension\", \"capturedAt\": \"2026-04-01T00:00:00.000Z\", \"username\": \"alice\", \"usernameSource\": \"dom_text\", \"pageTitle\": \"Example\", \"pageUrl\": \"https://example.com\"}"}
        ]

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
        [("GET", "/agent", make_agent_catalog_response("TARA_analyst"))],
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
        [("GET", "/agent", make_agent_catalog_response("TARA_analyst"))],
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
        [("GET", "/agent", make_agent_catalog_response("TARA_analyst"))],
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


def test_real_contract_preflights_remote_agent_catalog_before_session_bootstrap() -> None:
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
        [("GET", "/agent", make_agent_catalog_response("TARA_analyst"))],
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
        assert len(clients) == 3
        assert clients[0].calls[0][1] == "/agent"
        assert clients[1].calls[0][1] == "/session"
        assert clients[2].calls[0][1] == "/session/ses-1/prompt_async"

    anyio.run(scenario)


def test_stream_events_raises_run_not_found_for_unknown_run_id() -> None:
    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"))

        with pytest.raises(RunNotFoundError, match="run-missing"):
            events = adapter.stream_events("run-missing")
            await events.__anext__()

    anyio.run(scenario)


def test_submit_answer_raises_run_not_found_for_unknown_run_id() -> None:
    async def scenario() -> None:
        adapter = OpencodeAdapter(Settings(opencode_base_url="http://testserver"))

        with pytest.raises(RunNotFoundError, match="run-missing"):
            await adapter.submit_answer(
                "run-missing",
                QuestionAnswerRequest(questionId="question-1", answer="high", choiceId="p1"),
            )

    anyio.run(scenario)
