import type { AnswerRecord, NormalizedRunEvent, RunRecord, TranscriptTraceRecord } from "../shared/protocol";
import type { AssistantState } from "../shared/types";
import { getSidepanelDebugLogs, type SidepanelDebugLogEntry } from "./debugLogStore";
import { hasTerminalRunEvidence, truncateText } from "./model";
import { buildStableTranscriptProjection, resolveCockpitStatusModel, resolveTimelinePresentationState, type TranscriptPartModel, type TranscriptReadModel } from "./reasoningTimeline";

export interface RunDiagnosticsSource {
  scope: "live" | "history";
  run: RunRecord;
  events: NormalizedRunEvent[];
  answers: AnswerRecord[];
  assistantStatus?: AssistantState["status"];
  streamStatus?: AssistantState["stream"]["status"];
  pendingQuestionId?: string | null;
}

export interface RunDiagnosticsSnapshot {
  exportedAt: string;
  exportScope: RunDiagnosticsSource["scope"];
  runMetadata: {
    runId: string;
    sessionId: string | null;
    prompt: string;
    selectedAgent: RunRecord["selectedAgent"];
    status: RunRecord["status"];
    streamStatus: AssistantState["stream"]["status"] | null;
    finalOutputLength: number;
    startedAt: string;
    updatedAt: string;
    pageTitle: string;
    pageUrl: string;
    username: string;
    usernameSource: RunRecord["usernameSource"];
  };
  sidepanelStatusSummary: ReturnType<typeof summarizeAssistantState>;
  backgroundStatusSummary: ReturnType<typeof summarizeAssistantState> | null;
  derived: {
    presentationState: ReturnType<typeof resolveTimelinePresentationState>;
    cockpitStatus: ReturnType<typeof resolveCockpitStatusModel>;
    hasTerminalRunEvidence: boolean;
    eventCounts: Partial<Record<NormalizedRunEvent["type"], number>>;
    visibilityHints: {
      visiblePartCount: number;
      visibleToolPartCount: number;
      visibleReasoningPartCount: number;
      withToolsPartCount: number;
      withToolsToolPartCount: number;
      withToolsReasoningPartCount: number;
      hiddenToolPartCount: number;
      hiddenReasoningPartCount: number;
    };
  };
  sessionUi: {
    mainStageTranscriptSource: "transcript.visible";
    includeToolCallParts: false;
    displayRule: string;
    displayedPartCount: number;
    hiddenDiagnosticOnlyPartCount: number;
    displayedParts: ReturnType<typeof summarizeTranscriptPartsForDiagnostics>;
    diagnosticOnlyParts: ReturnType<typeof summarizeTranscriptPartsForDiagnostics>;
  };
  transcript: {
    visible: ReturnType<typeof summarizeTranscriptReadModel>;
    withTools: ReturnType<typeof summarizeTranscriptReadModel>;
  };
  observability: {
    stageCounts: Record<string, number>;
    earliestAnomalyStage: "transport" | "acceptance" | "projection" | "render" | null;
    stageSequence: TranscriptTraceRecord[];
    correlationIndex: Array<{
      runId: string;
      canonicalEventKey: string | null;
      rawEventId: string | null;
      stages: string[];
      outcomes: string[];
      contentPreview: string;
    }>;
  };
  debugLogs: SidepanelDebugLogEntry[];
  answers: AnswerRecord[];
  events: Array<{
    id: string;
    type: NormalizedRunEvent["type"];
    sequence: number;
    createdAt: string;
    title?: string;
    message: string;
    semantic?: NormalizedRunEvent["semantic"];
    logData?: Record<string, unknown>;
    data?: Record<string, unknown>;
    question?: NormalizedRunEvent["question"];
  }>;
}

function countByEventType(events: NormalizedRunEvent[]) {
  return events.reduce<Partial<Record<NormalizedRunEvent["type"], number>>>((counts, event) => {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
    return counts;
  }, {});
}

function countTranscriptParts(parts: TranscriptPartModel[], kind: TranscriptPartModel["kind"]) {
  return parts.filter((part) => part.kind === kind).length;
}

function summarizeTranscriptReadModel(model: TranscriptReadModel, includeToolCallParts: boolean) {
  return {
    includeToolCallParts,
    messageCount: model.messages.length,
    partCount: model.parts.length,
    summaryPresent: Boolean(model.summaryPart),
    partCountsByKind: model.parts.reduce<Partial<Record<TranscriptPartModel["kind"], number>>>((counts, part) => {
      counts[part.kind] = (counts[part.kind] ?? 0) + 1;
      return counts;
    }, {}),
    liveProjectionDebug: model.liveProjectionDebug ?? null,
    liveProjectionState: model.liveProjectionState
      ? {
          runId: model.liveProjectionState.runId,
          eventCount: model.liveProjectionState.eventCount,
          answerCount: model.liveProjectionState.answerCount,
          lastEventId: model.liveProjectionState.lastEventId,
          lastEventCreatedAt: model.liveProjectionState.lastEventCreatedAt,
          latestResultTextPreview: truncateText(model.liveProjectionState.latestResultText, 160),
          assistantResponseTextPreview: truncateText(model.liveProjectionState.assistantResponse.text, 160),
          includeToolCallParts: model.liveProjectionState.includeToolCallParts
        }
      : null,
    parts: summarizeTranscriptPartsForDiagnostics(model.parts)
  };
}

function summarizeTranscriptPartsForDiagnostics(parts: TranscriptPartModel[]) {
  return parts.map((part) => ({
    id: part.id,
    role: part.role,
    kind: part.kind,
    runId: part.runId,
    createdAt: part.createdAt,
    updatedAt: part.updatedAt,
    originEventTypes: part.originEventTypes,
    pendingQuestion: part.pendingQuestion ?? false,
    textPreview: truncateText(part.text, 160),
    detailPreview: truncateText(part.detail ?? "", 160)
  }));
}

function summarizeAssistantState(state: AssistantState | null, runId: string) {
  if (!state) {
    return null;
  }

  const currentRunPresentationState = state.currentRun
    ? resolveTimelinePresentationState({
        events: state.runEvents,
        runStatus: state.currentRun.status,
        streamStatus: state.stream.status,
        finalOutput: state.currentRun.finalOutput,
        errorMessage: state.currentRun.errorMessage ?? state.errorMessage
      })
    : null;

  return {
    status: state.status,
    uiMode: state.uiMode,
    activeSessionId: state.activeSessionId,
    currentRunId: state.currentRun?.runId ?? null,
    currentRunMatchesExportedRun: state.currentRun?.runId === runId,
    currentRunStatus: state.currentRun?.status ?? null,
    currentRunUpdatedAt: state.currentRun?.updatedAt ?? null,
    currentRunFinalOutputLength: state.currentRun?.finalOutput.length ?? 0,
    runEventCount: state.runEvents.length,
    answerCount: state.answers.length,
    stream: {
      runId: state.stream.runId,
      status: state.stream.status,
      pendingQuestionId: state.stream.pendingQuestionId
    },
    matchedRule: state.matchedRule,
    lastCapturedUrl: state.lastCapturedUrl,
    errorMessage: state.errorMessage || state.error?.message || "",
    lastUpdatedAt: state.lastUpdatedAt,
    hasTerminalRunEvidence: hasTerminalRunEvidence(state),
    currentRunPresentationState,
    renderTraceCount: state.renderTrace?.length ?? 0
  };
}

function getTraceSortKey(trace: TranscriptTraceRecord) {
  return [trace.createdAt, trace.stage, trace.step, trace.correlation.canonicalEventKey ?? trace.correlation.rawEventId ?? ""].join("|");
}

function summarizeObservability(stageSequence: TranscriptTraceRecord[]) {
  const ordered = [...stageSequence].sort((left, right) => getTraceSortKey(left).localeCompare(getTraceSortKey(right)));
  const stageCounts = ordered.reduce<Record<string, number>>((counts, trace) => {
    counts[trace.stage] = (counts[trace.stage] ?? 0) + 1;
    return counts;
  }, {});
  const earliestAnomalyStage = ordered.find((trace) => trace.outcome === "failure" || trace.outcome === "rejected" || trace.outcome === "anomaly")?.stage ?? null;
  const correlationMap = new Map<string, {
    runId: string;
    canonicalEventKey: string | null;
    rawEventId: string | null;
    stages: string[];
    outcomes: string[];
    contentPreview: string;
  }>();

  for (const trace of ordered) {
    const correlationKey = [trace.correlation.runId, trace.correlation.canonicalEventKey ?? trace.correlation.rawEventId ?? trace.correlation.contentKey ?? trace.step].join("::");
    const current = correlationMap.get(correlationKey) ?? {
      runId: trace.correlation.runId,
      canonicalEventKey: trace.correlation.canonicalEventKey,
      rawEventId: trace.correlation.rawEventId,
      stages: [],
      outcomes: [],
      contentPreview: trace.correlation.contentPreview
    };
    if (!current.stages.includes(trace.stage)) {
      current.stages.push(trace.stage);
    }
    current.outcomes.push(trace.outcome);
    correlationMap.set(correlationKey, current);
  }

  return {
    stageCounts,
    earliestAnomalyStage,
    stageSequence: ordered,
    correlationIndex: [...correlationMap.values()]
  };
}

function buildRunTranscriptModel(source: RunDiagnosticsSource, includeToolCallParts: boolean) {
  const presentationState = resolveTimelinePresentationState({
    events: source.events,
    runStatus: source.run.status,
    streamStatus: source.streamStatus,
    finalOutput: source.run.finalOutput,
    errorMessage: source.run.errorMessage
  });

  return buildStableTranscriptProjection({
    historicalSegments: [],
    liveSegment: {
      runId: source.run.runId,
      prompt: source.run.prompt,
      events: source.events,
      answers: source.answers,
      finalOutput: source.run.finalOutput,
      errorMessage: source.run.errorMessage,
      status: source.run.status,
      runStatus: presentationState.runStatus,
      streamStatus: presentationState.streamStatus,
      updatedAt: source.run.updatedAt,
      pendingQuestionId: source.pendingQuestionId ?? null,
      includeSummary: true,
      includeToolCallParts
    }
  });
}

// @ArchitectureID: ELM-FUNC-SP-ASSEMBLE-CORRELATED-TRANSCRIPT-DIAGNOSTICS
// @SoftwareUnitID: SU-SP-RUN-DIAGNOSTICS-EXPORT
export function buildRunDiagnosticsSnapshot(options: {
  source: RunDiagnosticsSource;
  sidepanelState: AssistantState;
  backgroundState: AssistantState | null;
  transcriptReadModel?: TranscriptReadModel | null;
  renderTrace?: TranscriptTraceRecord[];
  exportedAt?: string;
}): RunDiagnosticsSnapshot {
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const presentationState = resolveTimelinePresentationState({
    events: options.source.events,
    runStatus: options.source.run.status,
    streamStatus: options.source.streamStatus,
    finalOutput: options.source.run.finalOutput,
    errorMessage: options.source.run.errorMessage
  });
  const cockpitStatus = resolveCockpitStatusModel({
    events: options.source.events,
    assistantStatus: options.source.assistantStatus,
    runStatus: options.source.run.status,
    streamStatus: options.source.streamStatus,
    pendingQuestionId: options.source.pendingQuestionId,
    finalOutput: options.source.run.finalOutput,
    errorMessage: options.source.run.errorMessage
  });
  const visibleTranscript = buildRunTranscriptModel(options.source, false);
  const withToolsTranscript = buildRunTranscriptModel(options.source, true);
  const visibleSummary = summarizeTranscriptReadModel(visibleTranscript, false);
  const withToolsSummary = summarizeTranscriptReadModel(withToolsTranscript, true);
  const visiblePartIds = new Set(visibleTranscript.parts.map((part) => part.id));
  const diagnosticOnlyParts = summarizeTranscriptPartsForDiagnostics(
    withToolsTranscript.parts.filter((part) => !visiblePartIds.has(part.id))
  );
  const visibleToolPartCount = countTranscriptParts(visibleTranscript.parts, "tool");
  const visibleReasoningPartCount = countTranscriptParts(visibleTranscript.parts, "reasoning");
  const withToolsToolPartCount = countTranscriptParts(withToolsTranscript.parts, "tool");
  const withToolsReasoningPartCount = countTranscriptParts(withToolsTranscript.parts, "reasoning");
  const stageSequence = [
    ...(options.source.scope === "live" ? options.sidepanelState.runEventState.transportTraces : []),
    ...(options.source.events.flatMap((event) => event.observability?.traces ?? [])),
    ...(options.transcriptReadModel?.projectionTraces ?? []),
    ...(options.renderTrace ?? [])
  ];
  const debugLogs = getSidepanelDebugLogs(options.source.run.runId);

  return {
    exportedAt,
    exportScope: options.source.scope,
    runMetadata: {
      runId: options.source.run.runId,
      sessionId: options.source.run.sessionId ?? null,
      prompt: options.source.run.prompt,
      selectedAgent: options.source.run.selectedAgent,
      status: options.source.run.status,
      streamStatus: options.source.streamStatus ?? null,
      finalOutputLength: options.source.run.finalOutput.length,
      startedAt: options.source.run.startedAt,
      updatedAt: options.source.run.updatedAt,
      pageTitle: options.source.run.pageTitle,
      pageUrl: options.source.run.pageUrl,
      username: options.source.run.username,
      usernameSource: options.source.run.usernameSource
    },
    sidepanelStatusSummary: summarizeAssistantState(options.sidepanelState, options.source.run.runId),
    backgroundStatusSummary: summarizeAssistantState(options.backgroundState, options.source.run.runId),
    derived: {
      presentationState,
      cockpitStatus,
      hasTerminalRunEvidence: hasTerminalRunEvidence({
        status: options.source.assistantStatus ?? options.sidepanelState.status,
        stream: {
          runId: options.source.run.runId,
          status: options.source.streamStatus ?? options.sidepanelState.stream.status,
          pendingQuestionId: options.source.pendingQuestionId ?? null
        },
        currentRun: options.source.run,
        runEvents: options.source.events,
        error: null,
        errorMessage: options.source.run.errorMessage ?? ""
      }),
      eventCounts: countByEventType(options.source.events),
      visibilityHints: {
        visiblePartCount: visibleTranscript.parts.length,
        visibleToolPartCount,
        visibleReasoningPartCount,
        withToolsPartCount: withToolsTranscript.parts.length,
        withToolsToolPartCount,
        withToolsReasoningPartCount,
        hiddenToolPartCount: Math.max(0, withToolsToolPartCount - visibleToolPartCount),
        hiddenReasoningPartCount: Math.max(0, withToolsReasoningPartCount - visibleReasoningPartCount)
      }
    },
    sessionUi: {
      mainStageTranscriptSource: "transcript.visible",
      includeToolCallParts: false,
      displayRule: "MainStage renders transcriptReadModel built with includeToolCallParts=false, so transcript.visible is the session UI view. Parts listed in diagnosticOnlyParts are export-only diagnostics and are not shown in the main session transcript by default.",
      displayedPartCount: visibleSummary.partCount,
      hiddenDiagnosticOnlyPartCount: diagnosticOnlyParts.length,
      displayedParts: visibleSummary.parts,
      diagnosticOnlyParts
    },
    transcript: {
      visible: visibleSummary,
      withTools: withToolsSummary
    },
    observability: summarizeObservability(stageSequence),
    debugLogs,
    answers: options.source.answers,
    events: options.source.events.map((event) => ({
      id: event.id,
      type: event.type,
      sequence: event.sequence,
      createdAt: event.createdAt,
      title: event.title,
      message: event.message,
      semantic: event.semantic,
      logData: event.logData,
      data: event.data,
      question: event.question
    }))
  };
}

export function formatRunDiagnosticsLog(snapshot: RunDiagnosticsSnapshot) {
  return [
    "AI Web Assistant diagnostics export",
    `exportedAt: ${snapshot.exportedAt}`,
    `scope: ${snapshot.exportScope}`,
    "",
    "=== RUN_METADATA ===",
    JSON.stringify(snapshot.runMetadata, null, 2),
    "",
    "=== SIDEPANEL_STATUS_SUMMARY ===",
    JSON.stringify(snapshot.sidepanelStatusSummary, null, 2),
    "",
    "=== BACKGROUND_STATUS_SUMMARY ===",
    JSON.stringify(snapshot.backgroundStatusSummary, null, 2),
    "",
    "=== DERIVED ===",
    JSON.stringify(snapshot.derived, null, 2),
    "",
    "=== SESSION_UI ===",
    JSON.stringify(snapshot.sessionUi, null, 2),
    "",
    "=== ANSWERS ===",
    JSON.stringify(snapshot.answers, null, 2),
    "",
    "=== TRANSCRIPT_VISIBLE ===",
    JSON.stringify(snapshot.transcript.visible, null, 2),
    "",
    "=== TRANSCRIPT_WITH_TOOLS ===",
    JSON.stringify(snapshot.transcript.withTools, null, 2),
    "",
    "=== OBSERVABILITY ===",
    JSON.stringify(snapshot.observability, null, 2),
    "",
    "=== DEBUG_LOGS ===",
    JSON.stringify(snapshot.debugLogs, null, 2),
    "",
    "=== EVENTS ===",
    JSON.stringify(snapshot.events, null, 2),
    ""
  ].join("\n");
}

export function createRunDiagnosticsFilename(runId: string, exportedAt: string) {
  return `aiwa-diagnostics-${runId}-${exportedAt.replace(/[:.]/g, "-")}.log`;
}

export function downloadRunDiagnosticsLog(snapshot: RunDiagnosticsSnapshot) {
  const fileName = createRunDiagnosticsFilename(snapshot.runMetadata.runId, snapshot.exportedAt);
  const blob = new Blob([formatRunDiagnosticsLog(snapshot)], { type: "text/plain;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
