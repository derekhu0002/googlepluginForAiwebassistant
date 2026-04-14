from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


MainAgent = Literal["TARA_analyst", "ThreatIntelliganceCommander"]


NormalizedEventType = Literal["thinking", "tool_call", "question", "result", "error"]
NormalizedEventChannel = Literal["reasoning", "assistant_text", "tool"]
NormalizedEventEmissionKind = Literal["delta", "snapshot", "final"]
NormalizedEventItemKind = Literal["reasoning", "text", "tool"]


class NormalizedRunEventTool(BaseModel):
    name: str | None = None
    status: str | None = None
    title: str | None = None
    callId: str | None = None


class RunContext(BaseModel):
    source: str
    capturedAt: str
    username: str
    usernameSource: str
    pageTitle: str | None = None
    pageUrl: str | None = None


# @ArchitectureID: ELM-FUNC-PY-ACCEPT-CAPTURE-RUNSTART
# @ArchitectureID: ELM-COMP-PY-ADAPTER
class RunStartRequest(BaseModel):
    prompt: str = Field(min_length=1)
    selectedAgent: str = Field(min_length=1)
    capture: dict[str, str] = Field(default_factory=dict)
    sessionId: str | None = None
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


# @ArchitectureID: ELM-APP-008C
class NormalizedRunEventSemantic(BaseModel):
    channel: NormalizedEventChannel
    emissionKind: NormalizedEventEmissionKind
    identity: str
    itemKind: NormalizedEventItemKind
    messageId: str | None = None
    partId: str | None = None


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
    tool: NormalizedRunEventTool | None = None
    question: QuestionPayload | None = None
    semantic: NormalizedRunEventSemantic | None = None


class RunStartResult(BaseModel):
    selectedAgent: MainAgent
    sessionId: str | None = None
    startupError: str | None = None
    mode: str
