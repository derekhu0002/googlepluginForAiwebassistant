from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from .config import settings
from .logging_store import JsonlInvocationLogger
from .models import QuestionAnswerRequest, RunStartRequest
from .opencode_adapter import OpencodeAdapter

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
        "use_mock_opencode": settings.use_mock_opencode,
        "allow_mock_fallback": settings.allow_mock_fallback,
        "invocation_log_path": str(logger.log_file),
    }


@app.post("/api/runs")
async def start_run(request: RunStartRequest, _auth: None = Depends(enforce_api_key)) -> JSONResponse:
    run_id = await adapter.start_run(request)
    logger.write({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "run_id": run_id,
        "username": request.context.username,
        "username_source": request.context.usernameSource,
        "input": request.model_dump(),
        "output": None,
        "phase": "start_run",
    })
    return JSONResponse({"ok": True, "data": {"runId": run_id}})


@app.get("/api/runs/{run_id}/events")
async def stream_run_events(run_id: str, _auth: None = Depends(enforce_stream_api_key)) -> EventSourceResponse:
    async def event_generator():
        async for event in adapter.stream_events(run_id):
            logger.write({
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "run_id": run_id,
                "phase": "stream_event",
                "event": event.model_dump(),
            })
            yield {"event": "message", "data": json.dumps(event.model_dump())}

    return EventSourceResponse(event_generator())


@app.post("/api/runs/{run_id}/answers")
async def answer_question(run_id: str, request: QuestionAnswerRequest, _auth: None = Depends(enforce_api_key)) -> JSONResponse:
    await adapter.submit_answer(run_id, request)
    logger.write({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "run_id": run_id,
        "phase": "answer_question",
        "answer": request.model_dump(),
    })
    return JSONResponse({"ok": True, "data": {"accepted": True, "runId": run_id, "questionId": request.questionId}})
