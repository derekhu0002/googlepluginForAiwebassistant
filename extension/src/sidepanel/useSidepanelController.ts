import { useEffect, useMemo, useRef, useState } from "react";
import { createRunEventStream, submitQuestionAnswer } from "../shared/api";
import { toDisplayMessage } from "../shared/errors";
import { initialAssistantState } from "../shared/state";
import type { RunHistoryDetail, RunRecord } from "../shared/protocol";
import type { ActiveTabContext, AssistantState, PageRule, RuntimeMessage } from "../shared/types";
import { getActiveQuestionEvent, hasPendingQuestion } from "./questionState";
import { resolveCockpitStatusModel, resolveTimelinePresentationState, type BuildChatStreamItemsOptions } from "./reasoningTimeline";
import {
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
  mergeRunEvent,
  mergeStateUpdate,
  sendMessage,
  toTimestamp,
  truncateText
} from "./model";
import { useRunHistory } from "./useRunHistory";

export type DrawerKey = "sessions" | "context" | "rules" | "run";

export interface DrawerBarItem {
  key: DrawerKey;
  label: string;
  description: string;
  badge?: string;
  status?: "default" | "pending" | "active";
}

async function syncRunStateToBackground(nextState: Pick<AssistantState, "status" | "activeSessionId" | "capturedFields" | "runPrompt" | "runEvents" | "currentRun" | "answers" | "error" | "errorMessage" | "matchedRule" | "lastCapturedUrl" | "usernameContext" | "stream">) {
  await sendMessage<{ ok: boolean }>({
    type: "SYNC_RUN_STATE",
    payload: nextState
  }).catch(() => ({ ok: false }));
}

/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-SHELL */
/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-LIVE-HISTORY-UX */
/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-RENDERER */
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
  const [activeSessionRunDetails, setActiveSessionRunDetails] = useState<RunHistoryDetail[]>([]);
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

  const isBusy = state.status === "collecting" || state.status === "streaming";
  const hasActiveSession = Boolean(state.activeSessionId ?? state.currentRun?.sessionId);
  const canSendWhileStreaming = state.status === "streaming" && hasActiveSession && hasTerminalRunEvidence(state);
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
    return () => chrome.runtime.onMessage.removeListener(listener as Parameters<typeof chrome.runtime.onMessage.addListener>[0]);
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
      setActiveSessionRunDetails([]);
      return;
    }

    let cancelled = false;
    Promise.all(selectedRuns.map((run) => loadRunDetail(run.runId)))
      .then((details) => {
        if (cancelled) {
          return;
        }

        setActiveSessionRunDetails(details.filter((detail): detail is RunHistoryDetail => Boolean(detail)));
      })
      .catch(() => {
        if (!cancelled) {
          setActiveSessionRunDetails([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentSessionKey, effectiveSelectedSessionKey, loadRunDetail, sortedHistory, state.currentRun?.runId]);

  const liveFinalOutput = state.currentRun?.finalOutput?.trim() || "";
  const livePrompt = state.currentRun?.prompt ?? prompt;

  const liveConversationSegments = useMemo<BuildChatStreamItemsOptions[]>(() => {
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
        pendingQuestionId: null
      }];
    }

    const historicalSegments = activeSessionRunDetails.map((detail) => ({
      runId: detail.run.runId,
      prompt: detail.run.prompt,
      events: detail.events,
      answers: detail.answers,
      finalOutput: detail.run.finalOutput,
      errorMessage: detail.run.errorMessage,
      status: detail.run.status,
      updatedAt: detail.run.updatedAt ?? detail.run.startedAt,
      pendingQuestionId: null
    }));

    if (!selectedSessionIsCurrent) {
      return historicalSegments;
    }

    if (!state.currentRun && !state.runEvents.length) {
      return historicalSegments;
    }

    return [
      ...historicalSegments,
      {
        runId: state.currentRun?.runId ?? state.stream.runId,
        prompt: livePrompt,
        events: state.runEvents,
        answers: state.answers,
        finalOutput: liveFinalOutput,
        errorMessage: state.currentRun?.errorMessage ?? state.errorMessage ?? streamError,
        status: livePresentationState.runStatus,
        updatedAt: state.currentRun?.updatedAt ?? state.currentRun?.startedAt,
        pendingQuestionId: state.stream.pendingQuestionId
      }
    ];
  }, [activeSessionRunDetails, liveFinalOutput, livePresentationState.runStatus, livePrompt, selectedHistoryFallbackDetail, selectedSessionIsCurrent, state.answers, state.currentRun, state.errorMessage, state.runEvents, state.stream.pendingQuestionId, state.stream.runId, streamError]);

  const selectedConversationHasContent = liveConversationSegments.length > 0;
  const selectedThreadRun = selectedSessionItem?.latestRun ?? selectedHistoryFallbackDetail?.run ?? state.currentRun;
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

    const nextPrompt = retryPayload?.prompt ?? prompt;
    if (!nextPrompt.trim()) {
      return;
    }

    setPrompt(nextPrompt);
    const targetSessionItem = sessionNavigationItems.find((item) => item.key === effectiveSelectedSessionKey) ?? null;

    const response = await sendMessage<{ ok: boolean; data?: { runId: string; sessionId?: string; currentRun: RunRecord }; error?: { message: string } }>({
      type: "START_RUN",
      payload: {
        prompt: nextPrompt,
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
      stream: {
        runId: responseData.runId,
        status: "connecting",
        pendingQuestionId: null
      }
    }));

    await saveRun(responseData.currentRun);
    setSelectedSessionKey(deriveSessionKey(responseData.currentRun));

    eventSourceRef.current = createRunEventStream(responseData.runId, {
      onEvent: async (event) => {
        await saveEvent(event);

        setState((current) => {
          const nextEvents = mergeRunEvent(current.runEvents, event);
          const lifecycleStatus = deriveLifecycleStatus(current, event, nextEvents);
          const nextRun = current.currentRun && current.currentRun.runId === event.runId
            ? {
                ...current.currentRun,
                status: lifecycleStatus.runStatus,
                updatedAt: event.createdAt,
                finalOutput: deriveRunFinalOutput(current.currentRun.finalOutput, event),
                errorMessage: event.type === "error" ? event.message : current.currentRun.errorMessage
              }
            : current.currentRun;

          const nextState = {
            ...current,
            runEvents: nextEvents,
            currentRun: nextRun,
            status: lifecycleStatus.assistantStatus,
            errorMessage: event.type === "error" ? event.message : current.errorMessage,
            stream: {
              runId: event.runId,
              status: lifecycleStatus.streamStatus,
              pendingQuestionId: lifecycleStatus.pendingQuestionId
            }
          };

          if (nextRun) {
            saveRun(nextRun).catch(() => undefined);
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
            stream: nextState.stream
          }).catch(() => undefined);

          return nextState;
        });

        refresh().catch(() => undefined);
      },
      onStatusChange: (status) => {
        setState((current) => ({
          ...current,
          stream: {
            ...current.stream,
            status: current.stream.status === "done" || current.stream.status === "error" ? current.stream.status : status
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
        pendingQuestionId: null
      }
    });
    refresh().catch(() => undefined);
  }

  async function handleRetry(payload: { prompt: string; runId: string; messageId: string }) {
    await startStreamingRun({
      prompt: payload.prompt,
      capturePageData: false,
      retryFromRunId: payload.runId,
      retryFromMessageId: payload.messageId
    });
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
    effectiveSelectedSessionKey,
    errorDescription,
    errorTitle,
    handleAddFieldRule,
    handleCaptureOnly,
    handleQuestionSubmit,
    handleRemoveFieldRule,
    handleRetry,
    handleReturnToCurrentSession,
    handleSelectRule,
    handleSelectSession,
    handleStartFreshSession,
    hasActiveSession,
    hasLivePendingQuestion,
    isBusy,
    isSendDisabled,
    liveConversationSegments,
    livePrompt,
    latestReasoningItems,
    latestRunSummary,
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
    selectedRuleId,
    selectedSessionIsCurrent,
    selectedSessionItem,
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
