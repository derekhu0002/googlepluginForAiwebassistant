from __future__ import annotations

import json
from datetime import datetime, timezone

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from .config import settings
from .logging_store import JsonlInvocationLogger
from .models import MessageFeedbackRequest, QuestionAnswerRequest, RunStartRequest
from .opencode_adapter import OpencodeAdapter, RunNotFoundError

app = FastAPI(title="AI Web Assistant Python Adapter")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = JsonlInvocationLogger(settings.log_dir)
adapter = OpencodeAdapter(settings)


def map_start_run_error(exc: RuntimeError) -> HTTPException:
    error_message = str(exc)
    normalized_message = error_message.lower()

    if "requested main agent is not allowed" in normalized_message:
        return HTTPException(
            status_code=400,
            detail={
                "code": "VALIDATION_ERROR",
                "message": f"请求的主 AGENT 不在允许清单内。原因：{error_message}",
            },
        )

    if "requested agent is unavailable in remote catalog" in normalized_message:
        return HTTPException(
            status_code=502,
            detail={
                "code": "ANALYSIS_ERROR",
                "message": f"远端 /agent 未提供用户所选主 AGENT，已显式拒绝启动 run。原因：{error_message}",
            },
        )

    if "remote /agent discovery failed" in normalized_message:
        return HTTPException(
            status_code=502,
            detail={
                "code": "ANALYSIS_ERROR",
                "message": (
                    "opencode 远端 /agent 能力探测失败，请确认远端 server 可用、返回合法 agent catalog，且能唯一解析所请求主 AGENT。"
                    f"原因：{error_message}"
                ),
            },
        )

    if "canonical agent mismatch" in normalized_message or "remote agent enforcement failed" in normalized_message:
        return HTTPException(
            status_code=502,
            detail={
                "code": "ANALYSIS_ERROR",
                "message": (
                    "opencode 真实运行时 agent 与远端 /agent 选定 canonical agent 不一致，请确认会话未落到其他 agent。"
                    f"原因：{error_message}"
                ),
            },
        )

    return HTTPException(status_code=500, detail={"code": "ANALYSIS_ERROR", "message": error_message})


def map_run_not_found_error(exc: RunNotFoundError) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={
            "code": "RUN_NOT_FOUND",
            "message": f"Run '{exc.run_id}' 不存在或已过期，请重新发起新的 run。",
        },
    )


async def post_feedback_to_backend(request: MessageFeedbackRequest) -> dict[str, object]:
    url = f"{settings.feedback_backend_base_url}{settings.feedback_backend_endpoint}"
    headers = {"Content-Type": "application/json"}
    if settings.api_key:
        headers["x-api-key"] = settings.api_key

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(url, json=request.model_dump(), headers=headers)

    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail={"code": "ANALYSIS_ERROR", "message": "Invalid feedback backend response"}) from exc

    if response.status_code >= 400:
        detail = payload.get("error") if isinstance(payload, dict) else None
        raise HTTPException(
            status_code=response.status_code,
            detail=detail if isinstance(detail, dict) else {"code": "ANALYSIS_ERROR", "message": "Feedback backend request failed"},
        )

    if not isinstance(payload, dict) or payload.get("ok") is not True or not isinstance(payload.get("data"), dict):
        raise HTTPException(status_code=502, detail={"code": "ANALYSIS_ERROR", "message": "Unexpected feedback backend payload"})

    return payload["data"]


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "HTTP_ERROR", "message": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content={"ok": False, "error": detail})


def enforce_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if settings.api_key and x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail={"code": "AUTH_ERROR", "message": "Unauthorized request"})


def enforce_stream_api_key(api_key: str | None = Query(default=None)) -> None:
    if settings.api_key and api_key != settings.api_key:
        raise HTTPException(status_code=401, detail={"code": "AUTH_ERROR", "message": "Unauthorized request"})


@app.get("/health")
async def health() -> dict[str, object]:
    return {
        "ok": True,
        "backend": "python-adapter",
        "opencode_base_url": settings.opencode_base_url,
        "opencode_global_event_endpoint": settings.opencode_global_event_endpoint,
        "opencode_health_endpoint": settings.opencode_health_endpoint,
        "opencode_agent_list_endpoint": settings.opencode_agent_list_endpoint,
        "use_mock_opencode": settings.use_mock_opencode,
        "allow_mock_fallback": settings.allow_mock_fallback,
        "invocation_log_path": str(logger.log_file),
    }


@app.post("/api/runs")
async def start_run(request: RunStartRequest, _auth: None = Depends(enforce_api_key)) -> JSONResponse:
    try:
        run_id = await adapter.start_run(request)
    except RuntimeError as exc:
        raise map_start_run_error(exc) from exc
    logger.write({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "run_id": run_id,
        "username": request.context.username,
        "username_source": request.context.usernameSource,
        "input": request.model_dump(),
        "output": None,
        "phase": "start_run",
    })
    run = adapter._runs.get(run_id, {})
    return JSONResponse({"ok": True, "data": {"runId": run_id, "sessionId": run.get("session_id"), "selectedAgent": run.get("selected_agent")}})


@app.get("/api/runs/{run_id}/events")
async def stream_run_events(run_id: str, _auth: None = Depends(enforce_stream_api_key)) -> EventSourceResponse:
    try:
        adapter.require_run(run_id)
    except RunNotFoundError as exc:
        raise map_run_not_found_error(exc) from exc

    async def event_generator():
        async for event in adapter.stream_events(run_id):
            logger.write({
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "run_id": run_id,
                "phase": "stream_event",
                "event": event.model_dump(),
                "raw_event": event.logData,
            })
            yield {"event": "message", "data": json.dumps(event.model_dump())}

    return EventSourceResponse(event_generator())


@app.post("/api/runs/{run_id}/answers")
async def answer_question(run_id: str, request: QuestionAnswerRequest, _auth: None = Depends(enforce_api_key)) -> JSONResponse:
    try:
        await adapter.submit_answer(run_id, request)
    except RunNotFoundError as exc:
        raise map_run_not_found_error(exc) from exc
    logger.write({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "run_id": run_id,
        "phase": "answer_question",
        "answer": request.model_dump(),
    })
    return JSONResponse({"ok": True, "data": {"accepted": True, "runId": run_id, "questionId": request.questionId}})


@app.post("/api/message-feedback")
async def submit_message_feedback(request: MessageFeedbackRequest, _auth: None = Depends(enforce_api_key)) -> JSONResponse:
    result = await post_feedback_to_backend(request)
    logger.write({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "run_id": request.runId,
        "phase": "message_feedback",
        "feedback": request.model_dump(),
        "backend_response": result,
    })
    return JSONResponse({"ok": True, "data": result})
