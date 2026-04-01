import { requestAnalysis } from "../shared/api";
import { initialAssistantState, STORAGE_KEY } from "../shared/state";
import { extensionConfig } from "../shared/config";
import { createDomainError, normalizeDomainError, toDisplayMessage } from "../shared/errors";
import { evaluatePageAccess, matchesChromePattern, toOriginPermissionPattern } from "../shared/pageAccess";
import { ensureContentScriptInjected } from "../shared/scripting";
import { findMatchingRule, getStoredRules, removeRule, RULES_STORAGE_KEY, saveRules, toCanonicalCapturedFields, upsertRule } from "../shared/rules";
import type { ActiveTabContext, AssistantState, CapturedFields, PageRule, RuntimeMessage } from "../shared/types";

async function getState(): Promise<AssistantState> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as AssistantState | undefined) ?? initialAssistantState;
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

async function requestHostPermission() {
  const context = await getActiveTabContext();
  if (!context.permissionOrigin || !context.canRequestPermission) {
    throw createDomainError("PERMISSION_ERROR", "当前页面域名不在受控可申请权限清单内。请先在扩展配置中登记该域名后重试。");
  }

  const granted = await chrome.permissions.request({ origins: [context.permissionOrigin] });
  if (!granted) {
    throw createDomainError("PERMISSION_ERROR", "用户拒绝了当前域名授权，请手动重试授权。");
  }

  return await getActiveTabContext();
}

async function collectFromActiveTab(): Promise<CapturedFields> {
  const activeTab = await ensureActiveTabAllowed();
  const rules = await getRules();
  const matchedRule = findMatchingRule(activeTab.url, rules);

  if (!matchedRule) {
    throw createDomainError("RULE_NOT_MATCHED_ERROR", "当前页面未命中任何启用规则，请先配置规则。");
  }

  await ensureContentScriptInjected(activeTab.id!);
  const response = await chrome.tabs.sendMessage(activeTab.id!, {
    type: "COLLECT_FIELDS",
    payload: { fields: matchedRule.fields }
  } satisfies RuntimeMessage) as CapturedFields | undefined;

  if (!response) {
    throw createDomainError("CAPTURE_ERROR", "Failed to collect fields from current page");
  }

  return response;
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
    analysisMarkdown: "",
    lastCapturedUrl: activeTab.url ?? null
  });
}

async function runCaptureAndAnalyze() {
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
    status: "analyzing",
    capturedFields,
    error: null,
    analysisMarkdown: ""
  });

  const analysisResponse = await requestAnalysis(toCanonicalCapturedFields(capturedFields));
  if (!analysisResponse.ok) {
    const domainError = normalizeDomainError(analysisResponse.error, createDomainError("ANALYSIS_ERROR", analysisResponse.error.message));
    await patchState({
      status: "error",
      error: domainError,
      errorMessage: toDisplayMessage(domainError),
      analysisMarkdown: ""
    });
    return;
  }

  await patchState({
    status: "done",
    error: null,
    errorMessage: "",
    analysisMarkdown: analysisResponse.data.markdown,
    lastCapturedUrl: activeTab.url ?? null
  });
}

async function clearResult() {
  await setState({
    ...initialAssistantState,
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
    await ensureContentScriptInjected(tabId);
    await chrome.tabs.sendMessage(tabId, { type: "TOGGLE_EMBEDDED_PANEL" } satisfies RuntimeMessage).catch(() => undefined);
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
        case "REQUEST_HOST_PERMISSION":
          sendResponse(await requestHostPermission());
          break;
        case "CAPTURE_AND_ANALYZE":
          await runCaptureAndAnalyze();
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
