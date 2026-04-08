import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { createRunEventStream, submitQuestionAnswer } from "../shared/api";
import { toDisplayMessage } from "../shared/errors";
import { createDefaultFieldTemplates, createDefaultRule, createId } from "../shared/rules";
import { initialAssistantState } from "../shared/state";
import type { NormalizedRunEvent, RunRecord } from "../shared/protocol";
import type { ActiveTabContext, AssistantState, FieldRuleDefinition, PageRule, RuntimeMessage } from "../shared/types";
import { getActiveQuestionEvent, getNextPendingQuestionId } from "./questionState";
import { resolveTimelinePresentationState } from "./reasoningTimeline";
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

/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-SHELL */
export function App() {
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
  const eventSourceRef = useRef<EventSource | null>(null);
  const { history, selectedHistoryDetail, saveRun, saveEvent, saveAnswer, selectRun, refresh, clearSelectedRun } = useRunHistory();
  const historyRef = useRef(history);
  const selectedHistoryDetailRef = useRef(selectedHistoryDetail);

  const isBusy = state.status === "collecting" || state.status === "streaming" || state.status === "waiting_for_answer";
  const isEmbedded = useMemo(() => new URLSearchParams(window.location.search).get("mode") === "embedded", []);
  const questionEvent = useMemo(() => getActiveQuestionEvent(state.runEvents, state.stream.pendingQuestionId), [state.runEvents, state.stream.pendingQuestionId]);

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

  async function startStreamingRun() {
    setStreamError("");
    eventSourceRef.current?.close();
    clearSelectedRun().catch(() => undefined);

    const response = await sendMessage<{ ok: boolean; data?: { runId: string; currentRun: RunRecord } ; error?: { message: string } }>({
      type: "START_RUN",
      payload: { prompt }
    });

    if (!response.ok || !response.data) {
      setStreamError(response.error?.message ?? "启动 run 失败");
      return;
    }

    const responseData = response.data;

    setState((current) => ({
      ...current,
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

    eventSourceRef.current = createRunEventStream(responseData.runId, {
      onEvent: async (event) => {
        await saveEvent(event);

        setState((current) => {
          const nextEvents = [...current.runEvents, event];
          const nextRun = current.currentRun && current.currentRun.runId === event.runId
            ? {
                ...current.currentRun,
                status: event.type === "question" ? "waiting_for_answer" : event.type === "result" ? "done" : event.type === "error" ? "error" : current.currentRun.status,
                updatedAt: event.createdAt,
                finalOutput: event.type === "result" ? event.message : current.currentRun.finalOutput,
                errorMessage: event.type === "error" ? event.message : current.currentRun.errorMessage
              }
            : current.currentRun;

          if (nextRun) {
            saveRun(nextRun).catch(() => undefined);
          }

          return {
            ...current,
            runEvents: nextEvents,
            currentRun: nextRun,
            status: event.type === "question" ? "waiting_for_answer" : event.type === "result" ? "done" : event.type === "error" ? "error" : "streaming",
            errorMessage: event.type === "error" ? event.message : current.errorMessage,
             stream: {
               runId: event.runId,
               status: event.type === "question" ? "waiting_for_answer" : event.type === "result" ? "done" : event.type === "error" ? "error" : "streaming",
               pendingQuestionId: getNextPendingQuestionId(current.stream.pendingQuestionId, event)
             }
           };
         });

        refresh().catch(() => undefined);
      },
      onStatusChange: (status) => {
        setState((current) => ({
          ...current,
          stream: {
            ...current.stream,
            status
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
    refresh().catch(() => undefined);
  }

  const selectedRule = draftRule;
  const errorTitle = state.error?.code ? `${state.error.code}` : null;
  const errorDescription = state.error ? toDisplayMessage(state.error) : state.errorMessage || streamError;
  const hasLiveConversation = Boolean(state.currentRun || state.runEvents.length || questionEvent);
  const livePrompt = state.currentRun?.prompt ?? prompt;
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

  return (
    <main className="app-shell chat-app-shell">
      <header className="app-header chat-app-header">
        <div>
          <h1>AI Web Assistant</h1>
          <p>conversation-first / 单一连续对话流</p>
        </div>
        <span className="mode-chip">{isEmbedded || state.uiMode === "embedded" ? "Embedded" : "Side Panel"}</span>
      </header>

      <section className="panel-block chat-primary-panel">
        <div className="section-header compact chat-primary-header">
          <div>
            <h2>对话</h2>
            <small>用户提问、问题确认与最终回答统一展示</small>
          </div>
          <div className="chat-primary-meta">
            <small className="conversation-live-chip">{shellStatusLabel}</small>
            {(state.stream.runId || state.currentRun?.runId) ? <small className="detail-muted">Run：{state.currentRun?.runId ?? state.stream.runId}</small> : null}
          </div>
        </div>

        <div className="conversation-mainline chat-primary-mainline">
          {hasLiveConversation ? (
            <ReasoningTimeline
              runId={state.currentRun?.runId ?? state.stream.runId}
              prompt={livePrompt}
              events={state.runEvents}
              answers={state.answers}
              live
              streamStatus={livePresentationState.streamStatus}
              runStatus={livePresentationState.runStatus}
              finalOutput={state.currentRun?.finalOutput}
              errorMessage={state.currentRun?.errorMessage ?? state.errorMessage ?? streamError}
              updatedAt={state.currentRun?.updatedAt ?? state.currentRun?.startedAt}
              pendingQuestionId={state.stream.pendingQuestionId}
              emptyText="正在生成回答…"
              onQuestionSubmit={handleQuestionSubmit}
              questionSubmitDisabled={!questionEvent?.question}
            />
          ) : (
            <p className="empty-state">提交 prompt 后，这里会展示用户消息与助手回复。</p>
          )}
        </div>

        <div className="conversation-composer docked-composer">
          <label>
            <span>{questionEvent?.question ? "继续回答或追问" : "发送消息"}</span>
            <textarea value={prompt} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setPrompt(event.target.value)} rows={4} placeholder="输入你的问题，或继续追问…" />
          </label>
          <div className="conversation-composer-actions">
            <button disabled={isBusy || !prompt.trim()} onClick={() => startStreamingRun()}>{isBusy ? "处理中..." : questionEvent?.question ? "发送补充说明" : "采集并开始 SSE Run"}</button>
            <small className="detail-muted">底部输入区始终可用；内联选项回答与自由输入追问共享同一条会话主线。</small>
          </div>
        </div>
      </section>

      <section className="secondary-surface-stack">
        <details className="secondary-panel utility-panel">
          <summary>
            <span>上下文与运行状态</span>
            <small>默认折叠</small>
          </summary>
          <div className="context-grid demoted-grid">
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
              {!activeContext?.permissionGranted && activeContext?.canRequestPermission ? (
                <button className="secondary" disabled={requestingPermission} onClick={() => requestPermission()}>
                  {requestingPermission ? "授权中..." : "授权当前域名"}
                </button>
              ) : null}
              {contextError ? <p className="error-text">{contextError}</p> : null}
              <small>用户名：{state.usernameContext?.username ?? "unknown"}（{state.usernameContext?.usernameSource ?? "pending"}）</small>
            </section>

            <section className="status-card demoted-card">
              <strong>状态：</strong>
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
        </details>

        <details className="secondary-panel history-secondary-panel">
          <summary>
            <span>历史记录</span>
            <small>{history.length} 条</small>
          </summary>
          <div className="section-header compact history-secondary-header">
            <small className="detail-muted">历史详情沿用同一对话流呈现。</small>
            <button className="secondary" onClick={() => refresh()}>刷新</button>
          </div>
          <div className="history-layout demoted-history-layout">
            <aside className="history-list">
              {history.length ? history.map((item) => (
                <button key={item.runId} className={`rule-list-item ${selectedHistoryDetail?.run.runId === item.runId ? "active" : ""}`} onClick={() => selectRun(item.runId)}>
                  <strong>{item.selectedSr || "(no SR)"}</strong>
                  <small>{item.softwareVersion || "(no version)"} · {item.username}</small>
                </button>
              )) : <p className="empty-state">暂无历史记录。</p>}
            </aside>
            <div className="history-detail">
              {selectedHistoryDetail ? (
                <ReasoningTimeline
                  runId={selectedHistoryDetail.run.runId}
                  prompt={selectedHistoryDetail.run.prompt}
                  events={selectedHistoryDetail.events}
                  answers={selectedHistoryDetail.answers}
                  runStatus={selectedHistoryDetail.run.status}
                  finalOutput={selectedHistoryDetail.run.finalOutput}
                  errorMessage={selectedHistoryDetail.run.errorMessage}
                  updatedAt={selectedHistoryDetail.run.updatedAt ?? selectedHistoryDetail.run.startedAt}
                  emptyText="尚未完成"
                />
              ) : <p className="empty-state">选择一条历史记录查看详情。</p>}
            </div>
          </div>
        </details>
      </section>

      <section className="panel-block">
        <div className="section-header">
          <h2>规则配置中心</h2>
          <div className="inline-actions">
            <button className="secondary" onClick={() => addRule()}>新增规则</button>
            <button className="secondary" disabled={!selectedRuleId} onClick={() => deleteCurrentRule()}>删除规则</button>
            <button disabled={!selectedRule || savingRule} onClick={() => saveCurrentRule()}>{savingRule ? "保存中..." : "保存规则"}</button>
          </div>
        </div>

        <div className="rules-layout">
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
    </main>
  );
}
