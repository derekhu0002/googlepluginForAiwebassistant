import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { createRunEventStream, submitQuestionAnswer } from "../shared/api";
import { toDisplayMessage } from "../shared/errors";
import { createDefaultFieldTemplates, createDefaultRule, createId } from "../shared/rules";
import { initialAssistantState } from "../shared/state";
import type { NormalizedRunEvent, RunHistoryDetail, RunRecord } from "../shared/protocol";
import type { ActiveTabContext, AssistantState, FieldRuleDefinition, PageRule, RuntimeMessage } from "../shared/types";
import { getActiveQuestionEvent, getNextPendingQuestionId } from "./questionState";
import { isAssistantResponseDeltaEvent, resolveTimelinePresentationState, type BuildChatStreamItemsOptions } from "./reasoningTimeline";
import { ReasoningTimeline } from "./reasoningTimelineView";
import { useRunHistory } from "./useRunHistory";

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

function isTerminalAssistantStatus(status: AssistantState["status"]) {
  return status === "done" || status === "error";
}

function isTerminalRunStatus(status: RunRecord["status"] | null | undefined) {
  return status === "done" || status === "error";
}

function isTerminalStreamStatus(status: AssistantState["stream"]["status"]) {
  return status === "done" || status === "error";
}

function hasTerminalRunEvidence(state: Pick<AssistantState, "status" | "stream" | "currentRun" | "runEvents" | "error" | "errorMessage">) {
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

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isSameRunEvent(current: NormalizedRunEvent, incoming: NormalizedRunEvent) {
  return current.id === incoming.id || (current.runId === incoming.runId && current.sequence === incoming.sequence);
}

function mergeRunEvent(currentEvents: NormalizedRunEvent[], incomingEvent: NormalizedRunEvent) {
  const existingIndex = currentEvents.findIndex((event) => isSameRunEvent(event, incomingEvent));

  if (existingIndex < 0) {
    return [...currentEvents, incomingEvent];
  }

  const nextEvents = [...currentEvents];
  nextEvents[existingIndex] = incomingEvent;
  return nextEvents;
}

function deriveRunFinalOutput(currentFinalOutput: string, event: NormalizedRunEvent) {
  if (event.type === "result") {
    return event.message;
  }

  if (event.type === "error") {
    return currentFinalOutput;
  }

  return currentFinalOutput;
}

function deriveLifecycleStatus(current: AssistantState, event: NormalizedRunEvent, nextEvents: NormalizedRunEvent[]) {
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

const COMPOSER_PLACEHOLDER_CHIPS = [
  { key: "attachment", label: "附件", description: "功能占位，暂未启用" },
  { key: "page_context", label: "页面上下文", description: "查看已采集字段能力占位" },
  { key: "selection", label: "选中内容", description: "将页面选中内容作为上下文的入口占位" }
] as const;


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
      ||
      keepLocalRunEvents
      || toTimestamp(current.currentRun.updatedAt) > toTimestamp(payload.currentRun.updatedAt)
      || RUN_STATUS_RANK[current.currentRun.status] > RUN_STATUS_RANK[payload.currentRun.status]
    )
  );
  const keepLocalStream = (
    (blockPrematureTerminalMerge && isTerminalStreamStatus(payload.stream.status))
    ||
    keepLocalRunEvents
    || STREAM_STATUS_RANK[current.stream.status] > STREAM_STATUS_RANK[payload.stream.status]
    || (current.stream.pendingQuestionId === null && payload.stream.pendingQuestionId !== null)
  );
  const keepLocalStatus = (
    (blockPrematureTerminalMerge && isTerminalAssistantStatus(payload.status))
    ||
    keepLocalStream
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

function cloneRule(rule: PageRule): PageRule {
  return {
    ...rule,
    fields: rule.fields.map((field) => ({ ...field }))
  };
}

function createEmptyRule(): PageRule {
  const seed = createDefaultRule();
  return {
    ...seed,
    name: "新规则",
    hostnamePattern: "*.example.com",
    pathPattern: "*",
    fields: createDefaultFieldTemplates()
  };
}

function createFieldRule(): FieldRuleDefinition {
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

async function sendMessage<T>(message: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="send-icon">
      <path d="M3.4 20.4 21 12 3.4 3.6l2.2 6.7 8.4 1.7-8.4 1.7-2.2 6.7Z" fill="currentColor" />
    </svg>
  );
}

function SessionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="utility-icon">
      <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H11l-4.2 3v-3H7.5A2.5 2.5 0 0 1 5 12.5v-6Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function ContextIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="utility-icon">
      <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 9v3.2l2.2 2.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RulesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="utility-icon">
      <path d="M6 7h12M6 12h8M6 17h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="12" r="1.7" fill="currentColor" />
    </svg>
  );
}

function AttachmentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="utility-icon">
      <path d="M8.5 12.5 14.8 6.2a3 3 0 1 1 4.2 4.2l-8 8a5 5 0 1 1-7-7l8.7-8.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PageContextIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="utility-icon">
      <rect x="5" y="4.5" width="14" height="15" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 9h8M8 12.5h8M8 16h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SelectionIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="utility-icon">
      <path d="M7.5 6.5h-2v11h11v-2M10 6.5h8.5V15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m10 14 2.4-6.5L19 10l-6.5 2.4L10 14Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function CaptureIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="utility-icon">
      <path d="M8 7.5 9.5 5h5L16 7.5h2A2.5 2.5 0 0 1 20.5 10v7A2.5 2.5 0 0 1 18 19.5H6A2.5 2.5 0 0 1 3.5 17v-7A2.5 2.5 0 0 1 6 7.5h2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function truncateText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function deriveRunTitle(run: Pick<RunRecord, "selectedSr" | "prompt" | "pageTitle" | "softwareVersion">) {
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

function deriveRunSummary(run: Pick<RunRecord, "finalOutput" | "errorMessage" | "pageTitle" | "prompt" | "softwareVersion" | "username">) {
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

interface SessionNavigationItem {
  key: string;
  sessionId: string | null;
  latestRun: RunRecord;
  runCount: number;
}

const DRAFT_SESSION_KEY = "draft:new-session";

function deriveSessionKey(run: Pick<RunRecord, "runId" | "sessionId">) {
  return run.sessionId ? `session:${run.sessionId}` : `run:${run.runId}`;
}

function buildSessionNavigationItems(history: RunRecord[], currentRun: RunRecord | null) {
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

/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-SHELL */
/** @ArchitectureID: REQ-AIASSIST-UI-CHAT-SEND-DECOUPLE-AND-COMPLETE-RESPONSE-RENDER */
/** @ArchitectureID: ELM-APP-008A */
export function App() {
  const [state, setState] = useState<AssistantState>(initialAssistantState);
  const [rules, setRules] = useState<PageRule[]>([]);
  const [isRulesCenterExpanded, setIsRulesCenterExpanded] = useState(false);
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
  const [activeConsole, setActiveConsole] = useState<"sessions" | "context" | "rules" | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const { history, selectedHistoryDetail, saveRun, saveEvent, saveAnswer, loadRunDetail, selectRun, refresh, clearSelectedRun } = useRunHistory();
  const historyRef = useRef(history);
  const selectedHistoryDetailRef = useRef(selectedHistoryDetail);

  const isBusy = state.status === "collecting" || state.status === "streaming";
  const hasActiveSession = Boolean(state.activeSessionId ?? state.currentRun?.sessionId);
  const canSendWhileStreaming = state.status === "streaming" && hasActiveSession && hasTerminalRunEvidence(state);
  const isSendDisabled = state.status === "collecting" || (state.status === "streaming" && !canSendWhileStreaming) || !prompt.trim();
  const isEmbedded = useMemo(() => new URLSearchParams(window.location.search).get("mode") === "embedded", []);
  const questionEvent = useMemo(() => getActiveQuestionEvent(state.runEvents, state.stream.pendingQuestionId), [state.runEvents, state.stream.pendingQuestionId]);

  async function syncRunStateToBackground(nextState: Pick<AssistantState, "status" | "activeSessionId" | "capturedFields" | "runPrompt" | "runEvents" | "currentRun" | "answers" | "error" | "errorMessage" | "matchedRule" | "lastCapturedUrl" | "usernameContext" | "stream">) {
    await sendMessage<{ ok: boolean }>({
      type: "SYNC_RUN_STATE",
      payload: nextState
    }).catch(() => ({ ok: false }));
  }

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

  async function startStreamingRun(retryPayload?: { prompt?: string; retryFromRunId?: string; retryFromMessageId?: string; capturePageData?: boolean }) {
    setStreamError("");
    eventSourceRef.current?.close();
    clearSelectedRun().catch(() => undefined);

    const nextPrompt = retryPayload?.prompt ?? prompt;
    if (!nextPrompt.trim()) {
      return;
    }

    setPrompt(nextPrompt);
    const targetSessionItem = sessionNavigationItems.find((item) => item.key === selectedSessionKey) ?? null;

    const response = await sendMessage<{ ok: boolean; data?: { runId: string; sessionId?: string; currentRun: RunRecord } ; error?: { message: string } }>({
      type: "START_RUN",
      payload: {
        prompt: nextPrompt,
        ...(targetSessionItem?.sessionId ? { sessionId: targetSessionItem.sessionId } : {}),
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
      id: createId("answer"),
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
    setActiveConsole(null);
    await clearSelectedRun().catch(() => undefined);
    await sendMessage<{ ok: boolean }>({ type: "CLEAR_RESULT" }).catch(() => ({ ok: false }));
    await loadBaseState().catch(() => undefined);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.select();
    });
  }

  async function handleReturnToCurrentSession() {
    if (state.currentRun) {
      setSelectedSessionKey(deriveSessionKey(state.currentRun));
    }
    setActiveConsole(null);
    await clearSelectedRun().catch(() => undefined);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  }

  function toggleConsole(panel: "sessions" | "context" | "rules") {
    setActiveConsole((current) => current === panel ? null : panel);
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

  const selectedRule = draftRule;
  const errorTitle = state.error?.code ? `${state.error.code}` : null;
  const errorDescription = state.error ? toDisplayMessage(state.error) : state.errorMessage || streamError;
  const liveFinalOutput = state.currentRun?.finalOutput?.trim() || "";
  const hasLiveConversation = Boolean(state.currentRun || state.runEvents.length || questionEvent || liveFinalOutput);
  const livePrompt = state.currentRun?.prompt ?? prompt;
  const shouldShowPermissionCallout = Boolean(activeContext?.url && !activeContext.permissionGranted && !activeContext.restricted);
  const canShowPermissionButton = shouldShowPermissionCallout && activeContext?.canRequestPermission;
  const sortedHistory = useMemo(() => [...history].sort((left, right) => toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt)), [history]);
  const pinnedCurrentRun = state.currentRun;
  const currentSessionKey = state.currentRun ? deriveSessionKey(state.currentRun) : null;
  const sessionNavigationItems = useMemo(
    () => buildSessionNavigationItems(sortedHistory, state.currentRun),
    [sortedHistory, state.currentRun]
  );
  const selectedSessionItem = useMemo(
    () => sessionNavigationItems.find((item) => item.key === selectedSessionKey) ?? null,
    [selectedSessionKey, sessionNavigationItems]
  );
  const draftSessionSummary = truncateText(prompt.trim() || initialAssistantState.runPrompt, 84);
  const livePresentationState = useMemo(() => resolveTimelinePresentationState({
    events: state.runEvents,
    runStatus: state.currentRun?.status,
    streamStatus: state.stream.status,
    finalOutput: state.currentRun?.finalOutput,
    errorMessage: state.currentRun?.errorMessage ?? state.errorMessage ?? streamError
  }), [state.currentRun?.errorMessage, state.currentRun?.finalOutput, state.currentRun?.status, state.runEvents, state.stream.status, state.errorMessage, streamError]);
  const shellStatusLabel = questionEvent?.question
    ? "等待补充信息"
    : livePresentationState.runStatus === "done"
      ? "已完成"
      : livePresentationState.runStatus === "error"
        ? "已失败"
        : livePresentationState.streamStatus === "connecting"
          ? "建立连接中"
          : livePresentationState.streamStatus === "reconnecting"
            ? "正在重连"
            : hasLiveConversation
              ? "持续输出中"
              : "待开始";
    const selectedSessionIsCurrent = !selectedSessionKey || selectedSessionKey === DRAFT_SESSION_KEY || selectedSessionKey === currentSessionKey;

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
      if (!selectedSessionKey || selectedSessionKey === DRAFT_SESSION_KEY) {
        setActiveSessionRunDetails([]);
        return;
      }

      const selectedRuns = sortedHistory
        .filter((run) => deriveSessionKey(run) === selectedSessionKey)
        .filter((run) => !(selectedSessionKey === currentSessionKey && run.runId === state.currentRun?.runId))
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
    }, [currentSessionKey, loadRunDetail, selectedSessionKey, sortedHistory, state.currentRun?.runId]);

    const liveConversationSegments = useMemo<BuildChatStreamItemsOptions[]>(() => {
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
    }, [activeSessionRunDetails, liveFinalOutput, livePresentationState.runStatus, livePrompt, selectedSessionIsCurrent, state.answers, state.currentRun, state.errorMessage, state.runEvents, state.stream.pendingQuestionId, state.stream.runId, streamError]);
    const selectedConversationHasContent = liveConversationSegments.length > 0;
    const selectedThreadRun = selectedSessionItem?.latestRun ?? state.currentRun;
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
  return (
    <main className="app-shell chat-app-shell">
      <div className="chat-workspace-shell">
        <section className="chat-stage-shell chat-stage-shell-focus">
          {shouldShowPermissionCallout ? (
            <section className="panel-block host-permission-callout" aria-label="当前域名授权提示">
              <div>
                <strong>当前页面需要先授权域名访问</strong>
                <p>{activeContext?.message || "授权当前域名后，扩展才能继续读取页面上下文并正常工作。"}</p>
                {!canShowPermissionButton ? (
                  <p>
                    当前构建尚未把这个域名加入可申请授权清单。请先确认已将 extension/.env.example 复制为 extension/.env，重新执行 npm run build --workspace extension，然后在 chrome://extensions 里重新加载 extension/dist。
                  </p>
                ) : null}
              </div>
              {canShowPermissionButton ? (
                <button className="secondary" disabled={requestingPermission} onClick={() => requestPermission()}>
                  {requestingPermission ? "授权中..." : "授权当前域名"}
                </button>
              ) : null}
              {contextError ? <p className="error-text">{contextError}</p> : null}
            </section>
          ) : null}

          <section className="panel-block chat-primary-panel">
            <div className="section-header compact chat-primary-header">
              <div>
                <h2>对话</h2>
                <small>{selectedSessionItem ? deriveRunTitle(selectedSessionItem.latestRun) : "用户消息、问题确认与最终回答统一展示"}</small>
              </div>
              <div className="chat-primary-meta">
                <small className="conversation-live-chip">{selectedSessionIsCurrent ? shellStatusLabel : (selectedThreadRun?.status ?? "done")}</small>
                {selectedThreadRun?.runId ? <small className="detail-muted">Run：{selectedThreadRun.runId}</small> : null}
              </div>
            </div>

            <div className="chat-stage-statusbar">
              <span className="pill pill-muted">页面：{activeContext?.hostname ?? "未读取"}</span>
              <span className={`pill ${activeContext?.permissionGranted ? "pill-success" : "pill-warning"}`}>
                {activeContext?.permissionGranted ? "域名已授权" : "域名未授权"}
              </span>
              <span className={`pill ${selectedSessionIsCurrent && questionEvent?.question ? "pill-warning" : "pill-muted"}`}>
                {selectedSessionIsCurrent && questionEvent?.question ? "等待补充信息" : "自由对话"}
              </span>
            </div>

            <div className="conversation-mainline chat-primary-mainline">
              {selectedConversationHasContent ? (
                <ReasoningTimeline
                  runId={selectedThreadRun?.runId ?? state.stream.runId}
                  prompt={selectedThreadRun?.prompt ?? livePrompt}
                  events={selectedSessionIsCurrent ? state.runEvents : (activeSessionRunDetails[activeSessionRunDetails.length - 1]?.events ?? [])}
                  runSegments={liveConversationSegments}
                  answers={selectedSessionIsCurrent ? state.answers : (activeSessionRunDetails[activeSessionRunDetails.length - 1]?.answers ?? [])}
                  live={selectedSessionIsCurrent}
                  streamStatus={selectedThreadStreamStatus}
                  runStatus={selectedThreadStatus}
                  finalOutput={selectedThreadFinalOutput}
                  errorMessage={selectedThreadError}
                  updatedAt={selectedThreadUpdatedAt}
                  pendingQuestionId={selectedSessionIsCurrent ? state.stream.pendingQuestionId : null}
                  emptyText="正在生成回答…"
                  onRetry={handleRetry}
                  onQuestionSubmit={selectedSessionIsCurrent ? handleQuestionSubmit : undefined}
                  questionSubmitDisabled={selectedSessionIsCurrent ? !questionEvent?.question : true}
                />
              ) : (
                <div className="chat-empty-hero empty-state">
                  <strong>开始一段新的会话</strong>
                  <p>提交 prompt 后，这里会像 Copilot 一样展示用户消息、流式回复和追问。</p>
                </div>
              )}
            </div>

            <div className="conversation-composer docked-composer">
              <label className="composer-input-shell copilot-composer-shell">
                <textarea ref={composerRef} value={prompt} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setPrompt(event.target.value)} rows={4} placeholder="Ask AI Web Assistant anything about the current page…" />
                <button
                  className="send-button"
                  aria-label={selectedSessionIsCurrent && questionEvent?.question ? "发送补充说明" : "发送消息"}
                  title={selectedSessionIsCurrent && questionEvent?.question ? "发送补充说明" : "发送消息"}
                  disabled={isSendDisabled}
                  onClick={() => startStreamingRun({ capturePageData: false })}
                >
                  <SendIcon />
                </button>
              </label>
              <div className="composer-utility-strip">
                <div className="chat-console-dock compact-icon-dock" aria-label="chat utilities">
                  <button
                    className={`utility-icon-button ${activeConsole === "sessions" ? "active" : ""}`}
                    aria-label="会话"
                    title="会话控制台，切换当前续聊目标"
                    data-tooltip="会话"
                    onClick={() => toggleConsole("sessions")}
                  >
                    <SessionIcon />
                    <span className="sr-only">会话</span>
                  </button>
                  <button
                    className={`utility-icon-button ${activeConsole === "context" ? "active" : ""}`}
                    aria-label="上下文"
                    title="上下文控制台，查看页面状态和采集结果"
                    data-tooltip="上下文"
                    onClick={() => toggleConsole("context")}
                  >
                    <ContextIcon />
                    <span className="sr-only">上下文</span>
                  </button>
                  <button
                    className={`utility-icon-button ${activeConsole === "rules" ? "active" : ""}`}
                    aria-label="规则"
                    title="规则控制台，管理当前页面规则"
                    data-tooltip="规则"
                    onClick={() => toggleConsole("rules")}
                  >
                    <RulesIcon />
                    <span className="sr-only">规则</span>
                  </button>
                  {COMPOSER_PLACEHOLDER_CHIPS.map((chip) => (
                    <button
                      key={chip.key}
                      className="utility-icon-button utility-icon-button-muted"
                      type="button"
                      aria-label={chip.label}
                      aria-disabled="true"
                      title={`${chip.label}：${chip.description}`}
                      data-tooltip={chip.label}
                    >
                      {chip.key === "attachment" ? <AttachmentIcon /> : null}
                      {chip.key === "page_context" ? <PageContextIcon /> : null}
                      {chip.key === "selection" ? <SelectionIcon /> : null}
                      <span className="sr-only">{chip.label}</span>
                    </button>
                  ))}
                  <button
                    className={`utility-icon-button ${state.status === "collecting" ? "pending" : ""}`}
                    aria-label={state.status === "collecting" ? "采集中..." : "采集页面"}
                    title="重新采集页面上下文。发送消息默认不会触发页面采集。"
                    data-tooltip={state.status === "collecting" ? "采集中" : "采集页面"}
                    disabled={isBusy}
                    onClick={() => handleCaptureOnly()}
                  >
                    <CaptureIcon />
                    <span className="sr-only">{state.status === "collecting" ? "采集中..." : "采集页面"}</span>
                  </button>
                </div>
                <div className="conversation-composer-actions compact-composer-actions">
                  <small className="detail-muted">用户名：{state.usernameContext?.username ?? "unknown"}（{state.usernameContext?.usernameSource ?? "pending"}）</small>
                </div>
              </div>
            </div>
          </section>
          {activeConsole ? (
            <div className="floating-console-shell">
              {activeConsole === "sessions" ? (
                <section className="panel-block floating-console-panel" aria-label="会话控制台">
                  <div className="section-header compact floating-console-header">
                    <div>
                      <h2>会话</h2>
                      <small>点击会话后切换主窗口续聊目标</small>
                    </div>
                    <div className="session-sidebar-actions">
                      <button className="secondary" disabled={isBusy} onClick={() => handleStartFreshSession()}>新会话</button>
                      <button className="secondary" onClick={() => refresh()}>刷新</button>
                      <button className="secondary" onClick={() => setActiveConsole(null)}>关闭</button>
                    </div>
                  </div>
                  <div className="session-sidebar-meta">
                    <span className="pill pill-muted">{sessionNavigationItems.length} 个会话</span>
                    <span className={`pill ${selectedSessionKey === DRAFT_SESSION_KEY || selectedSessionIsCurrent ? "pill-success" : "pill-muted"}`}>
                      {selectedSessionKey === DRAFT_SESSION_KEY ? "新会话" : selectedSessionIsCurrent ? "当前会话" : "历史会话"}
                    </span>
                    {state.currentRun ? <button className="secondary floating-inline-button" onClick={() => handleReturnToCurrentSession()}>返回当前会话</button> : null}
                  </div>
                  <div className="history-list copilot-history-list floating-console-scroll">
                    {sessionNavigationItems.length ? sessionNavigationItems.map((item) => (
                      <button
                        key={item.key}
                        className={`rule-list-item history-nav-item ${selectedSessionKey === item.key ? "active" : ""}`}
                        onClick={() => {
                          setSelectedSessionKey(item.key);
                          setActiveConsole(null);
                        }}
                      >
                        <div className="history-nav-item-header">
                          <strong>{deriveRunTitle(item.latestRun)}</strong>
                          <span className={`status-dot status-${item.latestRun.status}`} aria-hidden="true" />
                        </div>
                        <p className="session-summary-text">{deriveRunSummary(item.latestRun)}</p>
                        <small>{item.runCount} 轮消息 · {item.latestRun.username}</small>
                      </button>
                    )) : <p className="empty-state">暂无历史记录。</p>}
                  </div>
                </section>
              ) : null}

              {activeConsole === "context" ? (
                <section className="panel-block floating-console-panel" aria-label="上下文控制台">
                  <div className="section-header compact floating-console-header">
                    <div>
                      <h2>上下文与运行状态</h2>
                      <small>页面信息、状态和采集摘要</small>
                    </div>
                    <button className="secondary" onClick={() => setActiveConsole(null)}>关闭</button>
                  </div>
                  <div className="context-grid demoted-grid inspector-grid floating-console-scroll">
                    <section className="status-card demoted-card">
                      <strong>当前页面上下文</strong>
                      <small>{activeContext?.url ?? "尚未读取当前标签页"}</small>
                      <small>{activeContext?.message ?? ""}</small>
                      <div className="context-actions">
                        <span className={`pill ${activeContext?.matchedRule ? "pill-success" : "pill-muted"}`}>
                          {activeContext?.matchedRule ? `命中规则：${activeContext.matchedRule.name}` : "未命中规则"}
                        </span>
                        <span className={`pill ${activeContext?.permissionGranted ? "pill-success" : "pill-warning"}`}>
                          {activeContext?.permissionGranted ? "域名已授权" : "域名未授权"}
                        </span>
                      </div>
                      {!shouldShowPermissionCallout && contextError ? <p className="error-text">{contextError}</p> : null}
                    </section>

                    <section className="status-card demoted-card">
                      <strong>状态</strong>
                      <span>{state.status}</span>
                      {state.stream.runId ? <small>流连接：{state.stream.status}</small> : null}
                      {state.lastUpdatedAt ? <small>更新时间：{new Date(state.lastUpdatedAt).toLocaleString()}</small> : null}
                      {state.currentRun ? <small>Run ID：{state.currentRun.runId}</small> : null}
                      {errorTitle ? <small>错误域：{errorTitle}</small> : null}
                      {errorDescription ? <p className="error-text">{errorDescription}</p> : null}
                    </section>

                    <section className="panel-block demoted-card legacy-summary-card">
                      <h2>采集结果摘要</h2>
                      {state.capturedFields ? (
                        <dl className="field-list compact-list">
                          <div className="field-item">
                            <dt>software_version</dt>
                            <dd>{state.capturedFields.software_version || <span className="empty-value">(empty)</span>}</dd>
                          </div>
                          <div className="field-item">
                            <dt>selected_sr</dt>
                            <dd>{state.capturedFields.selected_sr || <span className="empty-value">(empty)</span>}</dd>
                          </div>
                        </dl>
                      ) : (
                        <p className="empty-state">尚未采集任何字段。</p>
                      )}
                    </section>
                  </div>
                </section>
              ) : null}

              {activeConsole === "rules" ? (
                <section className="panel-block floating-console-panel" aria-label="规则控制台">
                  <div className="section-header compact floating-console-header">
                    <div>
                      <h2>规则配置中心</h2>
                      <small>悬浮控制台内编辑规则</small>
                    </div>
                    <button className="secondary" onClick={() => setActiveConsole(null)}>关闭</button>
                  </div>
                  <div className="inline-actions">
                    <button className="secondary" onClick={() => addRule()}>新增规则</button>
                    <button className="secondary" disabled={!selectedRuleId} onClick={() => deleteCurrentRule()}>删除规则</button>
                    <button disabled={!selectedRule || savingRule} onClick={() => saveCurrentRule()}>{savingRule ? "保存中..." : "保存规则"}</button>
                  </div>
                  <div className="rules-layout floating-console-scroll">
                    <aside className="rule-list">
                      {rules.map((rule) => (
                        <button
                          key={rule.id}
                          className={`rule-list-item ${selectedRuleId === rule.id ? "active" : ""}`}
                          onClick={() => {
                            setSelectedRuleId(rule.id);
                            setDraftRule(cloneRule(rule));
                          }}
                        >
                          <strong>{rule.name}</strong>
                          <small>{rule.hostnamePattern}{rule.pathPattern !== "*" ? ` · ${rule.pathPattern}` : ""}</small>
                        </button>
                      ))}
                    </aside>

                    {selectedRule ? (
                      <div className="rule-editor">
                        <label>
                          <span>规则名称</span>
                          <input value={selectedRule.name} onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))} />
                        </label>
                        <div className="two-column">
                          <label>
                            <span>Hostname 模式</span>
                            <input value={selectedRule.hostnamePattern} onChange={(event) => updateDraft((current) => ({ ...current, hostnamePattern: event.target.value }))} placeholder="如 *.example.com" />
                          </label>
                          <label>
                            <span>Path 模式</span>
                            <input value={selectedRule.pathPattern} onChange={(event) => updateDraft((current) => ({ ...current, pathPattern: event.target.value }))} placeholder="如 /products/*" />
                          </label>
                        </div>
                        <label className="checkbox-row">
                          <input type="checkbox" checked={selectedRule.enabled} onChange={(event) => updateDraft((current) => ({ ...current, enabled: event.target.checked }))} />
                          <span>启用规则</span>
                        </label>

                        <div className="section-header compact">
                          <h3>字段规则</h3>
                          <button className="secondary" onClick={() => updateDraft((current) => ({ ...current, fields: [...current.fields, createFieldRule()] }))}>新增字段</button>
                        </div>

                        <div className="field-rule-list">
                          {selectedRule.fields.map((field, index) => (
                            <div key={field.id} className="field-rule-card">
                              <div className="field-rule-toolbar">
                                <strong>{field.label || `字段 ${index + 1}`}</strong>
                                <button className="secondary" onClick={() => updateDraft((current) => ({ ...current, fields: current.fields.filter((item) => item.id !== field.id) }))}>删除</button>
                              </div>
                              <div className="two-column">
                                <label>
                                  <span>字段 key</span>
                                  <input value={field.key} onChange={(event) => updateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, key: event.target.value } : item) }))} />
                                </label>
                                <label>
                                  <span>展示名称</span>
                                  <input value={field.label} onChange={(event) => updateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, label: event.target.value } : item) }))} />
                                </label>
                              </div>
                              <div className="two-column">
                                <label>
                                  <span>来源类型</span>
                                  <select value={field.source} onChange={(event) => updateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, source: event.target.value as FieldRuleDefinition["source"] } : item) }))}>
                                    <option value="documentTitle">document.title</option>
                                    <option value="pageUrl">window.location.href</option>
                                    <option value="selectedText">window.getSelection()</option>
                                    <option value="meta">meta[name]</option>
                                    <option value="selectorText">selector.textContent</option>
                                    <option value="selectorAttribute">selector.getAttribute</option>
                                  </select>
                                </label>
                                <label className="checkbox-row">
                                  <input type="checkbox" checked={field.enabled} onChange={(event) => updateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, enabled: event.target.checked } : item) }))} />
                                  <span>启用字段</span>
                                </label>
                              </div>
                              {(field.source === "selectorText" || field.source === "selectorAttribute") ? (
                                <label>
                                  <span>CSS Selector</span>
                                  <input value={field.selector ?? ""} onChange={(event) => updateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, selector: event.target.value } : item) }))} />
                                </label>
                              ) : null}
                              {field.source === "selectorAttribute" ? (
                                <label>
                                  <span>属性名</span>
                                  <input value={field.attribute ?? ""} onChange={(event) => updateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, attribute: event.target.value } : item) }))} />
                                </label>
                              ) : null}
                              {field.source === "meta" ? (
                                <label>
                                  <span>meta name</span>
                                  <input value={field.metaName ?? "description"} onChange={(event) => updateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, metaName: event.target.value } : item) }))} />
                                </label>
                              ) : null}
                              <label>
                                <span>兜底值</span>
                                <input value={field.fallbackValue ?? ""} onChange={(event) => updateDraft((current) => ({ ...current, fields: current.fields.map((item) => item.id === field.id ? { ...item, fallbackValue: event.target.value } : item) }))} />
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="empty-state">暂无规则，点击“新增规则”开始配置。</p>
                    )}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
