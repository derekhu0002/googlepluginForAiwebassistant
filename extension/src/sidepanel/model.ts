import type { AssistantState, FieldRuleDefinition, PageRule, RuntimeMessage } from "../shared/types";
import { createDefaultFieldTemplates, createDefaultRule, createId } from "../shared/rules";
import type { NormalizedRunEvent, RunRecord } from "../shared/protocol";
import { isAssistantResponseDeltaEvent } from "./reasoningTimeline";
import { getNextPendingQuestionId } from "./questionState";

const ASSISTANT_STATUS_RANK: Record<AssistantState["status"], number> = {
  idle: 0,
  collecting: 1,
  streaming: 2,
  waiting_for_answer: 3,
  done: 4,
  error: 4
};

const RUN_STATUS_RANK: Record<RunRecord["status"], number> = {
  streaming: 0,
  waiting_for_answer: 1,
  done: 2,
  error: 2
};

const STREAM_STATUS_RANK: Record<AssistantState["stream"]["status"], number> = {
  idle: 0,
  connecting: 1,
  reconnecting: 2,
  streaming: 2,
  waiting_for_answer: 3,
  done: 4,
  error: 4
};

export interface SessionNavigationItem {
  key: string;
  sessionId: string | null;
  latestRun: RunRecord;
  runCount: number;
}

export const DRAFT_SESSION_KEY = "draft:new-session";

function isTerminalAssistantStatus(status: AssistantState["status"]) {
  return status === "done" || status === "error";
}

function isTerminalRunStatus(status: RunRecord["status"] | null | undefined) {
  return status === "done" || status === "error";
}

function isTerminalStreamStatus(status: AssistantState["stream"]["status"]) {
  return status === "done" || status === "error";
}

export function hasTerminalRunEvidence(state: Pick<AssistantState, "status" | "stream" | "currentRun" | "runEvents" | "error" | "errorMessage">) {
  if (state.runEvents.some((event) => event.type === "result" || event.type === "error")) {
    return true;
  }

  if (state.currentRun?.status === "done" && Boolean(state.currentRun.finalOutput?.trim())) {
    return true;
  }

  if (state.currentRun?.status === "error" && Boolean(state.currentRun.errorMessage?.trim() || state.errorMessage || state.error)) {
    return true;
  }

  return false;
}

function getStateRunId(state: Pick<AssistantState, "stream" | "currentRun">) {
  return state.stream.runId ?? state.currentRun?.runId ?? null;
}

export function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isSameRunEvent(current: NormalizedRunEvent, incoming: NormalizedRunEvent) {
  return current.id === incoming.id || (current.runId === incoming.runId && current.sequence === incoming.sequence);
}

export function mergeRunEvent(currentEvents: NormalizedRunEvent[], incomingEvent: NormalizedRunEvent) {
  const existingIndex = currentEvents.findIndex((event) => isSameRunEvent(event, incomingEvent));

  if (existingIndex < 0) {
    return [...currentEvents, incomingEvent];
  }

  const nextEvents = [...currentEvents];
  nextEvents[existingIndex] = incomingEvent;
  return nextEvents;
}

export function deriveRunFinalOutput(currentFinalOutput: string, event: NormalizedRunEvent) {
  if (event.type === "result") {
    return event.message;
  }

  if (event.type === "error") {
    return currentFinalOutput;
  }

  return currentFinalOutput;
}

export function deriveLifecycleStatus(current: AssistantState, event: NormalizedRunEvent, nextEvents: NormalizedRunEvent[]) {
  const pendingQuestionId = getNextPendingQuestionId(current.stream.pendingQuestionId, event);
  const hasResultEvidence = nextEvents.some((item) => item.type === "result");

  if (event.type === "error") {
    return {
      assistantStatus: "error" as const,
      runStatus: "error" as const,
      streamStatus: "error" as const,
      pendingQuestionId: null as string | null
    };
  }

  if (event.type === "question") {
    return {
      assistantStatus: "waiting_for_answer" as const,
      runStatus: "waiting_for_answer" as const,
      streamStatus: "waiting_for_answer" as const,
      pendingQuestionId
    };
  }

  if (event.type === "result" || (isAssistantResponseDeltaEvent(event) && hasResultEvidence)) {
    return {
      assistantStatus: "done" as const,
      runStatus: "done" as const,
      streamStatus: "done" as const,
      pendingQuestionId
    };
  }

  return {
    assistantStatus: pendingQuestionId ? "waiting_for_answer" as const : "streaming" as const,
    runStatus: pendingQuestionId ? "waiting_for_answer" as const : "streaming" as const,
    streamStatus: pendingQuestionId ? "waiting_for_answer" as const : "streaming" as const,
    pendingQuestionId
  };
}

/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-SHELL */
export function mergeStateUpdate(current: AssistantState, payload: AssistantState, history: AssistantState["history"], selectedHistoryDetail: AssistantState["selectedHistoryDetail"]): AssistantState {
  const mergedState: AssistantState = {
    ...current,
    ...payload,
    history,
    selectedHistoryDetail
  };

  const currentRunId = getStateRunId(current);
  const payloadRunId = getStateRunId(payload);
  const isSameActiveRun = Boolean(currentRunId && payloadRunId && currentRunId === payloadRunId);
  const payloadClaimsTerminalState = isTerminalAssistantStatus(payload.status)
    || isTerminalRunStatus(payload.currentRun?.status)
    || isTerminalStreamStatus(payload.stream.status);
  const blockPrematureTerminalMerge = isSameActiveRun && payloadClaimsTerminalState && !hasTerminalRunEvidence(payload);

  if (!isSameActiveRun) {
    return mergedState;
  }

  const keepLocalRunEvents = current.runEvents.length > payload.runEvents.length;
  const keepLocalCurrentRun = Boolean(
    current.currentRun
    && payload.currentRun
    && current.currentRun.runId === payload.currentRun.runId
    && (
      (blockPrematureTerminalMerge && isTerminalRunStatus(payload.currentRun.status))
      || keepLocalRunEvents
      || toTimestamp(current.currentRun.updatedAt) > toTimestamp(payload.currentRun.updatedAt)
      || RUN_STATUS_RANK[current.currentRun.status] > RUN_STATUS_RANK[payload.currentRun.status]
    )
  );
  const keepLocalStream = (
    (blockPrematureTerminalMerge && isTerminalStreamStatus(payload.stream.status))
    || keepLocalRunEvents
    || STREAM_STATUS_RANK[current.stream.status] > STREAM_STATUS_RANK[payload.stream.status]
    || (current.stream.pendingQuestionId === null && payload.stream.pendingQuestionId !== null)
  );
  const keepLocalStatus = (
    (blockPrematureTerminalMerge && isTerminalAssistantStatus(payload.status))
    || keepLocalStream
    || keepLocalCurrentRun
    || ASSISTANT_STATUS_RANK[current.status] > ASSISTANT_STATUS_RANK[payload.status]
    || (current.status === "streaming" && payload.status === "waiting_for_answer")
  );

  if (keepLocalRunEvents) {
    mergedState.runEvents = current.runEvents;
  }

  if (keepLocalCurrentRun && current.currentRun) {
    mergedState.currentRun = current.currentRun;
  }

  if (keepLocalStream) {
    mergedState.stream = current.stream;
  }

  if (keepLocalStatus) {
    mergedState.status = current.status;
  }

  return mergedState;
}

export function cloneRule(rule: PageRule): PageRule {
  return {
    ...rule,
    fields: rule.fields.map((field) => ({ ...field }))
  };
}

export function createEmptyRule(): PageRule {
  const seed = createDefaultRule();
  return {
    ...seed,
    name: "新规则",
    hostnamePattern: "*.example.com",
    pathPattern: "*",
    fields: createDefaultFieldTemplates()
  };
}

export function createFieldRule(): FieldRuleDefinition {
  return {
    id: createId("field"),
    key: "customField",
    label: "自定义字段",
    source: "selectorText",
    selector: "body",
    enabled: true,
    fallbackValue: ""
  };
}

export async function sendMessage<T>(message: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

export function truncateText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function deriveRunTitle(run: Pick<RunRecord, "selectedSr" | "prompt" | "pageTitle" | "softwareVersion">) {
  if (run.selectedSr.trim()) {
    return truncateText(`SR ${run.selectedSr.trim()}`, 40);
  }

  if (run.prompt.trim()) {
    return truncateText(run.prompt, 40);
  }

  if (run.pageTitle.trim()) {
    return truncateText(run.pageTitle, 40);
  }

  if (run.softwareVersion.trim()) {
    return truncateText(`版本 ${run.softwareVersion.trim()}`, 40);
  }

  return "未命名会话";
}

export function deriveRunSummary(run: Pick<RunRecord, "finalOutput" | "errorMessage" | "pageTitle" | "prompt" | "softwareVersion" | "username">) {
  if (run.finalOutput.trim()) {
    return truncateText(run.finalOutput, 84);
  }

  if (run.errorMessage?.trim()) {
    return truncateText(run.errorMessage, 84);
  }

  if (run.pageTitle.trim()) {
    return truncateText(run.pageTitle, 84);
  }

  if (run.prompt.trim()) {
    return truncateText(run.prompt, 84);
  }

  const fallback = [run.softwareVersion.trim(), run.username.trim()].filter(Boolean).join(" · ");
  return truncateText(fallback || "等待更多会话内容", 84);
}

export function deriveSessionKey(run: Pick<RunRecord, "runId" | "sessionId">) {
  return run.sessionId ? `session:${run.sessionId}` : `run:${run.runId}`;
}

export function buildSessionNavigationItems(history: RunRecord[], currentRun: RunRecord | null) {
  const runs = currentRun && !history.some((item) => item.runId === currentRun.runId)
    ? [currentRun, ...history]
    : history;
  const sessions = new Map<string, SessionNavigationItem>();

  for (const run of runs) {
    const key = deriveSessionKey(run);
    const current = sessions.get(key);

    if (!current) {
      sessions.set(key, {
        key,
        sessionId: run.sessionId ?? null,
        latestRun: run,
        runCount: 1
      });
      continue;
    }

    sessions.set(key, {
      ...current,
      latestRun: toTimestamp(run.updatedAt) > toTimestamp(current.latestRun.updatedAt) ? run : current.latestRun,
      runCount: current.runCount + 1
    });
  }

  return [...sessions.values()].sort((left, right) => toTimestamp(right.latestRun.updatedAt) - toTimestamp(left.latestRun.updatedAt));
}
