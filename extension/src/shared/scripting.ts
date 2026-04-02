import type { ContentScriptReadyResponse, RuntimeMessage } from "./types";

const READY_TIMEOUT_MS = 500;
const READY_RETRY_INTERVAL_MS = 50;

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isReceivingEndMissingError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Receiving end does not exist");
}

async function pingContentScript(tabId: number) {
  return await chrome.tabs.sendMessage(tabId, { type: "PING" } satisfies RuntimeMessage) as ContentScriptReadyResponse | undefined;
}

export async function ensureContentScriptReady(tabId: number) {
  try {
    const response = await pingContentScript(tabId);
    if (response?.ready) {
      return;
    }
  } catch (error) {
    if (!isReceivingEndMissingError(error)) {
      throw error;
    }
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"]
  });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await pingContentScript(tabId);
      if (response?.ready) {
        return;
      }
    } catch (error) {
      lastError = error;
      if (!isReceivingEndMissingError(error)) {
        throw error;
      }
    }

    await sleep(READY_RETRY_INTERVAL_MS);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Timed out waiting for content script readiness");
}
