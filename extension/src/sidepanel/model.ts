import type { AssistantState, FieldRuleDefinition, PageRule, RuntimeMessage } from "../shared/types";
import { createDefaultFieldTemplates, createDefaultRule, createId } from "../shared/rules";
import {
  appendRunEventDiagnostic,
  appendTranscriptTrace,
  appendTranscriptTraceRecord,
  compareRunEventFrontiers,
  createEmptyRunEventFrontier,
  createEmptyRunEventState,
  deriveTranscriptTraceCorrelation,
  deriveRunEventFrontier,
  sortNormalizedRunEvents,
  withCanonicalEventMetadata,
  type NormalizedRunEvent,
  type RunEventDiagnostic,
  type RunEventState,
  type RunStateSyncMetadata,
  type TranscriptTraceRecord,
  type RunRecord
} from "../shared/protocol";
import { collectRunAssistantResponseText, isAssistantResponseDeltaEvent } from "./reasoningTimeline";
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

export interface RunEventAcceptanceResult {
  accepted: boolean;
  decision: RunEventDiagnostic["decision"];
  event: NormalizedRunEvent;
  nextEvents: NormalizedRunEvent[];
  nextRunEventState: RunEventState;
  diagnostic: RunEventDiagnostic;
}

function logRunAcceptance(entry: Record<string, unknown>) {
  console.info("[sidepanel-run-acceptance]", entry);
}

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
  const currentCanonical = current.canonical?.key ?? withCanonicalEventMetadata(current).canonical?.key;
  const incomingCanonical = incoming.canonical?.key ?? withCanonicalEventMetadata(incoming).canonical?.key;
  return current.id === incoming.id
    || (Boolean(currentCanonical) && currentCanonical === incomingCanonical)
    || (current.runId === incoming.runId && current.sequence === incoming.sequence && current.type === incoming.type);
}

export function mergeRunEvent(currentEvents: NormalizedRunEvent[], incomingEvent: NormalizedRunEvent) {
  const normalizedIncomingEvent = withCanonicalEventMetadata(incomingEvent);
  const normalizedCurrentEvents = currentEvents.map((event) => withCanonicalEventMetadata(event));
  const existingIndex = normalizedCurrentEvents.findIndex((event) => isSameRunEvent(event, normalizedIncomingEvent));

  if (existingIndex < 0) {
    return sortNormalizedRunEvents([...normalizedCurrentEvents, normalizedIncomingEvent]);
  }

  const nextEvents = [...normalizedCurrentEvents];
  nextEvents[existingIndex] = {
    ...nextEvents[existingIndex],
    ...normalizedIncomingEvent,
    id: nextEvents[existingIndex]?.id ?? normalizedIncomingEvent.id,
    canonical: normalizedIncomingEvent.canonical ?? nextEvents[existingIndex]?.canonical
  };
  return sortNormalizedRunEvents(nextEvents);
}

export function normalizeRunEventState(runEvents: NormalizedRunEvent[], runEventState?: RunEventState | null): RunEventState {
  const acceptedEvents = sortNormalizedRunEvents(runEvents);
  const acceptedCanonicalKeys = acceptedEvents.map((event) => event.canonical?.key ?? withCanonicalEventMetadata(event).canonical!.key);
  const frontier = deriveRunEventFrontier(acceptedEvents);
  return {
    frontier,
    acceptedCanonicalKeys,
    diagnostics: runEventState?.diagnostics ?? [],
    transportTraces: runEventState?.transportTraces ?? []
  };
}

export function createRunStateSyncMetadata(origin: RunStateSyncMetadata["origin"], runEventState: RunEventState): RunStateSyncMetadata {
  return {
    origin,
    snapshotVersion: runEventState.frontier.version,
    generatedAt: new Date().toISOString(),
    frontier: runEventState.frontier,
    lastAcceptedCanonicalKey: runEventState.frontier.lastAcceptedCanonicalKey
  };
}

/** @ArchitectureID: ELM-FUNC-EXT-CONSUME-RUN-STREAM */
/** @ArchitectureID: ELM-FUNC-SP-TRACE-STREAM-ACCEPTANCE-FRONTIER */
/** @SoftwareUnitID: SU-SP-RUN-STREAM-CONTROLLER */
export function acceptIncomingRunEvent(
  currentEvents: NormalizedRunEvent[],
  incomingEvent: NormalizedRunEvent,
  runEventState?: RunEventState | null
): RunEventAcceptanceResult {
  const normalizedCurrentEvents = sortNormalizedRunEvents(currentEvents);
  const currentState = normalizeRunEventState(normalizedCurrentEvents, runEventState);
  const event = withCanonicalEventMetadata(incomingEvent);
  const priorFrontier = currentState.frontier ?? createEmptyRunEventFrontier();
  const canonicalKey = event.canonical?.key ?? null;
  const currentAcceptedCanonicalKeys = new Set(currentState.acceptedCanonicalKeys);
  const sequence = Number.isFinite(event.sequence) ? event.sequence : null;

  const acceptanceTraceBase = {
    stage: "acceptance",
    step: "decision",
    createdAt: new Date().toISOString(),
    correlation: deriveTranscriptTraceCorrelation(event)
  } satisfies Omit<TranscriptTraceRecord, "outcome">;

  let decision: RunEventDiagnostic["decision"] = "accepted";
  let classification: RunEventDiagnostic["classification"] = "in_order";
  let accepted = true;

  if (!canonicalKey) {
    decision = "invalid";
    classification = undefined;
    accepted = false;
  } else if (currentAcceptedCanonicalKeys.has(canonicalKey)) {
    decision = "duplicate";
    accepted = false;
  } else if (
    sequence !== null
    && priorFrontier.contiguousSequence !== null
    && sequence <= priorFrontier.contiguousSequence
  ) {
    decision = "stale_replay";
    accepted = false;
  } else if (
    sequence !== null
    && priorFrontier.lastSequence !== null
    && sequence > priorFrontier.lastSequence + 1
  ) {
    decision = "gap";
    classification = "gap";
  } else if (
    sequence !== null
    && priorFrontier.lastSequence !== null
    && sequence <= priorFrontier.lastSequence
  ) {
    decision = "out_of_order";
    classification = "out_of_order";
  }

  const provisionalTracedEvent = appendTranscriptTrace(event, {
    ...acceptanceTraceBase,
    outcome: accepted ? "accepted" : "rejected",
    details: {
      decision,
      classification,
      priorFrontier,
      resultingFrontier: null
    }
  });
  const nextEvents = accepted ? mergeRunEvent(normalizedCurrentEvents, provisionalTracedEvent) : normalizedCurrentEvents;
  const nextRunEventStateBase = normalizeRunEventState(nextEvents, currentState);
  const acceptanceTrace: TranscriptTraceRecord = {
    ...acceptanceTraceBase,
    outcome: accepted ? "accepted" : "rejected",
    details: {
      decision,
      classification,
      priorFrontier,
      resultingFrontier: nextRunEventStateBase.frontier
    }
  };
  const tracedEvent = appendTranscriptTrace(event, acceptanceTrace);
  const tracedNextEvents = accepted ? mergeRunEvent(normalizedCurrentEvents, tracedEvent) : normalizedCurrentEvents;
  const transportAndAcceptanceTraces = [
    ...(event.observability?.traces ?? []),
    acceptanceTrace
  ];
  const diagnostic: RunEventDiagnostic = {
    runId: tracedEvent.runId,
    source: "sidepanel",
    decision,
    classification,
    createdAt: new Date().toISOString(),
    rawEventId: tracedEvent.id,
    canonicalEventKey: canonicalKey,
    sequence,
    priorFrontierSequence: priorFrontier.lastSequence,
    resultingFrontierSequence: nextRunEventStateBase.frontier.lastSequence,
    semanticIdentity: tracedEvent.semantic?.identity,
    messageId: tracedEvent.semantic?.messageId,
    partId: tracedEvent.semantic?.partId,
    channel: tracedEvent.semantic?.channel,
    emissionKind: tracedEvent.semantic?.emissionKind,
    identitySource: tracedEvent.canonical?.identitySource,
    priorFrontier,
    resultingFrontier: nextRunEventStateBase.frontier,
    reason: accepted ? undefined : decision === "stale_replay"
      ? "incoming event did not advance accepted contiguous frontier"
      : decision === "duplicate"
        ? "canonical key already accepted"
        : decision === "invalid"
          ? "missing canonical identity"
          : undefined
  };
  const shouldReplaceSameSequenceReplay = accepted === false
    && decision === "duplicate"
    && sequence !== null
    && normalizedCurrentEvents.some((existingEvent) => existingEvent.sequence === sequence && existingEvent.type === event.type);
  const effectiveNextEvents = shouldReplaceSameSequenceReplay
    ? mergeRunEvent(normalizedCurrentEvents, tracedEvent)
    : tracedNextEvents;
  const nextRunEventState: RunEventState = {
    ...normalizeRunEventState(effectiveNextEvents, currentState),
    diagnostics: appendRunEventDiagnostic(currentState.diagnostics, diagnostic),
    transportTraces: transportAndAcceptanceTraces.reduce(
      (traces, trace) => appendTranscriptTraceRecord(traces, trace),
      currentState.transportTraces
    )
  };

  logRunAcceptance({
    runId: event.runId,
    rawEventId: event.id,
    canonicalEventKey: canonicalKey,
    decision,
    sequence,
    priorFrontierSequence: priorFrontier.lastSequence,
    resultingFrontierSequence: nextRunEventState.frontier.lastSequence,
    identitySource: event.canonical?.identitySource,
    semanticIdentity: event.semantic?.identity,
    messageId: event.semantic?.messageId,
    partId: event.semantic?.partId,
    channel: event.semantic?.channel,
    emissionKind: event.semantic?.emissionKind
  });

  return {
    accepted,
    decision,
    event: tracedEvent,
    nextEvents: effectiveNextEvents,
    nextRunEventState,
    diagnostic
  };
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
  const normalizedCurrentRunEventState = normalizeRunEventState(current.runEvents, current.runEventState);
  const normalizedPayloadRunEventState = normalizeRunEventState(payload.runEvents, payload.runEventState);
  const mergedState: AssistantState = {
    ...current,
    ...payload,
    history,
    selectedHistoryDetail,
    runEventState: normalizedPayloadRunEventState
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

  const keepLocalRunEvents = compareRunEventFrontiers(normalizedCurrentRunEventState.frontier, normalizedPayloadRunEventState.frontier) > 0;
  const currentVisibleAssistantText = collectRunAssistantResponseText(current.runEvents, current.currentRun?.finalOutput ?? "");
  const payloadVisibleAssistantText = collectRunAssistantResponseText(payload.runEvents, payload.currentRun?.finalOutput ?? "");
  const keepLocalAssistantBody = Boolean(
    current.currentRun
    && payload.currentRun
    && current.currentRun.runId === payload.currentRun.runId
    && currentVisibleAssistantText.trim()
    && currentVisibleAssistantText.trim() !== payloadVisibleAssistantText.trim()
    && currentVisibleAssistantText.trim().length > payloadVisibleAssistantText.trim().length
  );
  const keepLocalCurrentRun = Boolean(
    current.currentRun
    && payload.currentRun
    && current.currentRun.runId === payload.currentRun.runId
    && (
      (blockPrematureTerminalMerge && isTerminalRunStatus(payload.currentRun.status))
      || keepLocalAssistantBody
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
    mergedState.runEventState = normalizedCurrentRunEventState;
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

  if (!keepLocalRunEvents) {
    mergedState.runEvents = sortNormalizedRunEvents(payload.runEvents);
    mergedState.runEventState = normalizedPayloadRunEventState;
  }

  if (
    current.syncMetadata
    && payload.syncMetadata
    && compareRunEventFrontiers(normalizedCurrentRunEventState.frontier, normalizedPayloadRunEventState.frontier) > 0
  ) {
    mergedState.syncMetadata = current.syncMetadata;
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
