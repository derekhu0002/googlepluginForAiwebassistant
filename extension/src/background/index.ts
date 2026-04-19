import { startRun } from "../shared/api";
import { initialAssistantState, STORAGE_KEY } from "../shared/state";
import { extensionConfig } from "../shared/config";
import { createDomainError, normalizeDomainError, toDisplayMessage } from "../shared/errors";
import { evaluatePageAccess, matchesChromePattern, toOriginPermissionPattern } from "../shared/pageAccess";
import { ensureContentScriptReady, isReceivingEndMissingError } from "../shared/scripting";
import { findMatchingRule, getStoredRules, removeRule, RULES_STORAGE_KEY, saveRules, toCanonicalCapturedFields, upsertRule } from "../shared/rules";
import type { ActiveTabContext, AssistantState, CapturedFields, PageRule, RuntimeMessage, SyncableAssistantRunState, UsernameContext } from "../shared/types";
import {
  compareRunEventFrontiers,
  createEmptyRunEventState,
  deriveRunEventFrontier,
  sortNormalizedRunEvents,
  type MainAgent,
  type RunRecord
} from "../shared/protocol";
import { DEFAULT_MAIN_AGENT } from "../shared/protocol";

async function getState(): Promise<AssistantState> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const state = (stored[STORAGE_KEY] as AssistantState | undefined) ?? initialAssistantState;
  return {
    ...initialAssistantState,
    ...state,
    mainAgentPreference: state.mainAgentPreference ?? DEFAULT_MAIN_AGENT
  };
}

async function getRules(): Promise<PageRule[]> {
  return getStoredRules();
}

function normalizeRulesResponse(rules: PageRule[]) {
  return rules.length > 0 ? rules : [];
}

async function setState(nextState: AssistantState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: nextState });
  await chrome.runtime.sendMessage({ type: "STATE_UPDATED", payload: nextState } satisfies RuntimeMessage).catch(() => undefined);
}

async function patchState(partial: Partial<AssistantState>) {
  const current = await getState();
  await setState({
    ...current,
    ...partial,
    lastUpdatedAt: new Date().toISOString()
  });
}

function logBackgroundSync(entry: Record<string, unknown>) {
  console.info("[background-run-sync]", entry);
}

function normalizeSyncableState(state: SyncableAssistantRunState): SyncableAssistantRunState {
  const runEvents = sortNormalizedRunEvents(state.runEvents ?? []);
  const runEventState = state.runEventState ?? createEmptyRunEventState();
  const frontier = deriveRunEventFrontier(runEvents);
  return {
    ...state,
    runEvents,
    runEventState: {
      ...runEventState,
      frontier,
      acceptedCanonicalKeys: runEvents.map((event) => event.canonical?.key ?? event.id)
    }
  };
}

function reconcileRunState(current: AssistantState, incomingPartial: SyncableAssistantRunState) {
  const incoming = normalizeSyncableState(incomingPartial);
  const currentRunId = current.currentRun?.runId ?? current.stream.runId;
  const incomingRunId = incoming.currentRun?.runId ?? incoming.stream.runId;
  const currentFrontier = current.runEventState.frontier;
  const incomingFrontier = incoming.runEventState.frontier;

  if (currentRunId && incomingRunId && currentRunId !== incomingRunId) {
    return {
      decision: "ignored_cross_run" as const,
      nextState: current,
      shouldBroadcast: false
    };
  }

  const frontierCompare = compareRunEventFrontiers(currentFrontier, incomingFrontier);
  if (frontierCompare > 0) {
    return {
      decision: currentFrontier.lastAcceptedCanonicalKey === incomingFrontier.lastAcceptedCanonicalKey ? "rejected_replay" as const : "rejected_stale" as const,
      nextState: current,
      shouldBroadcast: false
    };
  }

  const mergedState: AssistantState = {
    ...current,
    ...incoming,
    runEvents: frontierCompare === 0
      ? current.runEvents.length >= incoming.runEvents.length ? current.runEvents : incoming.runEvents
      : incoming.runEvents,
    runEventState: frontierCompare === 0 && current.runEventState.frontier.acceptedEventCount >= incoming.runEventState.frontier.acceptedEventCount
      ? current.runEventState
      : incoming.runEventState,
    syncMetadata: incoming.syncMetadata,
    lastUpdatedAt: new Date().toISOString()
  };

  return {
    decision: frontierCompare === 0 ? "merged" as const : "accepted" as const,
    nextState: mergedState,
    shouldBroadcast: true
  };
}

/** @ArchitectureID: ELM-FUNC-EXT-RECONCILE-RUN-STATE */
async function syncRunState(partial: SyncableAssistantRunState) {
  const current = await getState();
  const normalizedIncoming = normalizeSyncableState(partial);
  const reconciled = reconcileRunState(current, normalizedIncoming);
  logBackgroundSync({
    runId: normalizedIncoming.currentRun?.runId ?? normalizedIncoming.stream.runId,
    origin: normalizedIncoming.syncMetadata?.origin ?? "sidepanel",
    incomingVersion: normalizedIncoming.syncMetadata?.snapshotVersion ?? normalizedIncoming.runEventState.frontier.version ?? 0,
    storedVersion: current.syncMetadata?.snapshotVersion ?? 0,
    decision: reconciled.decision,
    incomingFrontier: normalizedIncoming.runEventState.frontier.lastSequence,
    storedFrontier: current.runEventState.frontier.lastSequence,
    eventCountDelta: (normalizedIncoming.runEventState.frontier.acceptedEventCount ?? 0) - (current.runEventState.frontier.acceptedEventCount ?? 0),
    answerCountDelta: (normalizedIncoming.answers?.length ?? 0) - (current.answers?.length ?? 0)
  });
  if (!reconciled.shouldBroadcast) {
    return;
  }
  await setState(reconciled.nextState);
}

async function getActiveTabId(): Promise<number> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTabId = tabs[0]?.id;

  if (!activeTabId) {
    throw new Error("No active tab found");
  }

  return activeTabId;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = tabs[0];

  if (!activeTab?.id) {
    throw createDomainError("PERMISSION_ERROR", "No active tab found");
  }

  return activeTab;
}

async function getPermissionState(url: string | undefined) {
  if (!url) {
    return { granted: false, pattern: null as string | null, canRequest: false, activeTabFallbackAvailable: false };
  }

  const parsed = new URL(url);
  const pattern = toOriginPermissionPattern(url);
  const canRequest = extensionConfig.optionalHostPermissions.some((item) => item === `${parsed.protocol}//*/*` || item === pattern || matchesChromePattern(url, item));
  const granted = await chrome.permissions.contains({ origins: [pattern] }).catch(() => false);
  return {
    granted,
    pattern,
    canRequest,
    // activeTab 不再作为稳定采集主路径，只在 side panel 无法打开时为当前已点击标签页提供一次性嵌入式兜底 UI。
    activeTabFallbackAvailable: !granted
  };
}

async function getActiveTabContext(): Promise<ActiveTabContext> {
  const activeTab = await getActiveTab();
  const access = evaluatePageAccess(activeTab.url, extensionConfig.optionalHostPermissions);
  const rules = await getRules();
  const matchedRule = findMatchingRule(activeTab.url, rules);
  const permission = await getPermissionState(activeTab.url);

  return {
    tabId: activeTab.id ?? null,
    url: activeTab.url ?? null,
    hostname: activeTab.url && access.allowed ? new URL(activeTab.url).hostname : null,
    restricted: !access.allowed && access.code === "RESTRICTED_PAGE_ERROR",
    matchedRule: matchedRule ? { id: matchedRule.id, name: matchedRule.name } : null,
    permissionGranted: permission.granted,
    permissionOrigin: permission.pattern,
    canRequestPermission: permission.canRequest,
    activeTabFallbackAvailable: permission.activeTabFallbackAvailable,
    message: access.allowed
      ? matchedRule
        ? permission.granted
          ? "当前页面已命中规则，可直接采集。"
          : "当前页面已命中规则，但仍需授予该域名权限。"
        : "当前页面域名可授权，但尚未命中任何启用规则。"
      : access.message ?? "当前页面不可访问"
  };
}

async function ensureActiveTabAllowed() {
  const context = await getActiveTabContext();

  if (context.restricted) {
    throw createDomainError("RESTRICTED_PAGE_ERROR", context.message);
  }

  if (!context.matchedRule) {
    throw createDomainError("RULE_NOT_MATCHED_ERROR", "当前页面未命中任何启用规则，请先在规则配置中心新增或调整规则。");
  }

  if (!context.permissionGranted) {
    throw createDomainError("PERMISSION_ERROR", "当前域名尚未授权，请先点击“授权当前域名”后再执行采集。");
  }

  return await getActiveTab();
}

async function sendMessageToReadyContent<T>(tabId: number, message: RuntimeMessage): Promise<T | undefined> {
  await ensureContentScriptReady(tabId);

  try {
    return await chrome.tabs.sendMessage(tabId, message) as T | undefined;
  } catch (error) {
    if (!isReceivingEndMissingError(error)) {
      throw error;
    }

    await ensureContentScriptReady(tabId);
    return await chrome.tabs.sendMessage(tabId, message) as T | undefined;
  }
}

async function collectFromActiveTab(): Promise<CapturedFields> {
  const activeTab = await ensureActiveTabAllowed();
  const rules = await getRules();
  const matchedRule = findMatchingRule(activeTab.url, rules);

  if (!matchedRule) {
    throw createDomainError("RULE_NOT_MATCHED_ERROR", "当前页面未命中任何启用规则，请先配置规则。");
  }

  const response = await sendMessageToReadyContent<CapturedFields>(activeTab.id!, {
    type: "COLLECT_FIELDS",
    payload: { fields: matchedRule.fields }
  } satisfies RuntimeMessage);

  if (!response) {
    throw createDomainError("CAPTURE_ERROR", "Failed to collect fields from current page");
  }

  return response;
}

async function getUsernameContextFromActiveTab(): Promise<UsernameContext> {
  const activeTab = await ensureActiveTabAllowed();
  const response = await sendMessageToReadyContent<UsernameContext>(activeTab.id!, { type: "GET_USERNAME_CONTEXT" } satisfies RuntimeMessage);
  return response ?? { username: "unknown", usernameSource: "unresolved_login_state" };
}

async function getBestEffortUsernameContext() {
  try {
    return await getUsernameContextFromActiveTab();
  } catch {
    return { username: "unknown", usernameSource: "unresolved_login_state" as const };
  }
}

async function runCaptureOnly() {
  const activeTab = await getActiveTab();
  const rules = await getRules();
  const matchedRule = findMatchingRule(activeTab.url, rules);

  await patchState({
    status: "collecting",
    error: null,
    errorMessage: "",
    matchedRule: matchedRule ? { id: matchedRule.id, name: matchedRule.name } : null
  });

  const capturedFields = await collectFromActiveTab();
  await patchState({
    status: "done",
    capturedFields,
    error: null,
    runEvents: [],
    currentRun: null,
    answers: [],
    lastCapturedUrl: activeTab.url ?? null
  });
}

async function buildRunRecord(options: {
  runId: string;
  sessionId?: string | null;
  selectedAgent: MainAgent;
  prompt: string;
  usernameContext: UsernameContext;
  capturedFields: CapturedFields | null;
}) {
  const canonicalCapture = options.capturedFields ? toCanonicalCapturedFields(options.capturedFields) : null;

  const currentRun: RunRecord = {
    runId: options.runId,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    selectedAgent: options.selectedAgent,
    prompt: options.prompt,
    username: options.usernameContext.username,
    usernameSource: options.usernameContext.usernameSource,
    softwareVersion: options.capturedFields?.software_version ?? "",
    selectedSr: options.capturedFields?.selected_sr ?? "",
    pageTitle: canonicalCapture?.pageTitle ?? "",
    pageUrl: canonicalCapture?.pageUrl ?? "",
    status: "streaming",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finalOutput: ""
  };

  return { currentRun, canonicalCapture };
}

/** @ArchitectureID: ELM-APP-EXT-RUN-ORCHESTRATION */
/** @ArchitectureID: ELM-FUNC-EXT-ORCHESTRATE-CAPTURE-RUNSTART */
/** @ArchitectureID: ELM-COMP-EXT-BACKGROUND */
/** @ArchitectureID: REQ-AIASSIST-UI-CHAT-SEND-DECOUPLE-AND-COMPLETE-RESPONSE-RENDER */
/** @ArchitectureID: ELM-APP-008B */
async function startRunFromActiveTab(options: { prompt: string; selectedAgent: MainAgent; sessionId?: string; retryFromRunId?: string; retryFromMessageId?: string; capturePageData?: boolean }) {
  const { prompt } = options;
  const activeTab = await getActiveTab();
  const rules = await getRules();
  const matchedRule = findMatchingRule(activeTab.url, rules);
  const shouldCapture = options.capturePageData ?? false;
  const existingState = await getState();

  await patchState({
    status: shouldCapture ? "collecting" : "streaming",
    error: null,
    errorMessage: "",
    matchedRule: matchedRule ? { id: matchedRule.id, name: matchedRule.name } : null,
    runEventState: createEmptyRunEventState(),
    syncMetadata: null
  });

  const capturedFields = shouldCapture ? await collectFromActiveTab() : existingState.capturedFields;
  const usernameContext = shouldCapture ? await getUsernameContextFromActiveTab() : await getBestEffortUsernameContext();
  const runCapture = capturedFields
    ? {
        ...capturedFields,
        ...toCanonicalCapturedFields(capturedFields)
      }
    : null;
  const targetSessionId = options.sessionId ?? existingState.activeSessionId;
  const requestedAgent = options.selectedAgent ?? existingState.mainAgentPreference ?? DEFAULT_MAIN_AGENT;
  const runResponse = await startRun(prompt, runCapture, usernameContext, requestedAgent, targetSessionId);

  if (!runResponse.ok) {
    const domainError = normalizeDomainError(runResponse.error, createDomainError("ANALYSIS_ERROR", runResponse.error.message));
    await patchState({ status: "error", error: domainError, errorMessage: toDisplayMessage(domainError) });
    return { ok: false, error: domainError };
  }

  const { currentRun } = await buildRunRecord({
    runId: runResponse.data.runId,
    sessionId: runResponse.data.sessionId ?? targetSessionId,
    selectedAgent: runResponse.data.selectedAgent,
    prompt,
    usernameContext,
    capturedFields
  });

  await patchState({
    status: "streaming",
    capturedFields,
    error: null,
    errorMessage: "",
    lastCapturedUrl: capturedFields ? activeTab.url ?? null : (await getState()).lastCapturedUrl,
    activeSessionId: runResponse.data.sessionId ?? targetSessionId,
    currentRun,
    usernameContext,
    runPrompt: prompt,
    runEvents: [],
    answers: [],
    stream: {
      runId: currentRun.runId,
      status: "streaming",
      pendingQuestionId: null,
      reconnectCount: 0
    },
    runEventState: createEmptyRunEventState(),
    syncMetadata: null
  });

  return {
    ok: true,
    data: {
        runId: currentRun.runId,
        sessionId: currentRun.sessionId,
        capturedFields,
        usernameContext,
        currentRun
    }
  };
}

async function clearResult() {
  const current = await getState();
  await setState({
    ...initialAssistantState,
    mainAgentPreference: current.mainAgentPreference,
    capturedFields: null,
    activeSessionId: null,
    lastUpdatedAt: new Date().toISOString()
  });
}

async function openPanelWithFallback(senderTabId?: number) {
  const tabId = senderTabId ?? await getActiveTabId();
  const access = evaluatePageAccess((await chrome.tabs.get(tabId)).url, extensionConfig.optionalHostPermissions);

  if (!access.allowed) {
    const domainError = createDomainError(access.code ?? "PERMISSION_ERROR", access.message ?? "Current page is not accessible");
    await patchState({
      status: "error",
      error: domainError,
      errorMessage: toDisplayMessage(domainError),
      uiMode: "sidepanel"
    });
    return;
  }

  try {
    await chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true });
    await chrome.sidePanel.open({ tabId });
    await patchState({ uiMode: "sidepanel", error: null, errorMessage: "" });
  } catch {
    // 仅当用户已显式点击扩展动作、且 side panel API 不可用时，才使用 activeTab 支撑当前标签页的一次性嵌入式 UI。
    // 该兜底不替代 host permission 授权，后续采集仍需命中规则并持有对应域名权限。
    await patchState({ uiMode: "embedded", error: null, errorMessage: "" });
    await sendMessageToReadyContent(tabId, { type: "TOGGLE_EMBEDDED_PANEL" } satisfies RuntimeMessage).catch(() => undefined);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await setState(initialAssistantState);
  const storedRules = await chrome.storage.local.get(RULES_STORAGE_KEY);
  if (!storedRules[RULES_STORAGE_KEY]) {
    await saveRules([]);
  }
  if (chrome.sidePanel?.setPanelBehavior) {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  }
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "OPEN_PANEL":
          await openPanelWithFallback(sender.tab?.id);
          sendResponse({ ok: true });
          break;
        case "GET_STATE":
          sendResponse(await getState());
          break;
        case "GET_RULES":
          sendResponse(normalizeRulesResponse(await getRules()));
          break;
        case "UPSERT_RULE": {
          const current = await getRules();
          const next = upsertRule(current, message.payload);
          await saveRules(next);
          sendResponse(normalizeRulesResponse(next));
          break;
        }
        case "DELETE_RULE": {
          const current = await getRules();
          const next = removeRule(current, message.payload.ruleId);
          await saveRules(next);
          sendResponse(normalizeRulesResponse(next));
          break;
        }
        case "GET_ACTIVE_CONTEXT":
          sendResponse(await getActiveTabContext());
          break;
        case "START_RUN":
          sendResponse(await startRunFromActiveTab(message.payload));
          break;
        case "SET_MAIN_AGENT":
          await patchState({ mainAgentPreference: message.payload.selectedAgent });
          sendResponse({ ok: true, data: { selectedAgent: message.payload.selectedAgent } });
          break;
        case "SYNC_RUN_STATE":
          await syncRunState(message.payload);
          sendResponse({ ok: true });
          break;
        case "RECAPTURE":
          await runCaptureOnly();
          sendResponse({ ok: true });
          break;
        case "CLEAR_RESULT":
          await clearResult();
          sendResponse({ ok: true });
          break;
        default:
          sendResponse(undefined);
      }
    } catch (error) {
      const domainError = normalizeDomainError(error, createDomainError("CAPTURE_ERROR", "Unknown extension error"));
      await patchState({
        status: "error",
        error: domainError,
        errorMessage: toDisplayMessage(domainError)
      });
      sendResponse({ ok: false, error: domainError });
    }
  })();

  return true;
});
