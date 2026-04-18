import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const CDP_ORIGIN = process.env.CHROME_CDP_ORIGIN ?? "http://127.0.0.1:9222";
const TEST_URL = process.env.EXTENSION_TEST_URL ?? "http://127.0.0.1:4173/";
const RUN_PROMPT = process.env.EXTENSION_SMOKE_PROMPT ?? "请总结当前 SR 的风险与建议下一步动作。";
const STATE_KEY = "ai-web-assistant-state";
const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../temp/real-extension-smoke");
const EXTENSION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const PROFILE_DIR = path.join(OUTPUT_DIR, "playwright-profile");
const ADAPTER_LOG_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../python_adapter/logs/invocations.jsonl");
const LAUNCH_MODE = process.env.EXTENSION_SMOKE_BROWSER_MODE ?? "launch";
const CHROMIUM_EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? null;
const NOISE_MARKERS = ["会话已创建", "会话状态", "正在读取所需内容"];
const ENFORCE_ASSISTANT_TEXT_COMPARISON = process.env.REAL_SMOKE_ENFORCE_TEXT_COMPARISON !== "0";

function normalizeComparableText(value) {
  return String(value ?? "")
    .replace(/\r\n/gu, "\n")
    .replace(/`+/gu, "")
    .replace(/^[ \t]*#{1,6}[ \t]+/gmu, "")
    .replace(/^[ \t]*[-*][ \t]+/gmu, "")
    .replace(/^[ \t]*\d+\.[ \t]+/gmu, "")
    .replace(/\*\*(.*?)\*\*/gu, "$1")
    .replace(/__(.*?)__/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

function dedupeComparableTexts(values) {
  const normalized = [];
  for (const value of values) {
    const next = normalizeComparableText(value);
    if (!next) {
      continue;
    }
    if (normalized[normalized.length - 1] !== next) {
      normalized.push(next);
    }
  }
  return normalized;
}

function mergeComparableDelta(current, delta) {
  const next = String(delta ?? "");
  if (!next.trim()) {
    return current;
  }

  if (!current.trim()) {
    return next;
  }

  if (current === next || current.endsWith(next)) {
    return current;
  }

  if (next.startsWith(current)) {
    return next;
  }

  return `${current}${next}`;
}

function mergeComparableSnapshot(current, snapshot) {
  const next = String(snapshot ?? "");
  if (!next.trim()) {
    return current;
  }

  if (!current.trim()) {
    return next;
  }

  if (current === next || current.endsWith(next)) {
    return current;
  }

  if (next.includes(current) || next.startsWith(current)) {
    return next;
  }

  if (current.includes(next)) {
    return current;
  }

  return next.length >= current.length ? next : current;
}

async function getVisibleTranscriptParts(frame) {
  return await frame.locator("[data-section='part']").evaluateAll((nodes) => nodes.map((node) => ({
    kind: node.getAttribute("data-part-kind"),
    role: node.getAttribute("data-part-role"),
    anchorId: node.getAttribute("data-part-anchor"),
    text: (node.textContent ?? "").trim()
  })));
}

async function readInvocationLogEntries() {
  const raw = await readFile(ADAPTER_LOG_PATH, "utf8").catch(() => "");
  return raw
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return {
          rawLine: line,
          parsed: JSON.parse(line)
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function getEntriesForRun(entries, runId) {
  return entries
    .map((entry) => entry?.parsed)
    .filter((entry) => entry?.run_id === runId);
}

function extractExpectedAssistantTexts(runEntries) {
  const textsByMessageId = new Map();
  const messageOrder = [];

  for (const entry of runEntries) {
    if (entry?.phase !== "stream_raw_event") {
      continue;
    }

    const rawEvent = entry.raw_event;
    if (!rawEvent || typeof rawEvent !== "object") {
      continue;
    }

    if (rawEvent.source === "opencode" && rawEvent.eventType === "message.part.updated") {
      const properties = rawEvent.payload?.event?.payload?.properties;
      const part = properties?.part;
      const messageId = typeof properties?.messageID === "string" ? properties.messageID : null;
      const partType = typeof part?.type === "string" ? part.type : null;
      const text = typeof part?.text === "string" ? part.text : "";
      if (!messageId || partType !== "text" || !normalizeComparableText(text)) {
        continue;
      }

      if (!textsByMessageId.has(messageId)) {
        messageOrder.push(messageId);
      }
      textsByMessageId.set(messageId, mergeComparableSnapshot(textsByMessageId.get(messageId) ?? "", text));
      continue;
    }

    if (rawEvent.source === "opencode" && rawEvent.eventType === "message.part.delta") {
      const properties = rawEvent.payload?.event?.payload?.properties;
      const messageId = typeof properties?.messageID === "string" ? properties.messageID : null;
      const field = typeof properties?.field === "string" ? properties.field : null;
      const delta = typeof properties?.delta === "string" ? properties.delta : "";
      if (!messageId || field !== "text" || !normalizeComparableText(delta)) {
        continue;
      }

      if (!textsByMessageId.has(messageId)) {
        messageOrder.push(messageId);
      }
      textsByMessageId.set(messageId, mergeComparableDelta(textsByMessageId.get(messageId) ?? "", delta));
      continue;
    }

    if (rawEvent.source === "adapter" && rawEvent.eventType === "session.messages") {
      const messages = Array.isArray(rawEvent.payload?.messages) ? rawEvent.payload.messages : [];
      for (const message of messages) {
        const messageId = typeof message?.info?.id === "string" ? message.info.id : null;
        const role = typeof message?.info?.role === "string" ? message.info.role : null;
        if (!messageId || role !== "assistant") {
          continue;
        }

        const text = (Array.isArray(message?.parts) ? message.parts : [])
          .filter((part) => part?.type === "text" && typeof part?.text === "string")
          .map((part) => part.text)
          .join("\n")
          .trim();
        if (!normalizeComparableText(text)) {
          continue;
        }

        if (!textsByMessageId.has(messageId)) {
          messageOrder.push(messageId);
        }
        textsByMessageId.set(messageId, text);
      }
    }
  }

  return messageOrder
    .map((messageId) => textsByMessageId.get(messageId))
    .filter((value) => normalizeComparableText(value));
}

function extractAssistantTextsFromState(state) {
  const textsByMessageId = new Map();
  const messageOrder = [];
  const events = Array.isArray(state?.runEvents) ? state.runEvents : [];

  for (const event of events) {
    const channel = event?.semantic?.channel;
    if (channel !== "assistant_text") {
      continue;
    }

    const messageId = typeof event?.semantic?.messageId === "string"
      ? event.semantic.messageId
      : typeof event?.data?.message_id === "string"
        ? event.data.message_id
        : null;
    if (!messageId) {
      continue;
    }

    const text = normalizeComparableText(event?.message);
    if (!text) {
      continue;
    }

    if (!textsByMessageId.has(messageId)) {
      messageOrder.push(messageId);
    }

    const currentText = textsByMessageId.get(messageId) ?? "";
    const nextText = event?.semantic?.emissionKind === "snapshot" || event?.type === "result"
      ? mergeComparableSnapshot(currentText, event.message)
      : mergeComparableDelta(currentText, event.message);
    textsByMessageId.set(messageId, nextText);
  }

  return messageOrder
    .map((messageId) => textsByMessageId.get(messageId))
    .filter((value) => normalizeComparableText(value));
}

function compareOrderedTextArrays(expected, actual) {
  const normalizedExpected = expected.map((value) => normalizeComparableText(value)).filter(Boolean);
  const normalizedActual = actual.map((value) => normalizeComparableText(value)).filter(Boolean);
  return {
    ok: JSON.stringify(normalizedExpected) === JSON.stringify(normalizedActual),
    expected: normalizedExpected,
    actual: normalizedActual,
    duplicateVisibleMessages: normalizedActual.filter((value, index) => normalizedActual.indexOf(value) !== index)
  };
}

async function getBrowserWebSocketUrl() {
  const response = await fetch(`${CDP_ORIGIN}/json/version`);
  if (!response.ok) {
    throw new Error(`Failed to query Chrome DevTools endpoint: ${response.status}`);
  }

  const payload = await response.json();
  if (!payload.webSocketDebuggerUrl) {
    throw new Error("Chrome DevTools endpoint did not return a browser WebSocket URL");
  }

  return payload.webSocketDebuggerUrl;
}

async function createBrowserContext() {
  if (LAUNCH_MODE === "cdp") {
    const browser = await chromium.connectOverCDP(await getBrowserWebSocketUrl());
    const [context] = browser.contexts();
    if (!context) {
      await browser.close();
      throw new Error("No browser context available from Chrome CDP session");
    }

    return {
      context,
      close: async () => {
        await browser.close();
      }
    };
  }

  await rm(PROFILE_DIR, { recursive: true, force: true });

  const executablePath = await resolveChromiumExecutablePath();

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    executablePath,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`
    ]
  });

  return {
    context,
    close: async () => {
      await context.close();
    }
  };
}

async function resolveChromiumExecutablePath() {
  if (CHROMIUM_EXECUTABLE) {
    return CHROMIUM_EXECUTABLE;
  }

  const playwrightRoot = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  if (!playwrightRoot) {
    return undefined;
  }

  const entries = await readdir(playwrightRoot, { withFileTypes: true }).catch(() => []);
  const chromiumDirs = entries
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => Number(right.slice("chromium-".length)) - Number(left.slice("chromium-".length)));

  for (const dirName of chromiumDirs) {
    const candidate = path.join(playwrightRoot, dirName, "chrome-win64", "chrome.exe");
    try {
      await readdir(path.dirname(candidate));
      return candidate;
    } catch {
      // Try the next cached browser.
    }
  }

  return undefined;
}

async function waitFor(condition, options) {
  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? 30000;
  const intervalMs = options.intervalMs ?? 250;

  while (Date.now() - start <= timeoutMs) {
    const result = await condition();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(options.errorMessage ?? "Timed out waiting for condition");
}

function extractExtensionId(url) {
  const match = /^chrome-extension:\/\/([a-z]{32})\//.exec(url);
  if (!match) {
    throw new Error(`Unable to extract extension ID from URL: ${url}`);
  }
  return match[1];
}

async function getExtensionServiceWorker(context) {
  return await waitFor(() => {
    const worker = context.serviceWorkers().find((candidate) => candidate.url().startsWith("chrome-extension://") && candidate.url().endsWith("/background.js"));
    return worker ?? null;
  }, {
    timeoutMs: 20000,
    errorMessage: "Timed out waiting for extension background service worker"
  });
}

async function ensureTestPage(context) {
  let page = context.pages().find((candidate) => candidate.url().startsWith(TEST_URL));
  if (!page) {
    page = await context.newPage();
    await page.goto(TEST_URL, { waitUntil: "domcontentloaded" });
  } else {
    await page.bringToFront();
    await page.goto(TEST_URL, { waitUntil: "domcontentloaded" });
  }

  await page.waitForLoadState("networkidle").catch(() => undefined);
  return page;
}

async function getActiveTabId(serviceWorker) {
  return await serviceWorker.evaluate(async ({ targetUrl }) => {
    const matchingTabs = await chrome.tabs.query({});
    const matchedTab = matchingTabs.find((tab) => typeof tab.id === "number" && typeof tab.url === "string" && tab.url.startsWith(targetUrl));
    if (!matchedTab?.id) {
      throw new Error(`No tab matched ${targetUrl}`);
    }
    return matchedTab.id;
  }, { targetUrl: TEST_URL });
}

async function toggleEmbeddedPanel(serviceWorker, tabId) {
  await serviceWorker.evaluate(async ({ activeTabId }) => {
    await chrome.tabs.sendMessage(activeTabId, { type: "TOGGLE_EMBEDDED_PANEL" });
  }, { activeTabId: tabId });
}

async function getExtensionFrame(page, extensionId) {
  return await waitFor(() => {
    const targetPrefix = `chrome-extension://${extensionId}/`;
    return page.frames().find((candidate) => candidate.url().startsWith(targetPrefix)) ?? null;
  }, {
    timeoutMs: 20000,
    errorMessage: "Timed out waiting for embedded extension frame"
  });
}

async function getExtensionState(page, extensionId) {
  const extensionFrame = await getExtensionFrame(page, extensionId);
  return await extensionFrame.evaluate(async ({ stateKey }) => {
    const stored = await chrome.storage.local.get(stateKey);
    return stored[stateKey] ?? null;
  }, { stateKey: STATE_KEY });
}

async function waitForStableAssistantOutput(page, extensionId, frame, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120000;
  const intervalMs = options.intervalMs ?? 1000;
  const stablePollsRequired = options.stablePollsRequired ?? 4;
  const start = Date.now();
  let previousSignature = null;
  let stablePolls = 0;
  let latestSample = null;

  while (Date.now() - start <= timeoutMs) {
    const state = await getExtensionState(page, extensionId);
    const visibleText = await frame.locator("body").innerText();
    const visibleParts = await getVisibleTranscriptParts(frame);
    const assistantTextCount = visibleParts.filter((part) => part.role === "assistant" && part.kind === "text").length;
    const signature = JSON.stringify({
      runEvents: Array.isArray(state?.runEvents) ? state.runEvents.length : 0,
      lastUpdatedAt: state?.lastUpdatedAt ?? null,
      currentRunUpdatedAt: state?.currentRun?.updatedAt ?? null,
      currentRunStatus: state?.currentRun?.status ?? null,
      streamStatus: state?.stream?.status ?? null,
      visibleAssistantText: normalizeComparableText(visibleParts.filter((part) => part.role === "assistant" && part.kind === "text").map((part) => part.text).join("\n\n")),
      visibleTextLength: visibleText.length
    });

    latestSample = { state, panelText: visibleText, visibleParts };

    if (assistantTextCount > 0 && signature === previousSignature) {
      stablePolls += 1;
      if (stablePolls >= stablePollsRequired) {
        return latestSample;
      }
    } else {
      stablePolls = 0;
      previousSignature = signature;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  if (latestSample) {
    return latestSample;
  }

  throw new Error("Timed out waiting for assistant output to stabilize");
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const beforeEntries = await readInvocationLogEntries();
  const beforeRawLines = new Set(beforeEntries.map((entry) => entry.rawLine));

  const browserSession = await createBrowserContext();

  try {
    const { context } = browserSession;

    const serviceWorker = await getExtensionServiceWorker(context);
    const extensionId = extractExtensionId(serviceWorker.url());
    const page = await ensureTestPage(context);

    await page.waitForSelector("#ai-web-assistant-floating-button", { timeout: 20000 });
    const floatingButtonText = (await page.locator("#ai-web-assistant-floating-button").textContent())?.trim() ?? "";

    const tabId = await getActiveTabId(serviceWorker);
    await toggleEmbeddedPanel(serviceWorker, tabId);

    const panelSelector = "#ai-web-assistant-embedded-panel iframe[title='AI Web Assistant']";
    await page.waitForSelector(panelSelector, { timeout: 20000 });
    const frame = page.frameLocator(panelSelector);
    await frame.locator("textarea").waitFor({ timeout: 20000 });
    await frame.locator("button[aria-label='发送消息']").waitFor({ timeout: 20000 });

    const initialPanelText = await frame.locator("body").innerText();
    await frame.locator("textarea").fill(RUN_PROMPT);
    await frame.locator("button[aria-label='发送消息']").click();

    await waitFor(async () => {
      const state = await getExtensionState(page, extensionId);
      return state?.currentRun?.runId ? state : null;
    }, {
      timeoutMs: 30000,
      errorMessage: "Timed out waiting for a real run to start"
    });

    await waitFor(async () => {
      const state = await getExtensionState(page, extensionId);
      const visibleText = await frame.locator("body").innerText();
      const hasAssistantCopy = /REAL_EXTENSION_SMOKE_OK|assistant|回复|建议|风险/i.test(visibleText);
      const hasEvents = Array.isArray(state?.runEvents) && state.runEvents.length > 0;
      return hasAssistantCopy || hasEvents ? { state, visibleText } : null;
    }, {
      timeoutMs: 90000,
      intervalMs: 500,
      errorMessage: "Timed out waiting for the embedded panel to show live run output"
    });

    const settled = await waitForStableAssistantOutput(page, extensionId, frame, {
      timeoutMs: 120000,
      intervalMs: 1000,
      stablePollsRequired: 4
    });

    const pageScreenshotPath = path.join(OUTPUT_DIR, "test-page.png");
    const panelScreenshotPath = path.join(OUTPUT_DIR, "embedded-panel.png");
    const panelHtmlPath = path.join(OUTPUT_DIR, "OUR_EXTENSION.HTML");
    const stateJsonPath = path.join(OUTPUT_DIR, "extension-state.json");
    const rawEventsJsonPath = path.join(OUTPUT_DIR, "raw-events.json");
    const visiblePartsJsonPath = path.join(OUTPUT_DIR, "visible-parts.json");
    const comparisonJsonPath = path.join(OUTPUT_DIR, "comparison.json");

    await page.screenshot({ path: pageScreenshotPath, fullPage: true });
    await frame.locator("body").screenshot({ path: panelScreenshotPath });
    
    const panelHtml = await frame.locator("body").innerHTML();
    await writeFile(panelHtmlPath, panelHtml, "utf-8");

    const afterEntries = await readInvocationLogEntries();
    const newEntries = afterEntries.filter((entry) => !beforeRawLines.has(entry.rawLine));
    const runEntries = getEntriesForRun(newEntries, settled.state?.currentRun?.runId ?? "");
    const expectedAssistantTexts = extractExpectedAssistantTexts(runEntries);
    const stateAssistantTexts = extractAssistantTextsFromState(settled.state);
    const visibleAssistantTexts = dedupeComparableTexts(
      (settled.visibleParts ?? [])
        .filter((part) => part.role === "assistant" && part.kind === "text")
        .map((part) => part.text)
    );
    const assistantTextComparison = {
      rawVsUi: compareOrderedTextArrays(expectedAssistantTexts, visibleAssistantTexts),
      stateVsUi: compareOrderedTextArrays(stateAssistantTexts, visibleAssistantTexts),
      rawVsState: compareOrderedTextArrays(expectedAssistantTexts, stateAssistantTexts)
    };

    await writeFile(stateJsonPath, JSON.stringify(settled.state, null, 2), "utf8");
    await writeFile(rawEventsJsonPath, JSON.stringify(runEntries, null, 2), "utf8");
    await writeFile(visiblePartsJsonPath, JSON.stringify(settled.visibleParts ?? [], null, 2), "utf8");
    await writeFile(comparisonJsonPath, JSON.stringify({
      runId: settled.state?.currentRun?.runId ?? null,
      expectedAssistantTexts,
      stateAssistantTexts,
      visibleAssistantTexts,
      assistantTextComparison
    }, null, 2), "utf8");

    const summary = {
      extensionId,
      testUrl: TEST_URL,
      prompt: RUN_PROMPT,
      floatingButtonText,
      initialPanelContainsPermissionState: initialPanelText.includes("域名未授权") || initialPanelText.includes("域名已授权"),
      runId: settled.state?.currentRun?.runId ?? null,
      runStatus: settled.state?.currentRun?.status ?? null,
      streamStatus: settled.state?.stream?.status ?? null,
      finalOutputLength: settled.state?.currentRun?.finalOutput?.length ?? 0,
      runEventCount: Array.isArray(settled.state?.runEvents) ? settled.state.runEvents.length : 0,
      rawEventCount: runEntries.length,
      containsNoiseMarkers: NOISE_MARKERS.filter((marker) => settled.panelText.includes(marker)),
      assistantTextComparison,
      panelTextSample: settled.panelText.slice(0, 2000),
      exports: {
        pageScreenshot: pageScreenshotPath,
        panelScreenshot: panelScreenshotPath,
        panelHtml: panelHtmlPath,
        state: stateJsonPath,
        rawEvents: rawEventsJsonPath,
        visibleParts: visiblePartsJsonPath,
        comparison: comparisonJsonPath
      }
    };

    console.log(JSON.stringify(summary, null, 2));

    if (!summary.runId) {
      throw new Error("Smoke test did not start a real run");
    }

    if (summary.runEventCount === 0) {
      throw new Error("Smoke test did not receive any real run events");
    }

    if (!settled.panelText.trim()) {
      throw new Error("Embedded panel did not render any visible content");
    }

    if (!assistantTextComparison.rawVsUi.ok || !assistantTextComparison.stateVsUi.ok) {
      if (ENFORCE_ASSISTANT_TEXT_COMPARISON) {
        throw new Error(`Assistant message comparison failed: ${JSON.stringify(assistantTextComparison, null, 2)}`);
      }

      console.warn(`Assistant message comparison mismatch ignored by REAL_SMOKE_ENFORCE_TEXT_COMPARISON=0: ${JSON.stringify(assistantTextComparison, null, 2)}`);
    }
  } finally {
    await browserSession.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});