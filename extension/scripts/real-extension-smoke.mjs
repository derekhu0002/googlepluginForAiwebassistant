import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const CDP_ORIGIN = process.env.CHROME_CDP_ORIGIN ?? "http://127.0.0.1:9222";
const TEST_URL = process.env.EXTENSION_TEST_URL ?? "http://127.0.0.1:4173/";
const RUN_PROMPT = process.env.EXTENSION_SMOKE_PROMPT ?? "请只回复 REAL_EXTENSION_SMOKE_OK。";
const STATE_KEY = "ai-web-assistant-state";
const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../temp/real-extension-smoke");
const EXTENSION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const PROFILE_DIR = path.join(OUTPUT_DIR, "playwright-profile");
const LAUNCH_MODE = process.env.EXTENSION_SMOKE_BROWSER_MODE ?? "launch";
const CHROMIUM_EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? null;
const NOISE_MARKERS = ["会话已创建", "会话状态", "正在读取所需内容"];

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

async function getExtensionState(serviceWorker) {
  return await serviceWorker.evaluate(async ({ stateKey }) => {
    const stored = await chrome.storage.local.get(stateKey);
    return stored[stateKey] ?? null;
  }, { stateKey: STATE_KEY });
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

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
      const state = await getExtensionState(serviceWorker);
      return state?.currentRun?.runId ? state : null;
    }, {
      timeoutMs: 30000,
      errorMessage: "Timed out waiting for a real run to start"
    });

    await waitFor(async () => {
      const state = await getExtensionState(serviceWorker);
      const visibleText = await frame.locator("body").innerText();
      const hasAssistantCopy = /REAL_EXTENSION_SMOKE_OK|assistant|回复|建议|风险/i.test(visibleText);
      const hasEvents = Array.isArray(state?.runEvents) && state.runEvents.length > 0;
      return hasAssistantCopy || hasEvents ? { state, visibleText } : null;
    }, {
      timeoutMs: 90000,
      intervalMs: 500,
      errorMessage: "Timed out waiting for the embedded panel to show live run output"
    });

    const settled = await waitFor(async () => {
      const state = await getExtensionState(serviceWorker);
      const runStatus = state?.currentRun?.status;
      const streamStatus = state?.stream?.status;
      if (["done", "error", "waiting_for_answer"].includes(runStatus) || ["done", "error", "waiting_for_answer"].includes(streamStatus)) {
        const panelText = await frame.locator("body").innerText();
        return { state, panelText };
      }
      return null;
    }, {
      timeoutMs: 120000,
      intervalMs: 1000,
      errorMessage: "Timed out waiting for the real run to settle"
    }).catch(async () => ({
      state: await getExtensionState(serviceWorker),
      panelText: await frame.locator("body").innerText()
    }));

    const pageScreenshotPath = path.join(OUTPUT_DIR, "test-page.png");
    const panelScreenshotPath = path.join(OUTPUT_DIR, "embedded-panel.png");
    const panelHtmlPath = path.join(OUTPUT_DIR, "OUR_EXTENSION.HTML");

    await page.screenshot({ path: pageScreenshotPath, fullPage: true });
    await frame.locator("body").screenshot({ path: panelScreenshotPath });
    
    const panelHtml = await frame.locator("body").innerHTML();
    await writeFile(panelHtmlPath, panelHtml, "utf-8");

    const summary = {
      extensionId,
      testUrl: TEST_URL,
      floatingButtonText,
      initialPanelContainsPermissionState: initialPanelText.includes("域名未授权") || initialPanelText.includes("域名已授权"),
      runId: settled.state?.currentRun?.runId ?? null,
      runStatus: settled.state?.currentRun?.status ?? null,
      streamStatus: settled.state?.stream?.status ?? null,
      finalOutputLength: settled.state?.currentRun?.finalOutput?.length ?? 0,
      runEventCount: Array.isArray(settled.state?.runEvents) ? settled.state.runEvents.length : 0,
      containsNoiseMarkers: NOISE_MARKERS.filter((marker) => settled.panelText.includes(marker)),
      panelTextSample: settled.panelText.slice(0, 2000),
      exports: {
        pageScreenshot: pageScreenshotPath,
        panelScreenshot: panelScreenshotPath,
        panelHtml: panelHtmlPath
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
  } finally {
    await browserSession.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});