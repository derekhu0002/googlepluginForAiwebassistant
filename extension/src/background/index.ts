import { requestAnalysis } from "../shared/api";
import { initialAssistantState, STORAGE_KEY } from "../shared/state";
import { extensionConfig } from "../shared/config";
import { createDomainError, normalizeDomainError, toDisplayMessage } from "../shared/errors";
import { evaluatePageAccess } from "../shared/pageAccess";
import type { AssistantState, CapturedFields, RuntimeMessage } from "../shared/types";

async function getState(): Promise<AssistantState> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as AssistantState | undefined) ?? initialAssistantState;
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

async function ensureActiveTabAllowed() {
  const activeTab = await getActiveTab();
  const access = evaluatePageAccess(activeTab.url, extensionConfig.allowedPageMatches);

  if (!access.allowed) {
    throw createDomainError(access.code ?? "PERMISSION_ERROR", access.message ?? "Current page is not accessible");
  }

  return activeTab;
}

async function collectFromActiveTab(): Promise<CapturedFields> {
  const activeTab = await ensureActiveTabAllowed();
  const response = await chrome.tabs.sendMessage(activeTab.id!, { type: "COLLECT_FIELDS" } satisfies RuntimeMessage) as CapturedFields | undefined;

  if (!response) {
    throw createDomainError("CAPTURE_ERROR", "Failed to collect fields from current page");
  }

  return response;
}

async function runCaptureOnly() {
  await patchState({
    status: "collecting",
    error: null,
    errorMessage: ""
  });

  const capturedFields = await collectFromActiveTab();
  await patchState({
    status: "done",
    capturedFields,
    error: null,
    analysisMarkdown: ""
  });
}

async function runCaptureAndAnalyze() {
  await patchState({
    status: "collecting",
    error: null,
    errorMessage: ""
  });

  const capturedFields = await collectFromActiveTab();
  await patchState({
    status: "analyzing",
    capturedFields,
    error: null,
    analysisMarkdown: ""
  });

  const analysisResponse = await requestAnalysis(capturedFields);
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
    analysisMarkdown: analysisResponse.data.markdown
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
  const access = evaluatePageAccess((await chrome.tabs.get(tabId)).url, extensionConfig.allowedPageMatches);

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
    await patchState({ uiMode: "embedded", error: null, errorMessage: "" });
    await chrome.tabs.sendMessage(tabId, { type: "TOGGLE_EMBEDDED_PANEL" } satisfies RuntimeMessage).catch(() => undefined);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await setState(initialAssistantState);
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
