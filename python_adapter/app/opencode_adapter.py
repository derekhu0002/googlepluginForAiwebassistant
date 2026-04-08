from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

import httpx

from .config import Settings
from .models import (
    NormalizedRunEvent,
    NormalizedRunEventSemantic,
    QuestionAnswerRequest,
    QuestionOption,
    QuestionPayload,
    RunStartRequest,
)


ClientFactory = Callable[[float | None], httpx.AsyncClient]
REQUIRED_PRIMARY_AGENT = "TARA_analyst"


# @ArchitectureID: ELM-006
# @ArchitectureID: ELM-APP-008C
class OpencodeAdapter:
    def __init__(self, settings: Settings, client_factory: ClientFactory | None = None) -> None:
        self.settings = settings
        self._runs: dict[str, dict[str, Any]] = {}
        self._client_factory = client_factory or self._default_client_factory

    def _default_client_factory(self, timeout: float | None) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self.settings.opencode_base_url, timeout=timeout, trust_env=False)

    def _query_params(self) -> dict[str, str]:
        params = {"directory": self.settings.opencode_directory}
        if self.settings.opencode_workspace:
            params["workspace"] = self.settings.opencode_workspace
        return params

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _next_event(
        self,
        run: dict[str, Any],
        event_type: str,
        message: str,
        *,
        title: str | None = None,
        data: dict[str, Any] | None = None,
        log_data: dict[str, Any] | None = None,
        question: QuestionPayload | None = None,
        semantic: NormalizedRunEventSemantic | None = None,
    ) -> NormalizedRunEvent:
        run["sequence"] += 1
        return NormalizedRunEvent(
            id=f"{run['run_id']}-{run['sequence']}",
            runId=run["run_id"],
            type=event_type,  # type: ignore[arg-type]
            createdAt=self._now(),
            sequence=run["sequence"],
            title=title or event_type,
            message=message,
            data=data,
            logData=log_data if log_data is not None else data,
            question=question,
            semantic=semantic,
        )

    def _next_tool_event(self, run: dict[str, Any], message: str, *, title: str = "处理中", data: dict[str, Any] | None = None, log_data: dict[str, Any] | None = None) -> NormalizedRunEvent:
        return self._next_event(
            run,
            "tool_call",
            message,
            title=title,
            data=data,
            log_data=log_data if log_data is not None else data,
        )

    def _ensure_tara_primary_agent(self) -> None:
        config_path = Path(self.settings.opencode_config_path)
        agent_path = Path(self.settings.opencode_tara_agent_path)

        try:
            config_raw = config_path.read_text(encoding="utf-8")
        except Exception as exc:
            raise RuntimeError(f"TARA primary agent guard failed: unable to read {config_path}: {exc}") from exc

        try:
            config_payload = json.loads(config_raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"TARA primary agent guard failed: invalid JSON in {config_path}: {exc}") from exc

        default_agent = config_payload.get("default_agent")
        if default_agent != REQUIRED_PRIMARY_AGENT:
            raise RuntimeError(
                f"TARA primary agent guard failed: .opencode/opencode.json default_agent must be '{REQUIRED_PRIMARY_AGENT}', got {default_agent!r}"
            )

        try:
            agent_contents = agent_path.read_text(encoding="utf-8")
        except Exception as exc:
            raise RuntimeError(f"TARA primary agent guard failed: unable to read {agent_path}: {exc}") from exc

        if not agent_contents.strip():
            raise RuntimeError(f"TARA primary agent guard failed: {agent_path} is empty")

    def _build_session_create_payload(self, request: RunStartRequest) -> dict[str, Any]:
        title = f"SR {request.capture.get('selected_sr', '').strip() or 'analysis'}"
        return {
            "title": title,
        }

    def _normalize_existing_session_id(self, request: RunStartRequest) -> str | None:
        session_id = request.sessionId.strip() if isinstance(request.sessionId, str) else None
        return session_id or None

    def _response_text_data(self, message_id: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"field": "text"}
        if message_id:
            payload["message_id"] = message_id
        return payload

    def _assistant_text_identity(self, message_id: str | None, part_id: str | None = None) -> str:
        identity_parts = ["assistant_text", message_id or "unknown-message", part_id or "message-body"]
        return ":".join(identity_parts)

    def _reasoning_identity(self, message_id: str | None, part_id: str | None = None) -> str:
        identity_parts = ["reasoning", message_id or "unknown-message", part_id or "message-reasoning"]
        return ":".join(identity_parts)

    def _assistant_text_semantic(
        self,
        message_id: str | None,
        *,
        part_id: str | None = None,
        emission_kind: str,
    ) -> NormalizedRunEventSemantic:
        return NormalizedRunEventSemantic(
            channel="assistant_text",
            emissionKind=emission_kind,  # type: ignore[arg-type]
            identity=self._assistant_text_identity(message_id, part_id),
            messageId=message_id,
            partId=part_id,
        )

    def _reasoning_semantic(
        self,
        message_id: str | None,
        *,
        part_id: str | None = None,
        emission_kind: str,
    ) -> NormalizedRunEventSemantic:
        return NormalizedRunEventSemantic(
            channel="reasoning",
            emissionKind=emission_kind,  # type: ignore[arg-type]
            identity=self._reasoning_identity(message_id, part_id),
            messageId=message_id,
            partId=part_id,
        )

    def _part_id_from_properties(self, properties: dict[str, Any], part: dict[str, Any] | None = None) -> str | None:
        direct_part_id = properties.get("partID") or properties.get("partId")
        if isinstance(direct_part_id, str) and direct_part_id.strip():
            return direct_part_id.strip()

        nested_part = part if isinstance(part, dict) else properties.get("part")
        if isinstance(nested_part, dict):
            nested_part_id = nested_part.get("id") or nested_part.get("partID") or nested_part.get("partId")
            if isinstance(nested_part_id, str) and nested_part_id.strip():
                return nested_part_id.strip()

        return None

    def _emit_assistant_text_event(
        self,
        run: dict[str, Any],
        message: str,
        message_id: str | None = None,
        *,
        part_id: str | None = None,
        emission_kind: str = "delta",
    ) -> NormalizedRunEvent | None:
        if not isinstance(message, str) or not message.strip():
            return None
        return self._next_event(
            run,
            "thinking",
            message,
            data=self._response_text_data(message_id),
            semantic=self._assistant_text_semantic(message_id, part_id=part_id, emission_kind=emission_kind),
        )

    def _flush_buffered_part_delta(self, run: dict[str, Any], part_id: str, message_id: str | None = None) -> list[NormalizedRunEvent]:
        buffered_parts = run.get("buffered_part_deltas") or {}
        buffered_entry = buffered_parts.pop(part_id, None)
        if not isinstance(buffered_entry, dict):
            return []

        delta = buffered_entry.get("delta") or ""
        if not isinstance(delta, str) or not delta:
            return []

        resolved_part_type = (run.get("part_types") or {}).get(part_id)
        resolved_message_id = message_id or buffered_entry.get("message_id")
        if resolved_part_type == "text":
            emitted = self._emit_assistant_text_event(run, delta, resolved_message_id, part_id=part_id, emission_kind="delta")
            return [emitted] if emitted else []
        if resolved_part_type == "reasoning":
            return [
                self._next_event(
                    run,
                    "thinking",
                    delta,
                    semantic=self._reasoning_semantic(resolved_message_id, part_id=part_id, emission_kind="delta"),
                )
            ]

        return []

    def _extract_message_or_event_agent_name(self, payload: Any) -> str | None:
        if not isinstance(payload, dict):
            return None

        direct_keys = (
            "agent",
            "agentId",
            "agentName",
        )
        for key in direct_keys:
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
            if isinstance(value, dict):
                nested = value.get("id") or value.get("name") or value.get("slug")
                if isinstance(nested, str) and nested.strip():
                    return nested.strip()

        nested_keys = ("metadata", "info", "message", "part", "properties")
        for key in nested_keys:
            nested_payload = payload.get(key)
            nested_agent = self._extract_message_or_event_agent_name(nested_payload)
            if nested_agent:
                return nested_agent

        return None

    def _record_primary_agent_evidence(self, run: dict[str, Any], payload: Any, *, source: str) -> None:
        agent_name = self._extract_message_or_event_agent_name(payload)
        if not agent_name:
            return

        if agent_name != REQUIRED_PRIMARY_AGENT:
            raise RuntimeError(
                f"TARA primary agent enforcement failed: {source} reported agent {agent_name!r}, expected {REQUIRED_PRIMARY_AGENT!r}"
            )

        run["confirmed_primary_agent"] = agent_name
        run["primary_agent_evidence_source"] = source

    async def start_run(self, request: RunStartRequest) -> str:
        if not self.settings.use_mock_opencode:
            self._ensure_tara_primary_agent()

        run_id = f"run-{uuid4().hex}"
        run = {
            "run_id": run_id,
            "request": request,
            "answers": [],
            "waiting_question_id": None,
            "completed": False,
            "sequence": 0,
            "events": [],
            "session_id": None,
            "startup_error": None,
            "mode": "mock-adapter" if self.settings.use_mock_opencode else "real",
            "question_requests": {},
            "assistant_message_id": None,
            "last_text": "",
            "last_output_text": "",
            "part_types": {},
            "buffered_part_deltas": {},
            "result_emitted": False,
            "confirmed_primary_agent": None,
            "primary_agent_evidence_source": None,
        }
        self._runs[run_id] = run

        if self.settings.use_mock_opencode:
            run["events"] = self._build_mock_initial_events(run)
            run["waiting_question_id"] = "question-1"
            return run_id

        try:
            existing_session_id = self._normalize_existing_session_id(request)
            if existing_session_id:
                run["session_id"] = existing_session_id
                session_id = existing_session_id
                run["events"] = [
                    self._next_tool_event(
                        run,
                        "已复用当前 opencode session，准备继续提交 follow-up prompt。",
                        title="会话已连接",
                        data={"session_id": session_id, "session_reused": True},
                    ),
                    self._next_tool_event(
                        run,
                        "已连接当前会话，正在继续执行分析步骤。",
                        data={
                            "stage": "dispatch_prompt",
                            "target": self.settings.opencode_base_url,
                            "session_id": session_id,
                            "session_reused": True,
                            "event_endpoint": self.settings.opencode_global_event_endpoint,
                            "mock_mode": False,
                            "mock_fallback_enabled": self.settings.allow_mock_fallback,
                        },
                        log_data={
                            "target": self.settings.opencode_base_url,
                            "session_id": session_id,
                            "session_reused": True,
                            "event_endpoint": self.settings.opencode_global_event_endpoint,
                            "mock_mode": False,
                            "mock_fallback_enabled": self.settings.allow_mock_fallback,
                        },
                    ),
                ]
            else:
                session = await self._create_session(request)
                run["session_id"] = session["id"]
                session_id = session["id"]
                run["events"] = [
                    self._next_tool_event(
                        run,
                        f"已创建 opencode session，准备提交 prompt。software_version={request.capture.get('software_version', '') or '(empty)'}；selected_sr={request.capture.get('selected_sr', '') or '(empty)'}。",
                        title="会话已创建",
                        data={"session_id": session_id},
                    ),
                    self._next_tool_event(
                        run,
                        "已连接主分析代理，正在准备执行分析步骤。",
                        data={
                            "stage": "dispatch_prompt",
                            "target": self.settings.opencode_base_url,
                            "session_id": session_id,
                            "event_endpoint": self.settings.opencode_global_event_endpoint,
                            "mock_mode": False,
                            "mock_fallback_enabled": self.settings.allow_mock_fallback,
                        },
                        log_data={
                            "target": self.settings.opencode_base_url,
                            "session_id": session_id,
                            "event_endpoint": self.settings.opencode_global_event_endpoint,
                            "mock_mode": False,
                            "mock_fallback_enabled": self.settings.allow_mock_fallback,
                        },
                    ),
                ]
            await self._prompt_session(session_id, request)
        except Exception as exc:
            if self.settings.allow_mock_fallback:
                run["mode"] = "mock-fallback"
                run["fallback_reason"] = str(exc)
                run["events"] = self._build_mock_initial_events(run, fallback_reason=str(exc))
                run["waiting_question_id"] = "question-1"
            else:
                run["startup_error"] = str(exc)
                run["events"] = [
                    self._next_tool_event(
                        run,
                        "正在校验主分析代理配置。",
                        data={"stage": "preflight_check"},
                        log_data={"target": self.settings.opencode_base_url, "mock_mode": False, "error": str(exc)},
                    )
                ]

        return run_id

    async def stream_events(self, run_id: str):
        run = self._runs[run_id]

        for event in run["events"]:
            await asyncio.sleep(0.01)
            yield event

        if run["mode"] in {"mock-adapter", "mock-fallback"}:
            while run["waiting_question_id"] and not run["completed"]:
                await asyncio.sleep(0.05)

            if not run["completed"]:
                yield self._build_mock_result(run)
                run["completed"] = True
            return

        if run["startup_error"]:
            yield self._next_event(
                run,
                "error",
                f"opencode serve 初始化失败：{run['startup_error']}",
                data={"opencode_mode": "real", "target": self.settings.opencode_base_url},
            )
            run["completed"] = True
            return

        try:
            async for event in self._stream_real_events(run):
                yield event
                if event.type in {"result", "error"}:
                    run["completed"] = True
                    break
        except Exception as exc:
            yield self._next_event(
                run,
                "error",
                str(exc),
                data={"opencode_mode": "real", "target": self.settings.opencode_base_url},
            )
            run["completed"] = True

    async def submit_answer(self, run_id: str, answer: QuestionAnswerRequest) -> None:
        run = self._runs[run_id]
        run["answers"].append(answer.model_dump())
        run["waiting_question_id"] = None

        if run["mode"] in {"mock-adapter", "mock-fallback"}:
            return

        request_payload = run["question_requests"].get(answer.questionId)
        if not request_payload:
            questions = await self._list_questions()
            request_payload = next((item for item in questions if item.get("id") == answer.questionId), None)
            if request_payload:
                run["question_requests"][answer.questionId] = request_payload

        answers = [self._build_question_answer_payload(answer, request_payload)]

        async with self._client_factory(30.0) as client:
            response = await client.post(
                self.settings.opencode_question_reply_endpoint.format(request_id=answer.questionId),
                params=self._query_params(),
                json={"answers": answers},
            )
            response.raise_for_status()

    def _build_mock_initial_events(self, run: dict[str, Any], fallback_reason: str | None = None) -> list[NormalizedRunEvent]:
        request: RunStartRequest = run["request"]
        question = QuestionPayload(
            questionId="question-1",
            title="请选择优先级",
            message="如果没有合适选项，也可以输入自定义答案。",
            options=[
                QuestionOption(id="p1", label="高优先级", value="high"),
                QuestionOption(id="p2", label="中优先级", value="medium"),
                QuestionOption(id="p3", label="低优先级", value="low"),
            ],
            allowFreeText=True,
            placeholder="例如：需要今天内完成验证",
        )
        events = [
            self._next_event(
                run,
                "thinking",
                f"分析用户请求，并结合 software_version={request.capture.get('software_version', '') or '(empty)'}、selected_sr={request.capture.get('selected_sr', '') or '(empty)'} 构建推理上下文。",
                data={"prompt": request.prompt, "username": request.context.username},
            ),
            self._next_tool_event(
                run,
                "正在整理上下文并准备分析。",
                data={
                    "stage": "prepare_context",
                    "target": self.settings.opencode_base_url,
                    "mock_mode": True,
                    "mock_fallback_enabled": self.settings.allow_mock_fallback,
                    **({"fallback_reason": fallback_reason} if fallback_reason else {}),
                },
                log_data={
                    "target": self.settings.opencode_base_url,
                    "mock_mode": True,
                    "mock_fallback_enabled": self.settings.allow_mock_fallback,
                    **({"fallback_reason": fallback_reason} if fallback_reason else {}),
                },
            ),
            self._next_event(run, "question", "为了继续，请确认当前 SR 的处理优先级。", question=question),
        ]
        return events

    def _build_mock_result(self, run: dict[str, Any]) -> NormalizedRunEvent:
        request: RunStartRequest = run["request"]
        answer = run["answers"][-1] if run["answers"] else {"answer": "未提供"}
        data: dict[str, Any] = {
            "summary": "建议先核对 SR 影响范围，再安排针对版本的回归验证。",
            "opencode_mode": run["mode"],
        }
        if run.get("fallback_reason"):
            data["fallback_reason"] = run["fallback_reason"]
        return self._next_event(
            run,
            "result",
            (
                f"已完成对 selected_sr={request.capture.get('selected_sr', '') or '(empty)'} 的分析。"
                f" software_version={request.capture.get('software_version', '') or '(empty)'}；"
                f"用户优先级回答：{answer.get('answer', '未提供')}。"
            ),
            data=data,
        )

    async def _create_session(self, request: RunStartRequest) -> dict[str, Any]:
        async with self._client_factory(30.0) as client:
            response = await client.post(
                self.settings.opencode_session_endpoint,
                params=self._query_params(),
                json=self._build_session_create_payload(request),
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or not payload.get("id"):
                raise ValueError("Invalid session create response")
            return payload

    async def _prompt_session(self, session_id: str, request: RunStartRequest) -> None:
        async with self._client_factory(30.0) as client:
            response = await client.post(
                self.settings.opencode_prompt_async_endpoint.format(session_id=session_id),
                params=self._query_params(),
                json={
                    "agent": REQUIRED_PRIMARY_AGENT,
                    "parts": [{"type": "text", "text": request.prompt}],
                },
            )
            response.raise_for_status()

    async def _list_questions(self) -> list[dict[str, Any]]:
        async with self._client_factory(30.0) as client:
            response = await client.get(self.settings.opencode_question_list_endpoint, params=self._query_params())
            response.raise_for_status()
            payload = response.json()
            return payload if isinstance(payload, list) else []

    async def _stream_real_events(self, run: dict[str, Any]):
        async with self._client_factory(None) as client:
            async with client.stream("GET", self.settings.opencode_global_event_endpoint, params=self._query_params()) as response:
                response.raise_for_status()
                async for global_event in self._iter_sse_payloads(response):
                    if not self._event_matches_session(run, global_event):
                        continue

                    normalized_events = await self._normalize_global_event(run, global_event)
                    for event in normalized_events:
                        if event is None:
                            continue
                        yield event
                        if event.type in {"result", "error"}:
                            return

        if not run["result_emitted"]:
            final_event = await self._build_result_from_session(run, allow_placeholder=True)
            if final_event:
                yield final_event

    async def _normalize_global_event(self, run: dict[str, Any], global_event: dict[str, Any]) -> list[NormalizedRunEvent | None]:
        payload = global_event.get("payload") or {}
        event_type = payload.get("type")
        properties = payload.get("properties") or {}

        if isinstance(event_type, str) and event_type.startswith("message"):
            self._record_primary_agent_evidence(run, payload, source=f"event {event_type}")

        if event_type == "session.status":
            status = properties.get("status") or {}
            status_type = status.get("type", "unknown")
            details = f"（attempt={status.get('attempt')}）" if status_type == "retry" else ""
            return [self._next_tool_event(run, f"opencode session 状态更新：{status_type}{details}", title="会话状态", data={"status": status})]

        if event_type == "message.part.delta":
            delta = properties.get("delta") or ""
            if delta:
                part_id = self._part_id_from_properties(properties)
                message_id = properties.get("messageID")
                part_type = (run.get("part_types") or {}).get(part_id) if part_id else None

                if part_type == "text":
                    emitted = self._emit_assistant_text_event(run, delta, message_id, part_id=part_id, emission_kind="delta")
                    return [emitted] if emitted else []

                if part_type == "reasoning":
                    return [
                        self._next_event(
                            run,
                            "thinking",
                            delta,
                            semantic=self._reasoning_semantic(message_id, part_id=part_id, emission_kind="delta"),
                        )
                    ]

                if part_id:
                    run.setdefault("buffered_part_deltas", {})[part_id] = {
                        "delta": delta,
                        "message_id": message_id,
                    }
                return []
            return []

        if event_type == "message.part.updated":
            part = properties.get("part") or {}
            part_type = part.get("type")
            part_id = self._part_id_from_properties(properties, part)
            if part_id and isinstance(part_type, str) and part_type:
                run.setdefault("part_types", {})[part_id] = part_type

            if part_type == "tool":
                state = part.get("state") or {}
                tool_name = str(part.get("tool") or "unknown")
                state_status = str(state.get("status") or "running")
                message = self._simplify_tool_call_message(tool_name, state_status, state.get("title"))
                return [self._next_tool_event(run, message, data={"stage": state_status}, log_data={"tool": part.get("tool"), "state": state, "part": part})]
            if part_type == "reasoning":
                flushed_events = self._flush_buffered_part_delta(run, part_id, properties.get("messageID")) if part_id else []
                if flushed_events:
                    return flushed_events
                return [
                    self._next_event(
                        run,
                        "thinking",
                        part.get("text") or "模型正在推理。",
                        semantic=self._reasoning_semantic(properties.get("messageID"), part_id=part_id, emission_kind="snapshot"),
                    )
                ]
            if part_type == "text" and part.get("text"):
                run["last_output_text"] = part["text"]
                flushed_events = self._flush_buffered_part_delta(run, part_id, properties.get("messageID")) if part_id else []
                if flushed_events:
                    return flushed_events
                emitted = self._emit_assistant_text_event(
                    run,
                    part["text"],
                    properties.get("messageID"),
                    part_id=part_id,
                    emission_kind="snapshot",
                )
                return [emitted] if emitted else []
            return []

        if event_type == "message.updated":
            info = properties.get("info") or {}
            if info.get("role") == "assistant":
                run["assistant_message_id"] = info.get("id")
                if info.get("error"):
                    return [self._next_event(run, "error", f"opencode session 返回错误：{info['error']}", data={"info": info})]
            return []

        if event_type == "question.asked":
            request_id = properties.get("id")
            if request_id:
                run["question_requests"][request_id] = properties
                run["waiting_question_id"] = request_id
            normalized = self._normalize_question_request(properties)
            return [self._next_event(run, "question", normalized.message, question=normalized, data={"session_id": run.get("session_id")})]

        if event_type == "question.replied":
            run["waiting_question_id"] = None
            return [self._next_tool_event(run, "问题已回答，继续等待 opencode 输出。", title="已提交回答", data=properties)]

        if event_type == "session.error":
            return [self._next_event(run, "error", f"opencode session 错误：{properties.get('error') or 'unknown'}", data=properties)]

        if event_type == "session.idle":
            result = await self._build_result_from_session(run, allow_placeholder=False)
            return [result] if result else [self._next_tool_event(run, "opencode session 已空闲，等待消息同步。", title="会话空闲", data=properties)]

        return []

    def _simplify_tool_call_message(self, tool_name: str, status: str, title: Any = None) -> str:
        normalized_tool = tool_name.lower()
        normalized_status = status.lower()
        if "search" in normalized_tool or "grep" in normalized_tool or "glob" in normalized_tool:
            return "正在检索相关信息。"
        if "read" in normalized_tool:
            return "正在读取所需内容。"
        if "write" in normalized_tool or "edit" in normalized_tool or "patch" in normalized_tool:
            return "正在整理并更新内容。"
        if "bash" in normalized_tool or "command" in normalized_tool:
            return "正在执行必要步骤。"
        if normalized_status in {"completed", "done", "success"}:
            return "当前步骤已完成，正在进入下一步。"
        if isinstance(title, str) and title.strip():
            return "正在处理当前分析步骤。"
        return "正在处理当前分析步骤。"

    def _normalize_question_request(self, request_payload: dict[str, Any]) -> QuestionPayload:
        first_question = (request_payload.get("questions") or [{}])[0]
        options = [
            QuestionOption(
                id=f"{request_payload.get('id', 'question')}-option-{index}",
                label=option.get("label") or f"选项 {index + 1}",
                value=option.get("label") or f"选项 {index + 1}",
            )
            for index, option in enumerate(first_question.get("options") or [])
        ]
        return QuestionPayload(
            questionId=request_payload.get("id") or f"question-{uuid4().hex}",
            title=first_question.get("header") or "需要用户回答",
            message=first_question.get("question") or "请继续回答以便完成推理。",
            options=options,
            allowFreeText=first_question.get("custom", True),
            placeholder="请输入答案",
        )

    async def _build_result_from_session(self, run: dict[str, Any], *, allow_placeholder: bool) -> NormalizedRunEvent | None:
        if run["result_emitted"] or not run.get("session_id"):
            return None

        async with self._client_factory(30.0) as client:
            response = await client.get(
                self.settings.opencode_session_messages_endpoint.format(session_id=run["session_id"]),
                params={**self._query_params(), "limit": 20},
            )
            response.raise_for_status()
            payload = response.json()

        if not isinstance(payload, list):
            return None

        for index, item in enumerate(payload, start=1):
            if not isinstance(item, dict):
                continue
            info = item.get("info") or {}
            role = info.get("role") if isinstance(info, dict) else None
            if role != "assistant":
                continue
            message_id = info.get("id") if isinstance(info, dict) else None
            source = f"message {message_id}" if message_id else f"assistant message #{index}"
            self._record_primary_agent_evidence(run, item, source=source)

        final_item = next(
            (
                item
                for item in reversed(payload)
                if isinstance(item, dict) and isinstance(item.get("info"), dict) and item["info"].get("role") == "assistant"
            ),
            None,
        )

        if not final_item:
            if run.get("last_output_text"):
                run["result_emitted"] = True
                return self._next_event(
                    run,
                    "result",
                    run["last_output_text"],
                    data={"opencode_mode": "real", "session_id": run.get("session_id"), **self._response_text_data(run.get("assistant_message_id"))},
                    semantic=self._assistant_text_semantic(run.get("assistant_message_id"), emission_kind="final"),
                )
            return None

        parts = final_item.get("parts") or []
        text_parts = [part.get("text", "") for part in parts if isinstance(part, dict) and part.get("type") == "text" and part.get("text")]
        message = "\n".join(text_parts).strip() or str(run.get("last_output_text") or "").strip()
        if not message and not allow_placeholder:
            return None
        if not message:
            message = "opencode serve 已完成但未返回可展示文本。"
        run["result_emitted"] = True
        return self._next_event(
            run,
            "result",
            message,
            data={
                "opencode_mode": "real",
                "session_id": run.get("session_id"),
                "message_id": (final_item.get("info") or {}).get("id"),
                **self._response_text_data((final_item.get("info") or {}).get("id")),
            },
            semantic=self._assistant_text_semantic((final_item.get("info") or {}).get("id"), emission_kind="final"),
        )

    def _event_matches_session(self, run: dict[str, Any], global_event: dict[str, Any]) -> bool:
        session_id = run.get("session_id")
        if not session_id:
            return False
        payload = global_event.get("payload") or {}
        properties = payload.get("properties") or {}
        direct = properties.get("sessionID")
        if direct:
            return direct == session_id
        info = properties.get("info") or {}
        if isinstance(info, dict) and info.get("sessionID"):
            return info["sessionID"] == session_id
        part = properties.get("part") or {}
        if isinstance(part, dict) and part.get("sessionID"):
            return part["sessionID"] == session_id
        return False

    async def _iter_sse_payloads(self, response: httpx.Response):
        data_lines: list[str] = []
        async for line in response.aiter_lines():
            if line.startswith("data:"):
                data_lines.append(line[5:].strip())
                continue
            if line == "":
                if data_lines:
                    raw = "\n".join(data_lines)
                    data_lines = []
                    try:
                        payload = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(payload, dict):
                        yield payload
        if data_lines:
            try:
                payload = json.loads("\n".join(data_lines))
            except json.JSONDecodeError:
                return
            if isinstance(payload, dict):
                yield payload

    def _build_question_answer_payload(self, answer: QuestionAnswerRequest, request_payload: dict[str, Any] | None) -> list[str]:
        if answer.answer:
            return [answer.answer]

        if request_payload and answer.choiceId:
            for index, option in enumerate((request_payload.get("questions") or [{}])[0].get("options") or []):
                option_id = f"{request_payload.get('id', 'question')}-option-{index}"
                if option_id == answer.choiceId:
                    return [option.get("label") or answer.choiceId]

        if answer.choiceId:
            return [answer.choiceId]

        return [""]
