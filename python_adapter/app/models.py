from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


NormalizedEventType = Literal["thinking", "tool_call", "question", "result", "error"]


class RunContext(BaseModel):
    source: str
    capturedAt: str
    username: str
    usernameSource: str
    pageTitle: str
    pageUrl: str


class RunStartRequest(BaseModel):
    prompt: str = Field(min_length=1)
    capture: dict[str, str]
    context: RunContext


class QuestionAnswerRequest(BaseModel):
    questionId: str
    answer: str
    choiceId: str | None = None


class MessageFeedbackRequest(BaseModel):
    runId: str = Field(min_length=1)
    messageId: str = Field(min_length=1)
    feedback: Literal["like", "dislike"]


class QuestionOption(BaseModel):
    id: str
    label: str
    value: str


class QuestionPayload(BaseModel):
    questionId: str
    title: str
    message: str
    options: list[QuestionOption] = Field(default_factory=list)
    allowFreeText: bool = True
    placeholder: str | None = None


class NormalizedRunEvent(BaseModel):
    id: str
    runId: str
    type: NormalizedEventType
    createdAt: str
    sequence: int
    message: str
    title: str | None = None
    data: dict[str, Any] | None = None
    logData: dict[str, Any] | None = None
    question: QuestionPayload | None = None


class RunStartResult(BaseModel):
    sessionId: str | None = None
    startupError: str | None = None
    mode: str
