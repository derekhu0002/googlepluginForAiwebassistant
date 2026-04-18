import { useEffect, useMemo, useRef, useState } from "react";
import { createRawRunEventStream, submitQuestionAnswer } from "../shared/api";
import { toDisplayMessage } from "../shared/errors";
import { initialAssistantState } from "../shared/state";
import { appendTranscriptTraceRecord, DEFAULT_MAIN_AGENT, MAIN_AGENTS, withCanonicalEventMetadata, type NormalizedRunEvent, type TranscriptTraceRecord, createEmptyRunEventState, type MainAgent, type RunHistoryDetail, type RunRecord } from "../shared/protocol";
import type { ActiveTabContext, AssistantState, PageRule, RuntimeMessage, SyncableAssistantRunState } from "../shared/types";
import { getActiveQuestionEvent, hasPendingQuestion } from "./questionState";
import { buildRunDiagnosticsSnapshot, downloadRunDiagnosticsLog, type RunDiagnosticsSource } from "./diagnostics";
import { buildStableTranscriptProjection, resolveCockpitStatusModel, resolveTimelinePresentationState, type BuildChatStreamItemsOptions, type TranscriptReadModel } from "./reasoningTimeline";
import {
  acceptIncomingRunEvent,
  createRunStateSyncMetadata,
  DRAFT_SESSION_KEY,
  buildSessionNavigationItems,
  cloneRule,
  createEmptyRule,
  createFieldRule,
  deriveLifecycleStatus,
  deriveRunFinalOutput,
  deriveRunSummary,
  deriveRunTitle,
  deriveSessionKey,
  hasTerminalRunEvidence,
  mergeStateUpdate,
  sendMessage,
  toTimestamp,
  truncateText
} from "./model";
import { useRunHistory } from "./useRunHistory";
import { appendSidepanelDebugLog, clearSidepanelDebugLogs } from "./debugLogStore";
import { createOpencodeRawEventProjector, type OpencodeRawEventProjector } from "./opencodeRawEventProjector";

export type DrawerKey = "sessions" | "context" | "rules" | "run";

export interface DrawerBarItem {
  key: DrawerKey;
  label: string;
  description: string;
  badge?: string;
  status?: "default" | "pending" | "active";
}

export interface MainAgentOption {
  value: MainAgent;
  label: MainAgent;
  description: string;
}

function logSidepanelRunEvent(entry: Record<string, unknown>) {
  const stored = appendSidepanelDebugLog("sidepanel-run-event", entry);
  console.info("[sidepanel-run-event]", stored.entry);
}

const STREAM_LOG_PREVIEW_LIMIT = 160;

function previewSidepanelLogText(value: string | null | undefined, limit = STREAM_LOG_PREVIEW_LIMIT) {
  const normalized = value?.replace(/\s+/gu, " ").trim() ?? "";
  if (!normalized) {
    return "";
  }

  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function summarizeSidepanelEvent(event: NormalizedRunEvent) {
  return {
    runId: event.runId,
    rawEventId: event.id,
    canonicalEventKey: event.canonical?.key ?? null,
    type: event.type,
    sequence: Number.isFinite(event.sequence) ? event.sequence : null,
    createdAt: event.createdAt,
    semanticIdentity: event.semantic?.identity ?? null,
    messageId: event.semantic?.messageId ?? null,
    partId: event.semantic?.partId ?? null,
    channel: event.semantic?.channel ?? null,
    emissionKind: event.semantic?.emissionKind ?? null,
    messagePreview: previewSidepanelLogText(event.question?.message ?? event.message)
  };
}

function getTransportTrace(entry: Record<string, unknown>) {
  const trace = entry.trace;
  return trace && typeof trace === "object" ? trace as TranscriptTraceRecord : null;
}

function areTranscriptTraceListsEqual(left: TranscriptTraceRecord[] | undefined, right: TranscriptTraceRecord[]) {
  if ((left?.length ?? 0) !== right.length) {
    return false;
  }

  return right.every((trace, index) => {
    const current = left?.[index];
    return JSON.stringify(current) === JSON.stringify(trace);
  });
}

async function syncRunStateToBackground(nextState: SyncableAssistantRunState) {
  logSidepanelRunEvent({
    phase: "sync_to_background",
    runId: nextState.currentRun?.runId ?? nextState.stream.runId,
    acceptedEventCount: nextState.runEventState.frontier.acceptedEventCount,
    lastAcceptedCanonicalKey: nextState.runEventState.frontier.lastAcceptedCanonicalKey,
    snapshotVersion: nextState.syncMetadata?.snapshotVersion ?? 0
  });
  await sendMessage<{ ok: boolean }>({
    type: "SYNC_RUN_STATE",
    payload: nextState
  }).catch(() => ({ ok: false }));
}

function stripDiagnosticMetadata(event: NormalizedRunEvent): NormalizedRunEvent {
  const { canonical: _canonical, observability: _observability, ...rest } = event;
  return rest;
}

// @ArchitectureID: ELM-COMP-EXT-SIDEPANEL
// @ArchitectureID: ELM-FUNC-EXT-CONSUME-RUN-STREAM
// @ArchitectureID: ELM-FUNC-EXT-RENDER-INCREMENTAL-TRANSCRIPT
// @ArchitectureID: ELM-APP-EXT-CONVERSATION-SHELL
// @ArchitectureID: ELM-APP-EXT-CONVERSATION-LIVE-HISTORY-UX
// @ArchitectureID: ELM-APP-EXT-CONVERSATION-RENDERER
// @ArchitectureID: ELM-FUNC-SP-TRACE-STREAM-ACCEPTANCE-FRONTIER
// @ArchitectureID: ELM-FUNC-SP-ASSEMBLE-CORRELATED-TRANSCRIPT-DIAGNOSTICS
// @SoftwareUnitID: SU-SP-RUN-STREAM-CONTROLLER
export function useSidepanelController() {
  const [state, setState] = useState<AssistantState>(initialAssistantState);
  const [rules, setRules] = useState<PageRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [draftRule, setDraftRule] = useState<PageRule | null>(null);
  const [activeContext, setActiveContext] = useState<ActiveTabContext | null>(null);
  const [contextError, setContextError] = useState("");
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [prompt, setPrompt] = useState(initialAssistantState.runPrompt);
  const [streamError, setStreamError] = useState<string>("");
  const [diagnosticsError, setDiagnosticsError] = useState<string>("");
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false);
  const [activeSessionRunDetails, setActiveSessionRunDetails] = useState<RunHistoryDetail[]>([]);
  const [frozenSessionRunDetails, setFrozenSessionRunDetails] = useState<RunHistoryDetail[]>([]);
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null);
  const [activeDrawer, setActiveDrawer] = useState<DrawerKey | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const runHistory = useRunHistory();
  const {
    history,
    selectedHistoryDetail,
    saveRun,
    saveEvent,
    saveAnswer,
    loadRunDetail,
    refresh,
    clearSelectedRun
  } = runHistory;
  const sessionHistory = runHistory.sessionHistory ?? [];
  const historyRef = useRef(history);
  const selectedHistoryDetailRef = useRef(selectedHistoryDetail);
  const refreshHistoryRef = useRef(refresh);
  const transcriptReadModelRef = useRef<TranscriptReadModel | null>(null);
  const rawProjectorRef = useRef<OpencodeRawEventProjector | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasTerminalEvidence = hasTerminalRunEvidence(state);
  const isBusy = state.status === "collecting" || (state.status === "streaming" && !hasTerminalEvidence);
  const hasActiveSession = Boolean(state.activeSessionId ?? state.currentRun?.sessionId);
  const canSendWhileStreaming = state.status === "streaming" && hasActiveSession && hasTerminalEvidence;
  const isSendDisabled = state.status === "collecting" || (state.status === "streaming" && !canSendWhileStreaming) || !prompt.trim();
  const questionEvent = useMemo(() => getActiveQuestionEvent(state.runEvents, state.stream.pendingQuestionId), [state.runEvents, state.stream.pendingQuestionId]);
  const hasLivePendingQuestion = useMemo(() => hasPendingQuestion(state.runEvents, state.stream.pendingQuestionId), [state.runEvents, state.stream.pendingQuestionId]);

  async function loadBaseState() {
    const [currentState, currentRules, context] = await Promise.all([
      sendMessage<AssistantState>({ type: "GET_STATE" }),
      sendMessage<PageRule[]>({ type: "GET_RULES" }),
      sendMessage<ActiveTabContext>({ type: "GET_ACTIVE_CONTEXT" }).catch(() => null as ActiveTabContext | null)
    ]);

    setState((current) => mergeStateUpdate(
      current,
      currentState ?? initialAssistantState,
      historyRef.current,
      selectedHistoryDetailRef.current
    ));
    setRules(currentRules);
    setActiveContext(context);

    if (!selectedRuleId && currentRules[0]) {
      setSelectedRuleId(currentRules[0].id);
      setDraftRule(cloneRule(currentRules[0]));
    }
  }

  useEffect(() => {
    historyRef.current = history;
    selectedHistoryDetailRef.current = selectedHistoryDetail;
    refreshHistoryRef.current = refresh;
  }, [history, selectedHistoryDetail]);

  useEffect(() => {
    loadBaseState().catch(() => undefined);

    const listener = (message: RuntimeMessage) => {
      if (message.type === "STATE_UPDATED") {
        setState((current) => mergeStateUpdate(
          current,
          message.payload,
          historyRef.current,
          selectedHistoryDetailRef.current
        ));
      }
    };

    chrome.runtime.onMessage.addListener(listener as Parameters<typeof chrome.runtime.onMessage.addListener>[0]);
    return () => {
      chrome.runtime.onMessage.removeListener(listener as Parameters<typeof chrome.runtime.onMessage.removeListener>[0]);
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedRuleId && rules[0]) {
      setSelectedRuleId(rules[0].id);
      setDraftRule(cloneRule(rules[0]));
      return;
    }

    if (selectedRuleId) {
      const selected = rules.find((rule) => rule.id === selectedRuleId);
      if (selected) {
        setDraftRule(cloneRule(selected));
      }
    }
  }, [rules, selectedRuleId]);

  useEffect(() => {
    setState((current) => ({ ...current, history, selectedHistoryDetail }));
  }, [history, selectedHistoryDetail]);

  function updateDraft(mutator: (current: PageRule) => PageRule) {
    setDraftRule((current) => current ? mutator(cloneRule(current)) : current);
  }

  function toPermissionErrorMessage(context: ActiveTabContext | null, error?: unknown) {
    if (!context?.url) {
      return "尚未读取当前标签页，暂时无法申请域名权限，请稍后重试。";
    }

    if (!context.permissionOrigin || !context.canRequestPermission) {
      return context.message || "当前页面域名不在可申请授权清单内，请先更新扩展配置或改为在扩展详情页手动授权。";
    }

    if (!chrome.permissions?.request || !chrome.permissions?.contains) {
      return "当前浏览器环境不支持运行时权限授权 API，请前往扩展详情页手动允许该站点访问。";
    }

    if (error instanceof Error && error.message) {
      return `触发当前域名授权失败：${error.message}`;
    }

    return "当前域名授权失败，请重试；如浏览器仍未弹出授权窗口，请前往扩展详情页手动允许该站点访问。";
  }

  async function saveCurrentRule() {
    if (!draftRule) {
      return;
    }

    setSavingRule(true);
    try {
      const nextRules = await sendMessage<PageRule[]>({ type: "UPSERT_RULE", payload: draftRule });
      setRules(nextRules);
      setSelectedRuleId(draftRule.id);
      await loadBaseState();
    } finally {
      setSavingRule(false);
    }
  }

  async function deleteCurrentRule() {
    if (!selectedRuleId) {
      return;
    }

    const nextRules = await sendMessage<PageRule[]>({ type: "DELETE_RULE", payload: { ruleId: selectedRuleId } });
    setRules(nextRules);
    const nextSelected = nextRules[0] ?? null;
    setSelectedRuleId(nextSelected?.id ?? null);
    setDraftRule(nextSelected ? cloneRule(nextSelected) : null);
    await loadBaseState();
  }

  function addRule() {
    const rule = createEmptyRule();
    setSelectedRuleId(rule.id);
    setDraftRule(rule);
    setActiveDrawer("rules");
  }

  async function requestPermission() {
    const context = activeContext;
    setContextError("");

    if (!context?.url || !context.permissionOrigin || !context.canRequestPermission) {
      setContextError(toPermissionErrorMessage(context));
      return;
    }

    if (!chrome.permissions?.request || !chrome.permissions?.contains) {
      setContextError(toPermissionErrorMessage(context));
      return;
    }

    setRequestingPermission(true);
    try {
      const granted = await chrome.permissions.request({ origins: [context.permissionOrigin] });
      if (!granted) {
        setContextError("你已拒绝当前域名授权。请重新点击“授权当前域名”，或前往扩展详情页手动允许该站点访问。");
        return;
      }

      const refreshedContext = await sendMessage<ActiveTabContext>({ type: "GET_ACTIVE_CONTEXT" }).catch(() => null as ActiveTabContext | null);
      if (!refreshedContext?.permissionGranted) {
        setActiveContext(refreshedContext);
        setContextError("浏览器尚未确认当前域名已授权，请检查扩展详情页中的站点访问权限后重试。");
        return;
      }

      setActiveContext(refreshedContext);
      setContextError("");
    } catch (error) {
      setContextError(toPermissionErrorMessage(context, error));
    } finally {
      setRequestingPermission(false);
    }
  }

  const sortedHistory = useMemo(() => [...history].sort((left, right) => toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt)), [history]);
  const currentSessionKey = state.currentRun ? deriveSessionKey(state.currentRun) : null;
  const sessionNavigationItems = useMemo(
    () => buildSessionNavigationItems(sortedHistory, state.currentRun),
    [sortedHistory, state.currentRun]
  );
  const effectiveSelectedSessionKey = selectedSessionKey === DRAFT_SESSION_KEY
    ? DRAFT_SESSION_KEY
    : selectedSessionKey ?? currentSessionKey ?? sessionNavigationItems[0]?.key ?? null;
  const selectedSessionItem = useMemo(
    () => sessionNavigationItems.find((item) => item.key === effectiveSelectedSessionKey) ?? null,
    [effectiveSelectedSessionKey, sessionNavigationItems]
  );
  const selectedHistoryFallbackDetail = useMemo(() => {
    if (selectedSessionItem || state.currentRun || effectiveSelectedSessionKey === DRAFT_SESSION_KEY) {
      return null;
    }

    return selectedHistoryDetail;
  }, [effectiveSelectedSessionKey, selectedHistoryDetail, selectedSessionItem, state.currentRun]);
  const draftSessionSummary = truncateText(prompt.trim() || initialAssistantState.runPrompt, 84);
  const livePresentationState = useMemo(() => resolveTimelinePresentationState({
    events: state.runEvents,
    runStatus: state.currentRun?.status,
    streamStatus: state.stream.status,
    finalOutput: state.currentRun?.finalOutput,
    errorMessage: state.currentRun?.errorMessage ?? state.errorMessage ?? streamError
  }), [state.currentRun?.errorMessage, state.currentRun?.finalOutput, state.currentRun?.status, state.runEvents, state.stream.status, state.errorMessage, streamError]);
  const cockpitStatus = useMemo(() => resolveCockpitStatusModel({
    events: state.runEvents,
    assistantStatus: state.status,
    runStatus: state.currentRun?.status,
    streamStatus: state.stream.status,
    pendingQuestionId: state.stream.pendingQuestionId,
    finalOutput: state.currentRun?.finalOutput,
    errorMessage: state.currentRun?.errorMessage ?? state.errorMessage ?? streamError
  }), [state.currentRun?.errorMessage, state.currentRun?.finalOutput, state.currentRun?.status, state.errorMessage, state.runEvents, state.status, state.stream.pendingQuestionId, state.stream.status, streamError]);
  const shellStatusLabel = cockpitStatus.stageLabel;
  const selectedSessionIsCurrent = !selectedHistoryFallbackDetail && (!effectiveSelectedSessionKey || effectiveSelectedSessionKey === DRAFT_SESSION_KEY || effectiveSelectedSessionKey === currentSessionKey);

  useEffect(() => {
    if (!sessionNavigationItems.length) {
      if (selectedSessionKey !== null && selectedSessionKey !== DRAFT_SESSION_KEY) {
        setSelectedSessionKey(null);
      }
      return;
    }

    if (selectedSessionKey === DRAFT_SESSION_KEY) {
      return;
    }

    if (selectedSessionKey && sessionNavigationItems.some((item) => item.key === selectedSessionKey)) {
      return;
    }

    setSelectedSessionKey(currentSessionKey ?? sessionNavigationItems[0].key);
  }, [currentSessionKey, selectedSessionKey, sessionNavigationItems]);

  useEffect(() => {
    if (!effectiveSelectedSessionKey || effectiveSelectedSessionKey === DRAFT_SESSION_KEY) {
      setActiveSessionRunDetails([]);
      return;
    }

    const selectedRuns = sortedHistory
      .filter((run) => deriveSessionKey(run) === effectiveSelectedSessionKey)
      .filter((run) => !(effectiveSelectedSessionKey === currentSessionKey && run.runId === state.currentRun?.runId))
      .sort((left, right) => toTimestamp(left.startedAt) - toTimestamp(right.startedAt));

    if (!selectedRuns.length) {
      if (!selectedSessionIsCurrent) {
        setActiveSessionRunDetails([]);
      }
      return;
    }

    let cancelled = false;
    Promise.all(selectedRuns.map((run) => loadRunDetail(run.runId)))
      .then((details) => {
        if (cancelled) {
          return;
        }

        const nextDetails = details.filter((detail): detail is RunHistoryDetail => Boolean(detail));
        setActiveSessionRunDetails((currentDetails) => {
          if (
            currentDetails.length === nextDetails.length
            && currentDetails.every((detail, index) => {
              const nextDetail = nextDetails[index];
              return Boolean(nextDetail)
                && detail.run.runId === nextDetail.run.runId
                && detail.run.updatedAt === nextDetail.run.updatedAt
                && detail.events.length === nextDetail.events.length
                && detail.answers.length === nextDetail.answers.length;
            })
          ) {
            return currentDetails;
          }

          return nextDetails;
        });
      })
      .catch(() => {
        if (!cancelled && !selectedSessionIsCurrent) {
          setActiveSessionRunDetails([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentSessionKey, effectiveSelectedSessionKey, loadRunDetail, selectedSessionIsCurrent, sortedHistory, state.currentRun?.runId]);

  const liveFinalOutput = state.currentRun?.finalOutput?.trim() || "";
  const livePrompt = state.currentRun?.prompt ?? prompt;
  const currentLiveRunId = state.currentRun?.runId ?? state.stream.runId ?? null;
  const isStreamingSelectedCurrentSession = selectedSessionIsCurrent
    && (state.status === "streaming" || state.status === "waiting_for_answer")
    && Boolean(currentLiveRunId);

  useEffect(() => {
    if (!selectedSessionIsCurrent) {
      setFrozenSessionRunDetails(activeSessionRunDetails);
      return;
    }

    if (isStreamingSelectedCurrentSession) {
      setFrozenSessionRunDetails((current) => current.length ? current : activeSessionRunDetails);
      return;
    }

    setFrozenSessionRunDetails(activeSessionRunDetails);
  }, [activeSessionRunDetails, isStreamingSelectedCurrentSession, selectedSessionIsCurrent]);

  const historicalConversationSegments = useMemo<BuildChatStreamItemsOptions[]>(() => {
    const historicalRunDetails = selectedSessionIsCurrent ? frozenSessionRunDetails : activeSessionRunDetails;

    if (selectedHistoryFallbackDetail) {
      return [{
        runId: selectedHistoryFallbackDetail.run.runId,
        prompt: selectedHistoryFallbackDetail.run.prompt,
        events: selectedHistoryFallbackDetail.events,
        answers: selectedHistoryFallbackDetail.answers,
      finalOutput: selectedHistoryFallbackDetail.run.finalOutput,
      errorMessage: selectedHistoryFallbackDetail.run.errorMessage,
      status: selectedHistoryFallbackDetail.run.status,
      updatedAt: selectedHistoryFallbackDetail.run.updatedAt ?? selectedHistoryFallbackDetail.run.startedAt,
      pendingQuestionId: null,
      includeToolCallParts: false
    }];
    }

    return historicalRunDetails.map((detail) => ({
      runId: detail.run.runId,
      prompt: detail.run.prompt,
      events: detail.events,
      answers: detail.answers,
      finalOutput: detail.run.finalOutput,
      errorMessage: detail.run.errorMessage,
      status: detail.run.status,
      updatedAt: detail.run.updatedAt ?? detail.run.startedAt,
      pendingQuestionId: null,
      includeToolCallParts: false
    }));
  }, [activeSessionRunDetails, frozenSessionRunDetails, selectedHistoryFallbackDetail, selectedSessionIsCurrent]);

  const liveConversationSegments = historicalConversationSegments;
  const liveTranscriptSegment = useMemo(() => {
    if (!selectedSessionIsCurrent) {
      return null;
    }

    if (!state.currentRun && !state.runEvents.length) {
      return null;
    }

    return {
      runId: state.currentRun?.runId ?? state.stream.runId,
      prompt: livePrompt,
      events: state.runEvents,
      answers: state.answers,
      finalOutput: liveFinalOutput,
      errorMessage: state.currentRun?.errorMessage ?? state.errorMessage ?? streamError,
      status: livePresentationState.runStatus,
      runStatus: livePresentationState.runStatus,
      streamStatus: livePresentationState.streamStatus,
      updatedAt: state.currentRun?.updatedAt ?? state.currentRun?.startedAt,
      pendingQuestionId: state.stream.pendingQuestionId,
      includeSummary: true,
      includeToolCallParts: false
    };
  }, [liveFinalOutput, livePresentationState.runStatus, livePresentationState.streamStatus, livePrompt, selectedSessionIsCurrent, state.answers, state.currentRun, state.errorMessage, state.runEvents, state.stream.pendingQuestionId, state.stream.runId, state.stream.status, streamError]);

  const transcriptReadModel = useMemo(() => {
    const nextModel = buildStableTranscriptProjection({
      historicalSegments: historicalConversationSegments,
      liveSegment: liveTranscriptSegment,
      previousModel: transcriptReadModelRef.current
    });
    transcriptReadModelRef.current = nextModel;
    return nextModel;
  }, [historicalConversationSegments, liveTranscriptSegment]);

  const selectedConversationHasContent = Boolean(
    transcriptReadModel.parts.length
    || transcriptReadModel.summaryPart
  );
  const selectedThreadRun = selectedSessionItem?.latestRun ?? selectedHistoryFallbackDetail?.run ?? state.currentRun;
  const selectedThreadAgent = selectedThreadRun?.selectedAgent ?? state.currentRun?.selectedAgent ?? state.mainAgentPreference;
  const mainAgentOptions = useMemo<MainAgentOption[]>(() => MAIN_AGENTS.map((agent) => ({
    value: agent,
    label: agent,
    description: agent === DEFAULT_MAIN_AGENT ? "默认主 AGENT" : "可切换的备用主 AGENT"
  })), []);
  const nextRunAgentDescription = state.currentRun?.selectedAgent && state.currentRun.selectedAgent !== state.mainAgentPreference
    ? `当前 run 继续使用 ${state.currentRun.selectedAgent}；切换只影响后续新 run。`
    : `后续新 run 将显式使用 ${state.mainAgentPreference}。`;
  const selectedThreadStatus = selectedSessionIsCurrent ? livePresentationState.runStatus : selectedThreadRun?.status;
  const selectedThreadStreamStatus = selectedSessionIsCurrent ? livePresentationState.streamStatus : undefined;
  const selectedThreadUpdatedAt = selectedSessionIsCurrent
    ? (state.currentRun?.updatedAt ?? state.currentRun?.startedAt)
    : (selectedThreadRun?.updatedAt ?? selectedThreadRun?.startedAt);
  const selectedThreadError = selectedSessionIsCurrent
    ? (state.currentRun?.errorMessage ?? state.errorMessage ?? streamError)
    : (selectedThreadRun?.errorMessage ?? null);
  const selectedThreadFinalOutput = selectedSessionIsCurrent
    ? liveFinalOutput
    : (selectedThreadRun?.finalOutput ?? "");
  const currentSessionHistorySummaries = selectedSessionIsCurrent
    ? activeSessionRunDetails.map((detail) => detail.run.finalOutput.trim()).filter(Boolean)
    : [];
  const errorTitle = state.error?.code ? `${state.error.code}` : null;
  const errorDescription = state.error ? toDisplayMessage(state.error) : state.errorMessage || streamError;
  const shouldShowPermissionCallout = Boolean(activeContext?.url && !activeContext.permissionGranted && !activeContext.restricted);
  const canShowPermissionButton = shouldShowPermissionCallout && activeContext?.canRequestPermission;
  const latestRunSummary = selectedThreadFinalOutput || selectedThreadError || currentSessionHistorySummaries.at(-1) || "暂无运行摘要";
  const latestReasoningItems = state.runEvents
    .filter((event) => event.type === "thinking" || event.type === "tool_call")
    .slice(-4)
    .reverse();
  const drawerItems = useMemo<DrawerBarItem[]>(() => [
    {
      key: "sessions",
      label: "会话",
      description: "历史会话与续聊目标",
      badge: sessionNavigationItems.length ? `${sessionNavigationItems.length}` : undefined,
      status: activeDrawer === "sessions" ? "active" : "default"
    },
    {
      key: "context",
      label: "上下文",
      description: "页面状态、权限与参考摘要",
      badge: shouldShowPermissionCallout ? "!" : undefined,
      status: activeDrawer === "context" ? "active" : shouldShowPermissionCallout ? "pending" : "default"
    },
    {
      key: "rules",
      label: "规则",
      description: "页面规则与字段映射",
      badge: rules.length ? `${rules.length}` : undefined,
      status: activeDrawer === "rules" ? "active" : "default"
    },
    {
      key: "run",
      label: "运行",
      description: "运行状态、追问与推理摘要",
      badge: hasLivePendingQuestion ? "!" : undefined,
      status: activeDrawer === "run" ? "active" : hasLivePendingQuestion ? "pending" : "default"
    }
  ], [activeDrawer, hasLivePendingQuestion, rules.length, sessionNavigationItems.length, shouldShowPermissionCallout]);

  async function startStreamingRun(retryPayload?: { prompt?: string; retryFromRunId?: string; retryFromMessageId?: string; capturePageData?: boolean }) {
    setStreamError("");
    eventSourceRef.current?.close();
    clearSelectedRun().catch(() => undefined);
    clearSidepanelDebugLogs();

    const nextPrompt = retryPayload?.prompt ?? prompt;
    if (!nextPrompt.trim()) {
      return;
    }

    setPrompt(nextPrompt);
    const targetSessionItem = sessionNavigationItems.find((item) => item.key === effectiveSelectedSessionKey) ?? null;

    const response = await sendMessage<{ ok: boolean; data?: { runId: string; sessionId?: string; selectedAgent: MainAgent; currentRun: RunRecord }; error?: { message: string } }>({
      type: "START_RUN",
      payload: {
        prompt: nextPrompt,
        selectedAgent: state.mainAgentPreference,
        ...(!retryPayload?.retryFromRunId && targetSessionItem?.sessionId ? { sessionId: targetSessionItem.sessionId } : {}),
        capturePageData: retryPayload?.capturePageData,
        retryFromRunId: retryPayload?.retryFromRunId,
        retryFromMessageId: retryPayload?.retryFromMessageId
      }
    });

    if (!response.ok || !response.data) {
      setStreamError(response.error?.message ?? "启动 run 失败");
      return;
    }

    const responseData = response.data;

    setState((current) => ({
      ...current,
      activeSessionId: responseData.sessionId ?? current.activeSessionId,
      currentRun: responseData.currentRun,
      runEvents: [],
      answers: [],
      status: "streaming",
      runEventState: createEmptyRunEventState(),
      syncMetadata: null,
      stream: {
        runId: responseData.runId,
        status: "connecting",
        pendingQuestionId: null,
        reconnectCount: 0
      }
    }));

    await saveRun(responseData.currentRun, { refresh: false });
    setSelectedSessionKey(deriveSessionKey(responseData.currentRun));

    const processNormalizedEvent = (event: NormalizedRunEvent) => {
      const normalizedEvent = withCanonicalEventMetadata(event);
      logSidepanelRunEvent({
        phase: "stream_event_received",
        ...summarizeSidepanelEvent(normalizedEvent)
      });
      setState((current) => {
        const acceptance = acceptIncomingRunEvent(current.runEvents, normalizedEvent, current.runEventState);
        const nextSyncMetadata = createRunStateSyncMetadata("sidepanel", acceptance.nextRunEventState);
        const enrichedDiagnostic = {
          ...acceptance.diagnostic,
          persistence: {
            eventSaveScheduled: acceptance.accepted || acceptance.decision === "duplicate",
            runSaveScheduled: acceptance.accepted
          },
          sync: {
            origin: nextSyncMetadata.origin,
            snapshotVersion: nextSyncMetadata.snapshotVersion,
            generatedAt: nextSyncMetadata.generatedAt,
            lastAcceptedCanonicalKey: nextSyncMetadata.lastAcceptedCanonicalKey
          }
        };
        const nextRunEventState = {
          ...acceptance.nextRunEventState,
          diagnostics: [
            ...acceptance.nextRunEventState.diagnostics.slice(0, -1),
            enrichedDiagnostic
          ]
        };
        logSidepanelRunEvent({
          phase: "accept_event",
          ...summarizeSidepanelEvent(acceptance.event),
          decision: acceptance.decision,
          priorFrontierSequence: current.runEventState.frontier.lastSequence,
          resultingFrontierSequence: nextRunEventState.frontier.lastSequence,
          priorFrontier: acceptance.diagnostic.priorFrontier,
          resultingFrontier: acceptance.diagnostic.resultingFrontier,
          rejected: !acceptance.accepted
        });

        if (acceptance.accepted || acceptance.decision === "duplicate") {
          void saveEvent(stripDiagnosticMetadata(acceptance.event)).catch(() => undefined);
        }

        if (!acceptance.accepted) {
          return {
            ...current,
            runEvents: acceptance.nextEvents,
            runEventState: nextRunEventState
          };
        }

        const nextEvents = acceptance.nextEvents;
        const lifecycleStatus = deriveLifecycleStatus(current, acceptance.event, nextEvents);
        const nextRun = current.currentRun && current.currentRun.runId === event.runId
          ? {
              ...current.currentRun,
              status: lifecycleStatus.runStatus,
              updatedAt: acceptance.event.createdAt,
              finalOutput: deriveRunFinalOutput(current.currentRun.finalOutput, acceptance.event, nextEvents, lifecycleStatus.runStatus),
              errorMessage: acceptance.event.type === "error" ? acceptance.event.message : current.currentRun.errorMessage
            }
          : current.currentRun;

        const nextState: AssistantState = {
          ...current,
          runEvents: nextEvents,
          runEventState: nextRunEventState,
          currentRun: nextRun,
          status: lifecycleStatus.assistantStatus,
          errorMessage: acceptance.event.type === "error" ? acceptance.event.message : current.errorMessage,
          syncMetadata: nextSyncMetadata,
          stream: {
            runId: acceptance.event.runId,
            status: lifecycleStatus.streamStatus,
            pendingQuestionId: lifecycleStatus.pendingQuestionId,
            reconnectCount: current.stream.reconnectCount ?? 0
          }
        };

        if (nextRun) {
          saveRun(nextRun, { refresh: false }).catch(() => undefined);
        }

        syncRunStateToBackground({
          status: nextState.status,
          activeSessionId: nextState.activeSessionId,
          capturedFields: nextState.capturedFields,
          runPrompt: nextState.runPrompt,
          runEvents: nextState.runEvents,
          currentRun: nextState.currentRun,
          answers: nextState.answers,
          error: nextState.error,
          errorMessage: nextState.errorMessage,
          matchedRule: nextState.matchedRule,
          lastCapturedUrl: nextState.lastCapturedUrl,
          usernameContext: nextState.usernameContext,
          stream: nextState.stream,
          runEventState: nextState.runEventState,
          syncMetadata: nextState.syncMetadata
        }).catch(() => undefined);

        return nextState;
      });
    };

    rawProjectorRef.current = createOpencodeRawEventProjector(responseData.runId);

    eventSourceRef.current = createRawRunEventStream(responseData.runId, {
      onTransportLog: (entry) => {
        logSidepanelRunEvent(entry);
        const trace = getTransportTrace(entry);
        if (!trace) {
          return;
        }
        setState((current) => ({
          ...current,
          runEventState: {
            ...current.runEventState,
            transportTraces: appendTranscriptTraceRecord(current.runEventState.transportTraces, trace)
          }
        }));
      },
      onEvent: async (rawEvent) => {
        const projectedEvents = rawProjectorRef.current?.project(rawEvent) ?? [];
        for (const projectedEvent of projectedEvents) {
          processNormalizedEvent(projectedEvent);
        }

        if (refreshTimerRef.current) {
          clearTimeout(refreshTimerRef.current);
        }

        refreshTimerRef.current = setTimeout(() => {
          refreshHistoryRef.current().catch(() => undefined);
          refreshTimerRef.current = null;
        }, 150);
      },
      onStatusChange: (status) => {
        setState((current) => ({
          ...current,
          stream: {
            ...current.stream,
            status: current.stream.status === "done" || current.stream.status === "error" ? current.stream.status : status,
            reconnectCount: status === "reconnecting"
              ? (current.stream.reconnectCount ?? 0) + 1
              : current.stream.reconnectCount ?? 0
          }
        }));
      },
      onError: (error) => {
        setStreamError(error.message);
      }
    });
  }

  async function handleQuestionSubmit(payload: { answer: string; choiceId?: string }) {
    if (!state.currentRun || !questionEvent?.question) {
      return;
    }

    const submittedAt = new Date().toISOString();

    const answerResponse = await submitQuestionAnswer(state.currentRun.runId, {
      questionId: questionEvent.question.questionId,
      answer: payload.answer,
      choiceId: payload.choiceId
    });

    if (!answerResponse.ok) {
      setStreamError(answerResponse.error.message);
      return;
    }

    const answerRecord = {
      id: `answer-${submittedAt}`,
      runId: state.currentRun.runId,
      questionId: questionEvent.question.questionId,
      answer: payload.answer,
      choiceId: payload.choiceId,
      submittedAt
    };
    await saveAnswer(answerRecord);
    const nextAnswers = [...state.answers, answerRecord];
    const nextCurrentRun = state.currentRun ? {
      ...state.currentRun,
      status: "streaming" as const,
      updatedAt: submittedAt
    } : state.currentRun;

    setState((current) => ({
      ...current,
      currentRun: current.currentRun ? {
        ...current.currentRun,
        status: "streaming",
        updatedAt: submittedAt
      } : current.currentRun,
      answers: [...current.answers, answerRecord],
      status: "streaming",
      stream: {
        ...current.stream,
        status: "streaming",
        pendingQuestionId: null
      }
    }));
    await syncRunStateToBackground({
      status: "streaming",
      activeSessionId: state.activeSessionId,
      capturedFields: state.capturedFields,
      runPrompt: state.runPrompt,
      runEvents: state.runEvents,
      currentRun: nextCurrentRun,
      answers: nextAnswers,
      error: state.error,
      errorMessage: state.errorMessage,
      matchedRule: state.matchedRule,
      lastCapturedUrl: state.lastCapturedUrl,
      usernameContext: state.usernameContext,
      stream: {
        ...state.stream,
        status: "streaming",
        pendingQuestionId: null,
        reconnectCount: state.stream.reconnectCount ?? 0
      },
      runEventState: state.runEventState,
      syncMetadata: createRunStateSyncMetadata("sidepanel", state.runEventState)
    });
    refreshHistoryRef.current().catch(() => undefined);
  }

  async function handleRetry(payload: { prompt: string; runId: string; messageId: string }) {
    await startStreamingRun({
      prompt: payload.prompt,
      capturePageData: false,
      retryFromRunId: payload.runId,
      retryFromMessageId: payload.messageId
    });
  }

  async function handleSelectMainAgent(selectedAgent: MainAgent) {
    if (selectedAgent === state.mainAgentPreference) {
      return;
    }

    const previousAgent = state.mainAgentPreference;

    setState((current) => ({
      ...current,
      mainAgentPreference: selectedAgent
    }));

    const response = await sendMessage<{ ok: boolean; data?: { selectedAgent: MainAgent }; error?: { message: string } }>({
      type: "SET_MAIN_AGENT",
      payload: { selectedAgent }
    });

    if (!response?.ok) {
      setState((current) => ({
        ...current,
        mainAgentPreference: previousAgent
      }));
      setStreamError(response?.error?.message ?? "保存主 AGENT 失败");
    }
  }

  async function handleStartFreshSession() {
    if (isBusy) {
      return;
    }

    eventSourceRef.current?.close();
    setStreamError("");
    setPrompt(initialAssistantState.runPrompt);
    setSelectedSessionKey(DRAFT_SESSION_KEY);
    setActiveDrawer(null);
    await clearSelectedRun().catch(() => undefined);
    await sendMessage<{ ok: boolean }>({ type: "CLEAR_RESULT" }).catch(() => ({ ok: false }));
    await loadBaseState().catch(() => undefined);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  }

  async function handleReturnToCurrentSession() {
    if (state.currentRun) {
      setSelectedSessionKey(deriveSessionKey(state.currentRun));
    }
    setActiveDrawer(null);
    await clearSelectedRun().catch(() => undefined);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  }

  function openDrawer(panel: DrawerKey) {
    setActiveDrawer(panel);
  }

  function closeDrawer() {
    setActiveDrawer(null);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  }

  function toggleDrawer(panel: DrawerKey) {
    if (activeDrawer === panel) {
      closeDrawer();
      return;
    }

    openDrawer(panel);
  }

  async function handleCaptureOnly() {
    if (isBusy) {
      return;
    }
    setStreamError("");
    setState((current) => ({
      ...current,
      status: "collecting",
      errorMessage: ""
    }));
    await sendMessage<{ ok: boolean; error?: { message: string } }>({ type: "RECAPTURE" })
      .then((response) => {
        if (!response?.ok) {
          setStreamError(response?.error?.message ?? "页面采集失败");
        }
      })
      .catch((error: unknown) => {
        setStreamError(error instanceof Error ? error.message : "页面采集失败");
      })
      .finally(() => {
        loadBaseState().catch(() => undefined);
      });
  }

  function handleSelectSession(sessionKey: string) {
    setSelectedSessionKey(sessionKey);
    setActiveDrawer("sessions");
  }

  function handleRenderTrace(traces: TranscriptTraceRecord[]) {
    const activeMessageTrace = traces.find((trace) => trace.step === "render_path");
    const tailTrace = traces.find((trace) => trace.step === "tail_revision");
    const projectionMismatch = traces.find((trace) => trace.step === "projection_vs_render");
    logSidepanelRunEvent({
      phase: "render_trace_updated",
      runId: traces[0]?.correlation.runId ?? null,
      traceCount: traces.length,
      steps: traces.map((trace) => `${trace.stage}:${trace.step}:${trace.outcome}`),
      activeMessageId: activeMessageTrace?.details?.activeMessageId ?? null,
      tailPatchRevision: tailTrace?.details?.tailPatchRevision ?? null,
      tailRenderRevision: tailTrace?.details?.tailRenderRevision ?? null,
      missingRenderedIds: projectionMismatch?.details?.missingRenderedIds ?? []
    });
    setState((current) => {
      if (areTranscriptTraceListsEqual(current.renderTrace, traces)) {
        return current;
      }

      return {
        ...current,
        renderTrace: traces
      };
    });
  }

  function handleSelectRule(rule: PageRule) {
    setSelectedRuleId(rule.id);
    setDraftRule(cloneRule(rule));
    setActiveDrawer("rules");
  }

  function handleAddFieldRule() {
    updateDraft((current) => ({ ...current, fields: [...current.fields, createFieldRule()] }));
  }

  function handleRemoveFieldRule(fieldId: string) {
    updateDraft((current) => ({ ...current, fields: current.fields.filter((item) => item.id !== fieldId) }));
  }

  async function handleExportDiagnostics() {
    const selectedRun = selectedThreadRun;
    if (!selectedRun) {
      setDiagnosticsError("当前没有可导出的 run 诊断信息。");
      return;
    }

    setDiagnosticsError("");
    setExportingDiagnostics(true);

    try {
      const isCurrentRun = Boolean(state.currentRun && state.currentRun.runId === selectedRun.runId);
      let source: RunDiagnosticsSource;

      if (isCurrentRun) {
        source = {
          scope: "live",
          run: state.currentRun ?? selectedRun,
          events: state.runEvents,
          answers: state.answers,
          assistantStatus: state.status,
          streamStatus: state.stream.status,
          pendingQuestionId: state.stream.pendingQuestionId
        };
      } else {
        const detail = selectedHistoryDetail?.run.runId === selectedRun.runId
          ? selectedHistoryDetail
          : await loadRunDetail(selectedRun.runId);

        if (!detail) {
          throw new Error(`未找到 run ${selectedRun.runId} 的历史明细`);
        }

        source = {
          scope: "history",
          run: detail.run,
          events: detail.events,
          answers: detail.answers,
          assistantStatus: detail.run.status,
          streamStatus: detail.run.status === "waiting_for_answer" ? "waiting_for_answer" : detail.run.status,
          pendingQuestionId: null
        };
      }

      const backgroundState = await sendMessage<AssistantState>({ type: "GET_STATE" }).catch(() => null as AssistantState | null);
      const snapshot = buildRunDiagnosticsSnapshot({
        source,
        sidepanelState: state,
        backgroundState,
        transcriptReadModel,
        renderTrace: state.renderTrace ?? []
      });

      downloadRunDiagnosticsLog(snapshot);
    } catch (error) {
      setDiagnosticsError(error instanceof Error ? error.message : "导出诊断日志失败");
    } finally {
      setExportingDiagnostics(false);
    }
  }

  return {
    activeDrawer,
    activeContext,
    activeSessionRunDetails,
    addRule,
    canShowPermissionButton,
    cockpitStatus,
    closeDrawer,
    composerRef,
    contextError,
    currentSessionHistorySummaries,
    drawerItems,
    deleteCurrentRule,
    draftRule,
    draftSessionSummary,
    diagnosticsError,
     effectiveSelectedSessionKey,
    errorDescription,
    errorTitle,
    handleAddFieldRule,
    handleCaptureOnly,
    handleExportDiagnostics,
    handleQuestionSubmit,
    handleRenderTrace,
    handleRemoveFieldRule,
    handleRetry,
    handleReturnToCurrentSession,
    handleSelectMainAgent,
    handleSelectRule,
    handleSelectSession,
    handleStartFreshSession,
    hasActiveSession,
    hasLivePendingQuestion,
    isBusy,
    exportingDiagnostics,
    isSendDisabled,
    liveConversationSegments,
    livePrompt,
    latestReasoningItems,
    latestRunSummary,
    mainAgentOptions,
    nextRunAgentDescription,
    openDrawer,
    prompt,
    questionEvent,
    refresh,
    requestingPermission,
    requestPermission,
    rules,
    saveCurrentRule,
    savingRule,
    selectedConversationHasContent,
    transcriptReadModel,
    selectedRuleId,
    selectedSessionIsCurrent,
    selectedSessionItem,
    selectedThreadAgent,
    selectedThreadError,
    selectedThreadFinalOutput,
    selectedThreadRun,
    selectedThreadStatus,
    selectedThreadStreamStatus,
    selectedThreadUpdatedAt,
    sessionHistory,
    sessionNavigationItems,
    setPrompt,
    shellStatusLabel,
    shouldShowPermissionCallout,
    startStreamingRun,
    state,
    streamError,
    toggleDrawer,
    updateDraft
  };
}
