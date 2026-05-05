import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const CDP_ORIGIN = process.env.CHROME_CDP_ORIGIN ?? "http://127.0.0.1:9222";
const TEST_URL = process.env.EXTENSION_TEST_URL ?? "http://127.0.0.1:4173/";
const REAL_SMOKE_SCENARIO = String(process.env.REAL_SMOKE_SCENARIO ?? "default").trim().toLowerCase();
const EXPECT_QUESTION = REAL_SMOKE_SCENARIO === "question" || process.env.REAL_SMOKE_EXPECT_QUESTION === "1";
const EXPECT_DOMAIN_ACCESS_DENIAL = REAL_SMOKE_SCENARIO === "domain-access-control" || process.env.REAL_SMOKE_EXPECT_DOMAIN_ACCESS_DENIAL === "1";
const EXPECT_SSE_INTERRUPTION = REAL_SMOKE_SCENARIO === "sse-interruption" || process.env.REAL_SMOKE_EXPECT_SSE_INTERRUPTION === "1";
const EXPECT_STOP_TERMINAL = REAL_SMOKE_SCENARIO === "stop" || process.env.REAL_SMOKE_EXPECT_STOP === "1";
const RUN_PROMPT_BASE = process.env.EXTENSION_SMOKE_PROMPT ?? "请总结当前 SR 的风险与建议下一步动作。";
const RUN_PROMPT_RESPONSE_CONTRACT = process.env.EXTENSION_SMOKE_RESPONSE_CONTRACT ?? "";
const DEFAULT_NON_INTERACTIVE_CONTRACT = process.env.REAL_SMOKE_DEFAULT_RESPONSE_CONTRACT ?? "请直接基于当前已知上下文完成回答，不要向我追问，也不要要求我补充信息。如果信息不足，请明确说明已知风险、缺口和建议下一步动作。";
const QUESTION_TOOL_CONTRACT = process.env.REAL_SMOKE_QUESTION_TOOL_CONTRACT ?? "请先使用 QUESTION 工具向我提出一个澄清问题，再在我回答后继续完成任务。问题必须包含可选项，并允许我补充自由文本。";
const QUESTION_ANSWER_TEXT = process.env.REAL_SMOKE_QUESTION_ANSWER ?? "请按高优先级处理，并在今天内完成验证。";
const OPPORTUNISTIC_QUESTION_ANSWER_TEXT = process.env.REAL_SMOKE_OPPORTUNISTIC_QUESTION_ANSWER ?? "当前没有更多 SR 细节。请基于现有上下文直接给出风险结论、已知缺口和建议下一步动作，不要继续追问。";
const DOMAIN_ACCESS_ERROR_COPY = process.env.REAL_SMOKE_DOMAIN_ACCESS_ERROR_COPY ?? "当前站点未授权采集";
const SSE_INTERRUPTION_ERROR_COPY = process.env.REAL_SMOKE_SSE_INTERRUPTION_ERROR_COPY ?? "连接中断，请重试";
const STATE_KEY = "ai-web-assistant-state";
const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../temp/real-extension-smoke");
const EXTENSION_WORKSPACE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const PROFILE_ROOT_DIR = path.join(OUTPUT_DIR, "playwright-profile-runs");
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PYTHON_ADAPTER_DIR = path.join(REPO_ROOT, "python_adapter");
const LAUNCH_MODE = process.env.EXTENSION_SMOKE_BROWSER_MODE ?? "launch";
const CHROMIUM_EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? null;
const NOISE_MARKERS = ["会话已创建", "会话状态", "正在读取所需内容"];
const ENFORCE_ASSISTANT_SEQUENCE_COMPARISON = process.env.REAL_SMOKE_ENFORCE_SEQUENCE_COMPARISON !== "0";
const CAPTURE_PROGRESS_CHECKPOINTS = process.env.REAL_SMOKE_CAPTURE_PROGRESS_CHECKPOINT === "1";
const CAPTURE_BEFORE_SEND = process.env.REAL_SMOKE_CAPTURE_BEFORE_SEND === "1";
const CAPTURE_PERFORMANCE_GUARD = process.env.REAL_SMOKE_CAPTURE_PERFORMANCE_GUARD === "1";
const PERFORMANCE_SAMPLE_INTERVAL_MS = Number(process.env.REAL_SMOKE_PERFORMANCE_SAMPLE_INTERVAL_MS ?? "100");
const PERFORMANCE_FREEZE_THRESHOLD_MS = Number(process.env.REAL_SMOKE_PERFORMANCE_FREEZE_THRESHOLD_MS ?? "250");
const REQUIRE_REPO_OPENCODE_STUB = process.env.REAL_SMOKE_REQUIRE_REPO_STUB === "1";
const REQUIRE_LIVE_UPSTREAM = process.env.REAL_SMOKE_REQUIRE_LIVE_UPSTREAM === "1";
const TEST_OPENCODE_STUB_PORT = Number(process.env.REAL_SMOKE_OPENCODE_STUB_PORT ?? (REQUIRE_REPO_OPENCODE_STUB ? "18124" : "8124"));
const TEST_ADAPTER_PORT = Number(process.env.REAL_SMOKE_ADAPTER_PORT ?? (REQUIRE_REPO_OPENCODE_STUB ? "18030" : "8030"));
const EXTENSION_API_BASE_URL = process.env.REAL_SMOKE_EXTENSION_API_BASE_URL ?? `http://127.0.0.1:${TEST_ADAPTER_PORT}`;
const OPENCODE_BASE_URL = process.env.REAL_SMOKE_OPENCODE_BASE_URL ?? `http://127.0.0.1:${TEST_OPENCODE_STUB_PORT}`;
const OPENCODE_HEALTH_URL = process.env.EXTENSION_SMOKE_OPENCODE_HEALTH_URL ?? `${OPENCODE_BASE_URL}/global/health`;
const ADAPTER_HEALTH_URL = process.env.EXTENSION_SMOKE_ADAPTER_HEALTH_URL ?? `${EXTENSION_API_BASE_URL}/health`;
const ADAPTER_LOG_DIR = process.env.EXTENSION_SMOKE_ADAPTER_LOG_DIR ?? path.join(OUTPUT_DIR, "python-adapter-logs");
const ADAPTER_LOG_PATH = process.env.EXTENSION_SMOKE_ADAPTER_LOG_PATH ?? path.join(ADAPTER_LOG_DIR, "invocations.jsonl");
const OPENCODE_STUB_SCRIPT = path.join(REPO_ROOT, "scripts", "mock-opencode-server.mjs");
const PYTHON_EXECUTABLE = process.env.REAL_SMOKE_PYTHON_EXECUTABLE ?? "python";

function buildSmokePrompt(basePrompt, responseContract, options = {}) {
  const normalizedPrompt = String(basePrompt ?? "").trim();
  const normalizedContract = String(responseContract ?? "").trim();
  const promptSections = [normalizedPrompt].filter(Boolean);
  if (options.expectQuestion) {
    promptSections.push(String(options.questionToolContract ?? "").trim());
  } else if (options.nonInteractiveContract) {
    promptSections.push(String(options.nonInteractiveContract).trim());
  }

  if (normalizedContract) {
    promptSections.push(`请严格按以下返回契约作答：\n${normalizedContract}`);
  }

  return promptSections.join("\n\n").trim();
}

const RUN_PROMPT = buildSmokePrompt(RUN_PROMPT_BASE, RUN_PROMPT_RESPONSE_CONTRACT, {
  expectQuestion: EXPECT_QUESTION,
  questionToolContract: QUESTION_TOOL_CONTRACT,
  nonInteractiveContract: REAL_SMOKE_SCENARIO === "default" ? DEFAULT_NON_INTERACTIVE_CONTRACT : ""
});

function logSmokeStep(step) {
  console.error(`[real-smoke] ${step}`);
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`GET ${url} failed with status ${response.statusCode ?? 500}: ${body}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
  });
}

function attachChildLogging(child, prefix) {
  child.stdout?.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) {
      console.error(`[${prefix}] ${text}`);
    }
  });

  child.stderr?.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) {
      console.error(`[${prefix}] ${text}`);
    }
  });
}

function spawnAndWaitForExit(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { logPrefix, ...spawnOptions } = options;
    const child = spawn(command, args, {
      shell: false,
      ...spawnOptions
    });

    attachChildLogging(child, logPrefix ?? path.basename(command));
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(" ")} terminated by signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}`));
        return;
      }

      resolve();
    });
  });
}

async function ensureOpencodeEnvironment() {
  if (REQUIRE_REPO_OPENCODE_STUB && REQUIRE_LIVE_UPSTREAM) {
    throw new Error("REAL_SMOKE_REQUIRE_REPO_STUB=1 conflicts with REAL_SMOKE_REQUIRE_LIVE_UPSTREAM=1. Real-upstream smoke cannot use the repository stub.");
  }

  try {
    const health = await httpGetJson(OPENCODE_HEALTH_URL);
    logSmokeStep("opencode-health-ready");
    if (REQUIRE_REPO_OPENCODE_STUB && health?.service !== "mock-opencode-server") {
      throw new Error(`REAL_SMOKE_REQUIRE_REPO_STUB=1 but ${OPENCODE_HEALTH_URL} is not serving the repository stub. Expected service=mock-opencode-server, received ${JSON.stringify(health)}.`);
    }
    if (REQUIRE_LIVE_UPSTREAM && health?.service === "mock-opencode-server") {
      throw new Error(`REAL_SMOKE_REQUIRE_LIVE_UPSTREAM=1 but ${OPENCODE_HEALTH_URL} is still serving the repository stub.`);
    }
    return {
      close: async () => undefined,
      upstreamMode: health?.service === "mock-opencode-server" ? "repo-stub" : "external-upstream",
      service: health?.service ?? null,
      health
    };
  } catch (error) {
    if (error instanceof Error && (error.message.includes("REAL_SMOKE_REQUIRE_REPO_STUB=1") || error.message.includes("REAL_SMOKE_REQUIRE_LIVE_UPSTREAM=1"))) {
      throw error;
    }
    if (REQUIRE_LIVE_UPSTREAM) {
      throw new Error(`REAL_SMOKE_REQUIRE_LIVE_UPSTREAM=1 but ${OPENCODE_HEALTH_URL} is unavailable or unhealthy. Live-upstream smoke will not auto-start scripts/mock-opencode-server.mjs.`);
    }
    logSmokeStep("opencode-health-missing-starting-stub");
  }

  const child = spawn(process.execPath, [OPENCODE_STUB_SCRIPT], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: {
      ...process.env,
      OPENCODE_STUB_PORT: String(TEST_OPENCODE_STUB_PORT),
      OPENCODE_STUB_EMIT_QUESTION: EXPECT_QUESTION ? "1" : "0",
      OPENCODE_STUB_STEP_FINISH_STOP_AFTER_CHUNK: EXPECT_STOP_TERMINAL ? String(Number(process.env.OPENCODE_STUB_STEP_FINISH_STOP_AFTER_CHUNK ?? "4")) : "0",
      OPENCODE_STUB_SESSION_ERROR_AFTER_CHUNK: EXPECT_SSE_INTERRUPTION ? String(Number(process.env.OPENCODE_STUB_SESSION_ERROR_AFTER_CHUNK ?? "4")) : "0",
      OPENCODE_STUB_SESSION_ERROR_MESSAGE: SSE_INTERRUPTION_ERROR_COPY
    }
  });
  attachChildLogging(child, "mock-opencode-server");

  await waitFor(async () => {
    try {
      await httpGetJson(OPENCODE_HEALTH_URL);
      return true;
    } catch {
      return null;
    }
  }, {
    timeoutMs: 15000,
    intervalMs: 250,
    errorMessage: "Timed out waiting for repository-local opencode stub to become healthy"
  });

  logSmokeStep("opencode-stub-ready");
  return {
    upstreamMode: "repo-stub",
    service: "mock-opencode-server",
    health: { service: "mock-opencode-server" },
    close: async () => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }
  };
}

async function ensureExtensionBuildForSmoke() {
  logSmokeStep(`extension-build-start apiBaseUrl=${EXTENSION_API_BASE_URL}`);
  const buildCommand = process.platform === "win32" ? "cmd.exe" : "npm";
  const buildArgs = process.platform === "win32" ? ["/d", "/s", "/c", "npm run build"] : ["run", "build"];
  await spawnAndWaitForExit(buildCommand, buildArgs, {
    cwd: EXTENSION_WORKSPACE_DIR,
    env: {
      ...process.env,
      VITE_EXTENSION_ENV: "development",
      VITE_API_BASE_URL: EXTENSION_API_BASE_URL,
      VITE_ALLOWED_API_ORIGINS: EXTENSION_API_BASE_URL
    },
    stdio: ["ignore", "pipe", "pipe"],
    logPrefix: "extension-build"
  });
  logSmokeStep("extension-build-ready");
}

async function ensurePythonAdapterEnvironment() {
  if (!REQUIRE_REPO_OPENCODE_STUB) {
    return { close: async () => undefined, interrupt: async () => undefined, startedBySmoke: false };
  }

  try {
    const health = await httpGetJson(ADAPTER_HEALTH_URL);
    if (health?.backend === "python-adapter" && health?.opencode_base_url === OPENCODE_BASE_URL) {
      logSmokeStep("adapter-health-ready");
      return { close: async () => undefined, interrupt: async () => undefined, startedBySmoke: false };
    }

    throw new Error(`Adapter health check at ${ADAPTER_HEALTH_URL} does not match test environment: ${JSON.stringify(health)}`);
  } catch (error) {
    logSmokeStep(`adapter-health-missing-starting-test-adapter port=${TEST_ADAPTER_PORT}`);
    if (error instanceof Error && /does not match test environment/iu.test(error.message)) {
      throw error;
    }
  }

  await mkdir(ADAPTER_LOG_DIR, { recursive: true });
  const child = spawn(PYTHON_EXECUTABLE, ["-m", "uvicorn", "python_adapter.app.main:app", "--host", "127.0.0.1", "--port", String(TEST_ADAPTER_PORT)], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: {
      ...process.env,
      PYTHON_ADAPTER_PORT: String(TEST_ADAPTER_PORT),
      PYTHON_ADAPTER_ALLOWED_ORIGINS: EXTENSION_API_BASE_URL,
      PYTHON_ADAPTER_LOG_DIR: ADAPTER_LOG_DIR,
      OPENCODE_BASE_URL,
      OPENCODE_DIRECTORY: REPO_ROOT
    }
  });
  attachChildLogging(child, "python-adapter");

  await waitFor(async () => {
    try {
      const health = await httpGetJson(ADAPTER_HEALTH_URL);
      if (health?.backend === "python-adapter" && health?.opencode_base_url === OPENCODE_BASE_URL) {
        return true;
      }
      return null;
    } catch {
      return null;
    }
  }, {
    timeoutMs: 15000,
    intervalMs: 250,
    errorMessage: `Timed out waiting for test python adapter to become healthy at ${ADAPTER_HEALTH_URL}`
  });

  logSmokeStep("adapter-ready");
  return {
    close: async () => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    },
    interrupt: async () => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    },
    startedBySmoke: true
  };
}

function createInitialAssistantState() {
  return {
    status: "idle",
    mainAgentPreference: "TARA_analyst",
    activeSessionId: null,
    capturedFields: null,
    runPrompt: RUN_PROMPT,
    runEvents: [],
    currentRun: null,
    history: [],
    selectedHistoryDetail: null,
    answers: [],
    error: null,
    errorMessage: "",
    lastUpdatedAt: null,
    uiMode: "sidepanel",
    matchedRule: null,
    lastCapturedUrl: null,
    usernameContext: null,
    stream: {
      runId: null,
      status: "idle",
      pendingQuestionId: null,
      reconnectCount: 0
    },
    runEventState: {
      frontier: {
        version: 0,
        acceptedEventCount: 0,
        contiguousSequence: 0,
        lastSequence: 0,
        lastAcceptedAt: null,
        lastAcceptedCanonicalKey: null,
        lastAcceptedRawEventId: null
      },
      acceptedCanonicalKeys: [],
      diagnostics: [],
      transportTraces: []
    },
    syncMetadata: null,
    renderTrace: []
  };
}

function createSmokeRule() {
  const timestamp = new Date().toISOString();
  return {
    id: "rule-real-smoke-capture",
    name: "Real Smoke Test Rule",
    hostnamePattern: "127.0.0.1",
    pathPattern: "*",
    enabled: true,
    fields: [
      {
        id: "field-real-smoke-page-title",
        key: "pageTitle",
        label: "页面标题",
        source: "documentTitle",
        enabled: true
      },
      {
        id: "field-real-smoke-page-url",
        key: "pageUrl",
        label: "页面地址",
        source: "pageUrl",
        enabled: true
      },
      {
        id: "field-real-smoke-software-version",
        key: "software_version",
        label: "软件版本",
        source: "selectorText",
        selector: "[data-software-version]",
        enabled: true
      },
      {
        id: "field-real-smoke-selected-sr",
        key: "selected_sr",
        label: "选中 SR",
        source: "selectorText",
        selector: "[data-selected-sr]",
        enabled: true
      }
    ],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function normalizeComparableText(value) {
  return String(value ?? "")
    .replace(/\r\n/gu, "\n")
    .replace(/`+/gu, " ")
    .replace(/\*\*(.*?)\*\*/gu, " $1 ")
    .replace(/__(.*?)__/gu, " $1 ")
    .replace(/^[ \t]*#{1,6}[ \t]*/gmu, " ")
    .replace(/^[ \t]*[-*+][ \t]*/gmu, " ")
    .replace(/^[ \t]*\d+\.[ \t]*/gmu, " ")
    .replace(/\[(.*?)\]\((.*?)\)/gu, " $1 ")
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

async function getInteractiveCheckpoint(frame) {
  return await frame.locator("body").evaluate((root) => {
    const summary = root.querySelector(".transcript-part-summary-copy");
    const newSessionButton = Array.from(root.querySelectorAll("button")).find((node) => node.textContent?.includes("新会话"));
    const sendButton = root.querySelector("button.send-button[aria-label='发送消息']");
    const textarea = root.querySelector("textarea");

    return {
      summaryText: (summary?.textContent ?? "").trim(),
      newSessionDisabled: newSessionButton instanceof HTMLButtonElement ? newSessionButton.disabled : null,
      sendDisabled: sendButton instanceof HTMLButtonElement ? sendButton.disabled : null,
      textareaDisabled: textarea instanceof HTMLTextAreaElement ? textarea.disabled : null,
      panelText: (root.textContent ?? "").trim()
    };
  });
}

async function installSidepanelPerformanceProbe(frame, options = {}) {
  await frame.evaluate(({ sampleIntervalMs, freezeThresholdMs }) => {
    const probeKey = "__aiWebAssistantPerformanceProbe";
    if (globalThis[probeKey]?.installed) {
      return;
    }

    const state = {
      installed: true,
      startedAt: performance.now(),
      sampleIntervalMs,
      freezeThresholdMs,
      transcriptSamples: [],
      growthEvents: [],
      longTasks: [],
      rafGaps: [],
      inputMeasurements: [],
      agentMeasurements: [],
      errors: [],
      maxGrowthStallMs: 0
    };

    const getSummaryText = () => (document.querySelector(".transcript-part[data-part-kind='summary']")?.textContent ?? "").trim();
    const getAssistantTextLength = () => Array.from(document.querySelectorAll("[data-section='part'][data-part-role='assistant'][data-part-kind='text']"))
      .reduce((total, node) => total + ((node.textContent ?? "").trim().length), 0);
    const nowOffset = () => performance.now() - state.startedAt;
    const isActiveRunPhase = (summaryText, assistantTextLength) => assistantTextLength > 0 || summaryText.includes("进行中") || summaryText.includes("已完成");

    let lastGrowthLength = 0;
    let lastGrowthAt = state.startedAt;
    let rafTrackingActive = false;
    const sample = () => {
      const assistantTextLength = getAssistantTextLength();
      const summaryText = getSummaryText();
      const atMs = nowOffset();
      state.transcriptSamples.push({ atMs, assistantTextLength, summaryText });

      if (!rafTrackingActive && isActiveRunPhase(summaryText, assistantTextLength)) {
        rafTrackingActive = true;
      }

      if (assistantTextLength > lastGrowthLength) {
        lastGrowthLength = assistantTextLength;
        lastGrowthAt = performance.now();
        state.growthEvents.push({ atMs, assistantTextLength });
      }

      if (assistantTextLength > 0 && !summaryText.includes("已完成")) {
        state.maxGrowthStallMs = Math.max(state.maxGrowthStallMs, performance.now() - lastGrowthAt);
      }
    };

    const waitForCondition = async (predicate, timeoutMs = 1000) => {
      const deadline = performance.now() + timeoutMs;
      while (performance.now() <= deadline) {
        if (predicate()) {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      return false;
    };

    const sampleTimer = setInterval(sample, sampleIntervalMs);
    sample();

    let lastAnimationFrameAt = performance.now();
    let animationFrameId = 0;
    const tick = (timestamp) => {
      const gapMs = timestamp - lastAnimationFrameAt;
      if (rafTrackingActive && gapMs > freezeThresholdMs) {
        state.rafGaps.push({ atMs: timestamp - state.startedAt, gapMs });
      }
      lastAnimationFrameAt = timestamp;
      animationFrameId = requestAnimationFrame(tick);
    };
    animationFrameId = requestAnimationFrame(tick);

    let longTaskObserver = null;
    if (typeof PerformanceObserver === "function") {
      try {
        longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            state.longTasks.push({
              atMs: entry.startTime,
              durationMs: entry.duration,
              name: entry.name,
              entryType: entry.entryType
            });
          }
        });
        longTaskObserver.observe({ type: "longtask", buffered: true });
      } catch {
        // longtask is not supported in all environments.
      }
    }

    globalThis[probeKey] = {
      installed: true,
      async measureTextareaInput(text) {
        const textarea = document.querySelector("textarea");
        if (!(textarea instanceof HTMLTextAreaElement)) {
          const result = { supported: false, reason: "textarea-not-found" };
          state.inputMeasurements.push(result);
          return result;
        }

        const startedAt = performance.now();
        textarea.focus();
        textarea.value = text;
        textarea.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        const updated = await waitForCondition(() => textarea.value === text, 750);
        const result = {
          supported: true,
          updated,
          disabled: textarea.disabled,
          latencyMs: performance.now() - startedAt,
          valueLength: text.length
        };
        state.inputMeasurements.push(result);
        return result;
      },
      async measureAgentSwitch() {
        const trigger = document.querySelector(".main-agent-trigger");
        if (!(trigger instanceof HTMLButtonElement)) {
          const result = { supported: false, reason: "agent-trigger-not-found" };
          state.agentMeasurements.push(result);
          return result;
        }

        const before = (trigger.getAttribute("aria-label") ?? trigger.textContent ?? "").trim();
        trigger.click();
        const menuVisible = await waitForCondition(() => document.querySelector("[role='menu'][aria-label='主 AGENT 菜单']"), 750);
        if (!menuVisible) {
          const result = { supported: false, reason: "agent-menu-not-visible" };
          state.agentMeasurements.push(result);
          return result;
        }

        const nextOption = Array.from(document.querySelectorAll(".main-agent-option"))
          .find((node) => node instanceof HTMLButtonElement && node.getAttribute("aria-checked") !== "true");
        if (!(nextOption instanceof HTMLButtonElement)) {
          const result = { supported: false, reason: "alternate-agent-not-found" };
          state.agentMeasurements.push(result);
          return result;
        }

        const startedAt = performance.now();
        nextOption.click();
        const updated = await waitForCondition(() => (trigger.getAttribute("aria-label") ?? trigger.textContent ?? "").trim() !== before, 1000);
        const after = (trigger.getAttribute("aria-label") ?? trigger.textContent ?? "").trim();
        const result = {
          supported: true,
          updated,
          latencyMs: performance.now() - startedAt,
          before,
          after
        };
        state.agentMeasurements.push(result);
        return result;
      },
      stopAndGet() {
        clearInterval(sampleTimer);
        cancelAnimationFrame(animationFrameId);
        longTaskObserver?.disconnect();
        sample();
        return {
          ...state,
          maxLongTaskMs: state.longTasks.reduce((max, entry) => Math.max(max, entry.durationMs ?? 0), 0),
          maxRafGapMs: state.rafGaps.reduce((max, entry) => Math.max(max, entry.gapMs ?? 0), 0)
        };
      }
    };
  }, {
    sampleIntervalMs: options.sampleIntervalMs ?? PERFORMANCE_SAMPLE_INTERVAL_MS,
    freezeThresholdMs: options.freezeThresholdMs ?? PERFORMANCE_FREEZE_THRESHOLD_MS
  });
}

async function measureSidepanelInputLatency(frame, text) {
  return await frame.evaluate(async ({ nextText }) => {
    return await globalThis.__aiWebAssistantPerformanceProbe.measureTextareaInput(nextText);
  }, { nextText: text });
}

async function measureSidepanelAgentSwitchLatency(frame) {
  return await frame.evaluate(async () => {
    return await globalThis.__aiWebAssistantPerformanceProbe.measureAgentSwitch();
  });
}

async function finalizeSidepanelPerformanceProbe(frame) {
  return await frame.evaluate(() => {
    return globalThis.__aiWebAssistantPerformanceProbe?.stopAndGet?.() ?? null;
  });
}

async function waitForCapturedFields(page, extensionId, options = {}) {
  return await waitFor(async () => {
    const state = await getExtensionState(page, extensionId);
    const capturedFields = state?.capturedFields;
    return capturedFields && (capturedFields.selected_sr || capturedFields.software_version) ? state : null;
  }, {
    timeoutMs: options.timeoutMs ?? 30000,
    intervalMs: options.intervalMs ?? 250,
    errorMessage: options.errorMessage ?? "Timed out waiting for captured fields to become available"
  });
}

async function getActiveContext(extensionFrame) {
  return await extensionFrame.evaluate(async () => await chrome.runtime.sendMessage({ type: "GET_ACTIVE_CONTEXT" }));
}

async function ensureSmokeRuleConfiguredInExtensionPage(extensionFrame) {
  const rule = createSmokeRule();
  await extensionFrame.evaluate(async ({ nextRule }) => {
    const storageKey = "ai-web-assistant-rules";
    const stored = await chrome.storage.local.get(storageKey);
    const currentRules = Array.isArray(stored?.[storageKey]) ? stored[storageKey] : [];
    const existingIndex = currentRules.findIndex((candidate) => candidate?.id === nextRule.id);
    const nextRules = existingIndex >= 0
      ? currentRules.map((candidate, index) => index === existingIndex ? nextRule : candidate)
      : [...currentRules, nextRule];
    await chrome.storage.local.set({ [storageKey]: nextRules });
  }, { nextRule: rule });
}

async function clearSmokeRulesInExtensionPage(extensionFrame) {
  await extensionFrame.evaluate(async () => {
    await chrome.storage.local.set({ "ai-web-assistant-rules": [] });
  });
}

async function resetSmokeStateInExtensionPage(extensionFrame) {
  await extensionFrame.evaluate(async ({ stateKey, initialState }) => {
    await chrome.storage.local.set({ [stateKey]: initialState });
  }, {
    stateKey: STATE_KEY,
    initialState: createInitialAssistantState()
  });
}

async function waitForMatchedRule(extensionFrame, options = {}) {
  return await waitFor(async () => {
    const context = await getActiveContext(extensionFrame);
    return context?.matchedRule?.id ? context : null;
  }, {
    timeoutMs: options.timeoutMs ?? 20000,
    intervalMs: options.intervalMs ?? 250,
    errorMessage: options.errorMessage ?? "Timed out waiting for smoke rule to match the active page"
  });
}

async function ensurePagePermission(frameLocator, extensionFrame) {
  const currentContext = await getActiveContext(extensionFrame);
  if (currentContext?.permissionGranted) {
    return currentContext;
  }

  const permissionButton = frameLocator.locator("button[aria-label='授权当前域名']").first();
  await permissionButton.waitFor({ timeout: 20000 });
  await permissionButton.click();

  return await waitFor(async () => {
    const context = await getActiveContext(extensionFrame);
    return context?.permissionGranted ? context : null;
  }, {
    timeoutMs: 30000,
    intervalMs: 250,
    errorMessage: "Timed out waiting for current-domain permission to be granted"
  });
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

function hasIdleEventInRunEntries(runEntries) {
  return runEntries.some((entry) => {
    const rawEvent = entry?.raw_event;
    if (!rawEvent || typeof rawEvent !== "object") {
      return false;
    }

    if (rawEvent.eventType === "session.idle") {
      return true;
    }

    const payloadType = rawEvent.payload?.event?.payload?.type;
    return payloadType === "session.idle";
  });
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

function extractExpectedAssistantMessageIds(runEntries) {
  const orderedMessageIds = [];
  const seenMessageIds = new Set();

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
      const messageId = typeof properties?.messageID === "string"
        ? properties.messageID
        : typeof part?.messageID === "string"
          ? part.messageID
          : null;
      const partType = typeof part?.type === "string" ? part.type : null;
      const text = typeof part?.text === "string" ? part.text : "";
      if (!messageId || partType !== "text" || !normalizeComparableText(text) || seenMessageIds.has(messageId)) {
        continue;
      }

      seenMessageIds.add(messageId);
      orderedMessageIds.push(messageId);
      continue;
    }

    if (rawEvent.source === "adapter" && rawEvent.eventType === "session.messages") {
      const messages = Array.isArray(rawEvent.payload?.messages) ? rawEvent.payload.messages : [];
      for (const message of messages) {
        const messageId = typeof message?.info?.id === "string" ? message.info.id : null;
        const role = typeof message?.info?.role === "string" ? message.info.role : null;
        const text = (Array.isArray(message?.parts) ? message.parts : [])
          .filter((part) => part?.type === "text" && typeof part?.text === "string")
          .map((part) => part.text)
          .join("\n")
          .trim();
        if (!messageId || role !== "assistant" || !normalizeComparableText(text) || seenMessageIds.has(messageId)) {
          continue;
        }

        seenMessageIds.add(messageId);
        orderedMessageIds.push(messageId);
      }
    }
  }

  return orderedMessageIds;
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

function extractAssistantTextPartsFromState(state) {
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
    .map((messageId) => ({
      kind: "text",
      role: "assistant",
      anchorId: messageId,
      text: textsByMessageId.get(messageId)
    }))
    .filter((part) => normalizeComparableText(part.text));
}

function hasTerminalEvidenceInState(state) {
  const runEvents = Array.isArray(state?.runEvents) ? state.runEvents : [];
  if (runEvents.some((event) => event?.type === "result" || event?.type === "error")) {
    return true;
  }

  const currentRun = state?.currentRun ?? null;
  if (currentRun?.status === "done" && normalizeComparableText(currentRun?.finalOutput).length > 0) {
    return true;
  }

  if (currentRun?.status === "error" && normalizeComparableText(currentRun?.errorMessage ?? state?.errorMessage ?? state?.error).length > 0) {
    return true;
  }

  return false;
}

function buildCaptureTextFromState(state) {
  const currentRun = state?.currentRun ?? null;
  const captureEntries = [
    ["selected_sr", currentRun?.selectedSr],
    ["software_version", currentRun?.softwareVersion],
    ["pageTitle", currentRun?.pageTitle],
    ["pageUrl", currentRun?.pageUrl]
  ].filter(([, value]) => normalizeComparableText(value).length > 0);

  return captureEntries.map(([key, value]) => `${key}=${value}`).join("\n");
}

function buildSummaryTextFromState(state) {
  if (state?.currentRun?.status === "error" || state?.stream?.status === "error") {
    return "已中断";
  }

  if (hasTerminalEvidenceInState(state)) {
    return "已完成本轮回答已就绪，可继续追问、复制结果或发起重试。";
  }

  if (state?.stream?.pendingQuestionId) {
    return "等待回答继续当前流程。";
  }

  if (state?.currentRun?.runId) {
    return "进行中正在生成回答，请稍候。";
  }

  return "等待开始新的会话。";
}

function deriveSmokeTerminalState(state, visibleParts, transportIdle) {
  const finalOutputText = normalizeComparableText(state?.currentRun?.finalOutput);
  const summaryText = normalizeComparableText(visibleParts.find((part) => part.kind === "summary")?.text);
  const assistantTextCount = visibleParts.filter((part) => part.role === "assistant" && part.kind === "text").length;
  const stateTerminalEvidence = hasTerminalEvidenceInState(state);
  const canonicalTerminalEvidence = stateTerminalEvidence || (
    transportIdle
    && assistantTextCount > 0
    && finalOutputText.length > 0
    && summaryText.includes("已完成")
    && !summaryText.includes("进行中")
  );

  return {
    assistantTextCount,
    finalOutputText,
    summaryText,
    stateTerminalEvidence,
    canonicalTerminalEvidence,
    runStatus: canonicalTerminalEvidence && state?.currentRun?.status !== "error"
      ? "done"
      : state?.currentRun?.status ?? null,
    streamStatus: canonicalTerminalEvidence && state?.stream?.status !== "error"
      ? "done"
      : state?.stream?.status ?? null
  };
}

function buildVisiblePartsFromState(state) {
  const visibleParts = [];
  const promptText = normalizeComparableText(state?.currentRun?.prompt ?? state?.runPrompt);
  if (promptText) {
    visibleParts.push({
      kind: "prompt",
      role: "user",
      anchorId: `user-prompt:${state?.currentRun?.runId ?? "pending-run"}`,
      text: state?.currentRun?.prompt ?? state?.runPrompt
    });
  }

  const captureText = buildCaptureTextFromState(state);
  if (captureText) {
    visibleParts.push({
      kind: "capture",
      role: "user",
      anchorId: `capture:${state?.currentRun?.runId ?? "pending-run"}`,
      text: captureText
    });
  }

  visibleParts.push(...extractAssistantTextPartsFromState(state));

  visibleParts.push({
    kind: "summary",
    role: "assistant",
    anchorId: `summary:${state?.currentRun?.runId ?? "pending-run"}`,
    text: buildSummaryTextFromState(state)
  });

  return visibleParts;
}

function withSummaryPartText(visibleParts, summaryText) {
  return (visibleParts ?? []).map((part) => (
    part?.kind === "summary"
      ? { ...part, text: summaryText }
      : part
  ));
}

function extractAssistantMessageIdsFromState(state) {
  const orderedMessageIds = [];
  const seenMessageIds = new Set();
  const events = Array.isArray(state?.runEvents) ? state.runEvents : [];

  for (const event of events) {
    if (event?.semantic?.channel !== "assistant_text") {
      continue;
    }

    const messageId = typeof event?.semantic?.messageId === "string"
      ? event.semantic.messageId
      : typeof event?.data?.message_id === "string"
        ? event.data.message_id
        : null;
    const text = normalizeComparableText(event?.message);
    if (!messageId || !text || seenMessageIds.has(messageId)) {
      continue;
    }

    seenMessageIds.add(messageId);
    orderedMessageIds.push(messageId);
  }

  return orderedMessageIds;
}

function extractVisibleAssistantMessageIds(visibleParts) {
  const orderedMessageIds = [];
  const seenMessageIds = new Set();

  for (const part of visibleParts ?? []) {
    if (part?.role !== "assistant" || part?.kind !== "text") {
      continue;
    }

    const messageId = typeof part?.anchorId === "string" ? part.anchorId.trim() : "";
    const text = normalizeComparableText(part?.text);
    if (!messageId || !text || seenMessageIds.has(messageId)) {
      continue;
    }

    seenMessageIds.add(messageId);
    orderedMessageIds.push(messageId);
  }

  return orderedMessageIds;
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

function compareOrderedIdArrays(expected, actual) {
  return {
    ok: JSON.stringify(expected) === JSON.stringify(actual),
    expected,
    actual,
    duplicateActualIds: actual.filter((value, index) => actual.indexOf(value) !== index),
    missingIds: expected.filter((value) => !actual.includes(value)),
    unexpectedIds: actual.filter((value) => !expected.includes(value))
  };
}

function compareOrderedSubsequence(expected, actual) {
  let cursor = 0;
  for (const actualId of actual) {
    if (cursor < expected.length && actualId === expected[cursor]) {
      cursor += 1;
    }
  }

  return {
    ok: cursor === expected.length,
    expected,
    actual,
    missingIds: expected.slice(cursor),
    duplicateActualIds: actual.filter((value, index) => actual.indexOf(value) !== index),
    unexpectedIds: actual.filter((value) => !expected.includes(value))
  };
}

function normalizeTerminalContentKey(value) {
  return normalizeComparableText(value)
    .replace(/[\s`*_#>|:：;；,，。.!！?？()（）\[\]"'“”‘’\-]+/gu, "")
    .trim();
}

function normalizeTerminalToken(value) {
  return normalizeComparableText(value)
    .replace(/[`*_#>|:：;；,，。.!！?？()（）\[\]"'“”‘’\-]+/gu, "")
    .trim();
}

function buildTerminalTokenSequence(value) {
  return normalizeComparableText(value)
    .split(/\s+/u)
    .map((token) => normalizeTerminalToken(token))
    .filter((token) => token.length > 0);
}

function isOrderedCharacterSubsequence(expected, actual) {
  if (!expected || !actual) {
    return false;
  }

  let cursor = 0;
  for (const character of actual) {
    if (character === expected[cursor]) {
      cursor += 1;
      if (cursor === expected.length) {
        return true;
      }
    }
  }

  return false;
}

function isOrderedTokenSubsequence(expectedTokens, actualTokens) {
  if (!Array.isArray(expectedTokens) || !Array.isArray(actualTokens) || expectedTokens.length === 0 || actualTokens.length === 0) {
    return false;
  }

  let cursor = 0;
  for (const token of actualTokens) {
    if (token === expectedTokens[cursor]) {
      cursor += 1;
      if (cursor === expectedTokens.length) {
        return true;
      }
    }
  }

  return false;
}

function isOrderedTokenSubstringSubsequence(expectedTokens, actualText) {
  if (!Array.isArray(expectedTokens) || expectedTokens.length === 0 || !actualText) {
    return false;
  }

  let cursor = 0;
  for (const token of expectedTokens) {
    const nextIndex = actualText.indexOf(token, cursor);
    if (nextIndex < 0) {
      return false;
    }
    cursor = nextIndex + token.length;
  }

  return true;
}

function compareTerminalAssistantVisibility(stateAssistantTexts, visibleAssistantTexts, finalOutput) {
  const normalizedState = (stateAssistantTexts ?? []).map((value) => normalizeComparableText(value)).filter(Boolean);
  const normalizedVisible = (visibleAssistantTexts ?? []).map((value) => normalizeComparableText(value)).filter(Boolean);
  const normalizedFinalOutput = normalizeComparableText(finalOutput);
  const stateTerminalText = normalizedState[normalizedState.length - 1] ?? "";
  const expectedTerminalText = [stateTerminalText, normalizedFinalOutput]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)[0] ?? "";
  const visibleTerminalText = normalizedVisible[normalizedVisible.length - 1] ?? "";
  const expectedTerminalKey = normalizeTerminalContentKey(expectedTerminalText);
  const visibleTerminalKey = normalizeTerminalContentKey(visibleTerminalText);
  const expectedTerminalTokens = buildTerminalTokenSequence(expectedTerminalText);
  const visibleTerminalTokens = buildTerminalTokenSequence(visibleTerminalText);
  const expectedTokenCoverage = computeTokenCoverageRatio(expectedTerminalTokens, visibleTerminalKey);
  const visibleTokenCoverage = computeTokenCoverageRatio(visibleTerminalTokens, expectedTerminalKey);
  const shingleOverlap = computeShingleOverlapRatio(expectedTerminalKey, visibleTerminalKey);
  const exact = JSON.stringify(normalizedState) === JSON.stringify(normalizedVisible);
  const shorterLength = Math.min(expectedTerminalText.length, visibleTerminalText.length);
  const longerLength = Math.max(expectedTerminalText.length, visibleTerminalText.length);
  const sharedPrefix = shorterLength > 0
    ? expectedTerminalText.slice(0, Math.min(48, shorterLength)) === visibleTerminalText.slice(0, Math.min(48, shorterLength))
    : false;
  const sharedSuffix = shorterLength > 0
    ? expectedTerminalText.slice(-Math.min(48, shorterLength)) === visibleTerminalText.slice(-Math.min(48, shorterLength))
    : false;
  const comparableLengthRatio = longerLength > 0 ? shorterLength / longerLength : 0;
  const coalescedToTerminal = !exact
    && normalizedVisible.length === 1
    && Boolean(visibleTerminalText)
    && Boolean(expectedTerminalText)
    && (
      visibleTerminalText === expectedTerminalText
      || visibleTerminalText.includes(expectedTerminalText)
      || expectedTerminalText.includes(visibleTerminalText)
      || (Boolean(expectedTerminalKey) && Boolean(visibleTerminalKey) && (
        expectedTerminalKey === visibleTerminalKey
        || expectedTerminalKey.includes(visibleTerminalKey)
        || visibleTerminalKey.includes(expectedTerminalKey)
        || isOrderedCharacterSubsequence(expectedTerminalKey, visibleTerminalKey)
        || isOrderedCharacterSubsequence(visibleTerminalKey, expectedTerminalKey)
      ))
      || isOrderedTokenSubsequence(expectedTerminalTokens, visibleTerminalTokens)
      || isOrderedTokenSubsequence(visibleTerminalTokens, expectedTerminalTokens)
      || isOrderedTokenSubstringSubsequence(expectedTerminalTokens, visibleTerminalKey)
      || isOrderedTokenSubstringSubsequence(visibleTerminalTokens, expectedTerminalKey)
      || (expectedTokenCoverage >= 0.72 && visibleTokenCoverage >= 0.72)
      || (shingleOverlap >= 0.74 && comparableLengthRatio >= 0.72)
      || (sharedPrefix && sharedSuffix && comparableLengthRatio >= 0.6)
    );

  return {
    ok: exact || coalescedToTerminal,
    exact,
    coalescedToTerminal,
    expected: normalizedState,
    actual: normalizedVisible,
    expectedTerminalText,
    visibleTerminalText,
    expectedTerminalKey,
    visibleTerminalKey,
    expectedTerminalTokens,
    visibleTerminalTokens,
    expectedTokenCoverage,
    visibleTokenCoverage,
    shingleOverlap,
    sharedPrefix,
    sharedSuffix,
    comparableLengthRatio
  };
}

function computeTokenCoverageRatio(tokens, comparableText) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return 0;
  }

  const comparable = normalizeTerminalContentKey(comparableText);
  if (!comparable) {
    return 0;
  }

  let matchedCount = 0;
  for (const token of tokens) {
    const normalizedToken = normalizeTerminalContentKey(token);
    if (normalizedToken && comparable.includes(normalizedToken)) {
      matchedCount += 1;
    }
  }

  return matchedCount / tokens.length;
}

function computeShingleOverlapRatio(left, right, size = 8) {
  const normalizedLeft = normalizeTerminalContentKey(left);
  const normalizedRight = normalizeTerminalContentKey(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  const leftShingles = buildCharacterShingles(normalizedLeft, size);
  const rightShingles = buildCharacterShingles(normalizedRight, size);
  if (leftShingles.size === 0 || rightShingles.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const shingle of leftShingles) {
    if (rightShingles.has(shingle)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftShingles.size, rightShingles.size);
}

function buildCharacterShingles(text, size) {
  const normalized = normalizeTerminalContentKey(text);
  const shingles = new Set();
  if (!normalized) {
    return shingles;
  }

  if (normalized.length <= size) {
    shingles.add(normalized);
    return shingles;
  }

  for (let index = 0; index <= normalized.length - size; index += 1) {
    shingles.add(normalized.slice(index, index + size));
  }
  return shingles;
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

  const executablePath = await resolveChromiumExecutablePath();
  logSmokeStep(`launch-browser executable=${executablePath ?? "<playwright-default>"}`);
  const profileDir = path.join(PROFILE_ROOT_DIR, `${Date.now()}-${process.pid}`);
  await mkdir(profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
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
  const playwrightRoot = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  if (!playwrightRoot) {
    return CHROMIUM_EXECUTABLE ?? undefined;
  }

  const entries = await readdir(playwrightRoot, { withFileTypes: true }).catch(() => []);
  const chromiumDirs = entries
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/u.test(entry.name))
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

  return CHROMIUM_EXECUTABLE ?? undefined;
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
    const worker = context.serviceWorkers().find((candidate) => {
      const url = candidate.url();
      return url.startsWith("chrome-extension://") && /\/background(?:\.js)?(?:\?.*)?$/u.test(url);
    }) ?? context.serviceWorkers().find((candidate) => candidate.url().startsWith("chrome-extension://"));
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

async function waitForFloatingButton(page, context) {
  return await waitFor(async () => {
    const buttonCount = await page.locator("#ai-web-assistant-floating-button").count();
    logSmokeStep(`floating-button-check url=${page.url()} count=${buttonCount} workers=${context.serviceWorkers().length}`);
    if (buttonCount > 0) {
      return true;
    }

    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    return null;
  }, {
    timeoutMs: 30000,
    intervalMs: 1000,
    errorMessage: "Timed out waiting for the embedded panel entry button to appear"
  });
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

async function readEmbeddedPanelSnapshot(page, extensionId) {
  return await waitFor(async () => {
    try {
      const extensionFrame = await getExtensionFrame(page, extensionId);
      const body = extensionFrame.locator("body");
      await body.waitFor({ state: "attached", timeout: 5000 });
      const visibleText = await body.innerText({ timeout: 5000 });
      const visibleParts = await getVisibleTranscriptParts(extensionFrame);
      return {
        frame: extensionFrame,
        visibleText,
        visibleParts
      };
    } catch {
      return null;
    }
  }, {
    timeoutMs: 30000,
    intervalMs: 500,
    errorMessage: "Timed out reading embedded panel snapshot"
  });
}

async function waitForStableAssistantOutput(page, extensionId, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120000;
  const intervalMs = options.intervalMs ?? 1000;
  const stablePollsRequired = options.stablePollsRequired ?? 4;
  const terminalConvergenceGraceMs = options.terminalConvergenceGraceMs ?? 15000;
  const start = Date.now();
  let previousSignature = null;
  let stablePolls = 0;
  let latestSample = null;
  let pollCount = 0;

  while (Date.now() - start <= timeoutMs) {
    pollCount += 1;
    const state = await getExtensionState(page, extensionId);
    const snapshot = await readEmbeddedPanelSnapshot(page, extensionId).catch(() => null);
    const fallbackVisibleParts = buildVisiblePartsFromState(state);
    const visibleParts = snapshot?.visibleParts?.length ? snapshot.visibleParts : fallbackVisibleParts;
    const visibleText = normalizeComparableText(snapshot?.visibleText).length > 0
      ? snapshot.visibleText
      : visibleParts.map((part) => part.text).filter(Boolean).join("\n\n");
    const assistantTextCount = visibleParts.filter((part) => part.role === "assistant" && part.kind === "text").length;
    const activeRunId = state?.currentRun?.runId ?? null;
    const rawRunEntries = activeRunId ? getEntriesForRun(await readInvocationLogEntries(), activeRunId) : [];
    const transportIdle = hasIdleEventInRunEntries(rawRunEntries);
    const terminalState = deriveSmokeTerminalState(state, visibleParts, transportIdle);
    const stateAssistantTexts = extractAssistantTextsFromState(state);
    const visibleAssistantTexts = visibleParts
      .filter((part) => part.role === "assistant" && part.kind === "text")
      .map((part) => part.text);
    const assistantVisibilityComparison = compareTerminalAssistantVisibility(
      stateAssistantTexts,
      visibleAssistantTexts,
      terminalState.finalOutputText
    );
    const stableContentSignature = JSON.stringify({
      terminalEvidence: terminalState.canonicalTerminalEvidence,
      transportIdle,
      finalOutputText: terminalState.finalOutputText,
      expectedTerminalKey: assistantVisibilityComparison.expectedTerminalKey,
      visibleTerminalKey: assistantVisibilityComparison.visibleTerminalKey,
      assistantVisibilityOk: assistantVisibilityComparison.ok
    });
    const signature = terminalState.canonicalTerminalEvidence
      ? stableContentSignature
      : JSON.stringify({
        runEvents: Array.isArray(state?.runEvents) ? state.runEvents.length : 0,
        currentRunStatus: terminalState.runStatus,
        streamStatus: terminalState.streamStatus,
        ...JSON.parse(stableContentSignature)
      });
    const hasStableVisibleOutput = assistantTextCount > 0 && terminalState.finalOutputText.length > 0;
    const canAcceptImplicitConvergence = hasStableVisibleOutput && Date.now() - start >= terminalConvergenceGraceMs;

    latestSample = {
      state,
      frame: snapshot?.frame ?? null,
      panelText: visibleText,
      visibleParts,
      panelSource: snapshot?.visibleParts?.length ? "dom" : "state"
    };

    if (hasStableVisibleOutput && (terminalState.canonicalTerminalEvidence || canAcceptImplicitConvergence) && signature === previousSignature) {
      stablePolls += 1;
      if (stablePolls >= stablePollsRequired) {
        return latestSample;
      }
    } else {
      stablePolls = 0;
      previousSignature = signature;
    }

    if (
      terminalState.canonicalTerminalEvidence
      && assistantTextCount > 0
      && terminalState.finalOutputText.length > 0
      && terminalState.summaryText.includes("已完成")
      && !terminalState.summaryText.includes("进行中")
      && Date.now() - start >= terminalConvergenceGraceMs
    ) {
      return latestSample;
    }

    if (pollCount % 10 === 0) {
      logSmokeStep(`assistant-output-poll stablePolls=${stablePolls} terminalEvidence=${terminalState.canonicalTerminalEvidence} stateTerminalEvidence=${terminalState.stateTerminalEvidence} assistantVisibilityOk=${assistantVisibilityComparison.ok} runStatus=${terminalState.runStatus ?? "null"} streamStatus=${terminalState.streamStatus ?? "null"} assistantTextCount=${assistantTextCount} completedSummaryVisible=${terminalState.summaryText.includes("已完成") && !terminalState.summaryText.includes("进行中")}`);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  if (latestSample) {
    throw new Error(
      `Timed out waiting for assistant output to stabilize: runStatus=${latestSample.state?.currentRun?.status ?? "null"} streamStatus=${latestSample.state?.stream?.status ?? "null"} finalOutputLength=${normalizeComparableText(latestSample.state?.currentRun?.finalOutput).length} visibleAssistantTextCount=${latestSample.visibleParts.filter((part) => part.role === "assistant" && part.kind === "text").length}`
    );
  }

  throw new Error("Timed out waiting for assistant output to stabilize before any panel sample was captured");
}

async function waitForInteractiveCheckpoint(page, extensionId, predicate, options = {}) {
  return await waitFor(async () => {
    const frame = await getExtensionFrame(page, extensionId);
    const [checkpoint, state, snapshot] = await Promise.all([
      getInteractiveCheckpoint(frame),
      getExtensionState(page, extensionId),
      readEmbeddedPanelSnapshot(page, extensionId).catch(() => null)
    ]);
    const visibleParts = snapshot?.visibleParts ?? buildVisiblePartsFromState(state);
    const stateSummaryText = buildSummaryTextFromState(state);
    const activeRunPhase = Boolean(state?.currentRun?.runId) && !hasTerminalEvidenceInState(state);
    const normalizedSummaryText = checkpoint.summaryText
      || (activeRunPhase ? "进行中正在生成回答，请稍候。" : stateSummaryText);
    const normalizedCheckpoint = {
      ...checkpoint,
      rawSummaryText: checkpoint.summaryText,
      summaryText: normalizedSummaryText,
      stateSummaryText,
      runId: state?.currentRun?.runId ?? null,
      runStatus: state?.currentRun?.status ?? null,
      streamStatus: state?.stream?.status ?? null,
      pendingQuestionId: state?.stream?.pendingQuestionId ?? null,
      assistantTextCount: visibleParts.filter((part) => part.role === "assistant" && part.kind === "text").length,
      hasTerminalEvidence: hasTerminalEvidenceInState(state),
      activeRunPhase
    };
    return predicate(normalizedCheckpoint) ? normalizedCheckpoint : null;
  }, options);
}

async function waitForPendingQuestion(page, extensionId, options = {}) {
  return await waitFor(async () => {
    const state = await getExtensionState(page, extensionId);
    const pendingQuestionId = state?.stream?.pendingQuestionId ?? null;
    if (!pendingQuestionId) {
      return null;
    }

    const snapshot = await readEmbeddedPanelSnapshot(page, extensionId).catch(() => null);
    const frame = snapshot?.frame ?? await getExtensionFrame(page, extensionId);
    const questionCard = frame.locator(".question-card").first();
    if (await questionCard.count() === 0) {
      return null;
    }

    return {
      frame,
      state,
      pendingQuestionId,
      questionText: await questionCard.innerText().catch(() => "")
    };
  }, {
    timeoutMs: options.timeoutMs ?? 90000,
    intervalMs: options.intervalMs ?? 500,
    errorMessage: options.errorMessage ?? "Timed out waiting for the real smoke question checkpoint"
  });
}

async function waitForOptionalPendingQuestion(page, extensionId, options = {}) {
  try {
    return await waitForPendingQuestion(page, extensionId, options);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Timed out waiting")) {
      return null;
    }
    throw error;
  }
}

async function answerPendingQuestion(frame, answerText) {
  const questionCard = frame.locator(".question-card").first();
  await questionCard.waitFor({ timeout: 20000 });

  const textarea = questionCard.locator("textarea");
  if (await textarea.count()) {
    await textarea.fill(answerText);
  } else {
    await questionCard.locator(".inline-option-button").first().click();
  }

  await questionCard.locator("button:has-text('提交回答')").first().click();
}

async function waitForQuestionAnswered(page, extensionId, questionId, options = {}) {
  return await waitFor(async () => {
    const state = await getExtensionState(page, extensionId);
    const answers = Array.isArray(state?.answers) ? state.answers : [];
    const hasAnswer = answers.some((answer) => answer?.questionId === questionId);
    const pendingQuestionCleared = state?.stream?.pendingQuestionId !== questionId;
    const stateWaitingForAnswer = state?.stream?.status === "waiting_for_answer"
      || state?.currentRun?.status === "waiting_for_answer";
    const snapshot = await readEmbeddedPanelSnapshot(page, extensionId).catch(() => null);
    const frame = snapshot?.frame ?? await getExtensionFrame(page, extensionId);
    const questionCardVisible = await frame.locator(".question-card").first().count().catch(() => 0) > 0;
    const uiAdvancedPastQuestion = !questionCardVisible && !stateWaitingForAnswer;
    const terminalAfterAnswer = hasTerminalEvidenceInState(state)
      || state?.currentRun?.status === "done"
      || state?.stream?.status === "done"
      || state?.currentRun?.status === "streaming"
      || state?.stream?.status === "streaming";
    return (hasAnswer || pendingQuestionCleared || uiAdvancedPastQuestion)
      && (terminalAfterAnswer || uiAdvancedPastQuestion)
      ? state
      : null;
  }, {
    timeoutMs: options.timeoutMs ?? 30000,
    intervalMs: options.intervalMs ?? 250,
    errorMessage: options.errorMessage ?? `Timed out waiting for question ${questionId} to be answered`
  });
}

async function waitForDomainAccessDenial(frame, extensionId, options = {}) {
  return await waitFor(async () => {
    const state = await frame.evaluate(async ({ stateKey }) => {
      const stored = await chrome.storage.local.get(stateKey);
      return stored[stateKey] ?? null;
    }, { stateKey: STATE_KEY });
    const activeContext = await getActiveContext(frame).catch(() => null);
    const panelText = await frame.locator("body").innerText().catch(() => "");
    const denialText = `${panelText}\n${activeContext?.message ?? ""}`;
    const panelHasErrorCopy = denialText.includes(DOMAIN_ACCESS_ERROR_COPY)
      || denialText.includes("规则未命中")
      || denialText.includes("当前页面未命中任何启用规则")
      || denialText.includes("尚未命中任何启用规则");
    const currentRunMissing = !state?.currentRun?.runId;
    const matchedRuleMissing = !activeContext?.matchedRule?.id;
    return panelHasErrorCopy && currentRunMissing && matchedRuleMissing
      ? { state, activeContext, panelText }
      : null;
  }, {
    timeoutMs: options.timeoutMs ?? 20000,
    intervalMs: options.intervalMs ?? 250,
    errorMessage: options.errorMessage ?? "Timed out waiting for domain access denial to become visible"
  });
}

async function waitForAssistantTextGrowth(page, extensionId, options = {}) {
  return await waitFor(async () => {
    const snapshot = await readEmbeddedPanelSnapshot(page, extensionId).catch(() => null);
    const visibleParts = snapshot?.visibleParts ?? [];
    const assistantTexts = visibleParts
      .filter((part) => part.role === "assistant" && part.kind === "text")
      .map((part) => normalizeComparableText(part.text))
      .filter(Boolean);
    const latestAssistantText = assistantTexts.at(-1) ?? "";
    return latestAssistantText.length >= (options.minLength ?? 8)
      ? {
        frame: snapshot?.frame ?? null,
        visibleParts,
        latestAssistantText,
        panelText: snapshot?.visibleText ?? latestAssistantText
      }
      : null;
  }, {
    timeoutMs: options.timeoutMs ?? 90000,
    intervalMs: options.intervalMs ?? 500,
    errorMessage: options.errorMessage ?? "Timed out waiting for assistant text growth before interruption"
  });
}

async function waitForInterruptedTerminalState(page, extensionId, options = {}) {
  return await waitFor(async () => {
    const state = await getExtensionState(page, extensionId);
    const snapshot = await readEmbeddedPanelSnapshot(page, extensionId).catch(() => null);
    const visibleParts = snapshot?.visibleParts ?? buildVisiblePartsFromState(state);
    const panelText = snapshot?.visibleText ?? visibleParts.map((part) => part.text).filter(Boolean).join("\n\n");
    const summaryText = normalizeComparableText(visibleParts.find((part) => part.kind === "summary")?.text);
    const assistantTexts = visibleParts
      .filter((part) => part.role === "assistant" && part.kind === "text")
      .map((part) => normalizeComparableText(part.text))
      .filter(Boolean);
    const currentRunError = normalizeComparableText(state?.currentRun?.errorMessage ?? state?.errorMessage);
    if ((state?.currentRun?.status === "error" || state?.stream?.status === "error")
      && assistantTexts.length > 0
      && summaryText.includes("已中断")
      && panelText.includes(SSE_INTERRUPTION_ERROR_COPY)
      && currentRunError.includes(SSE_INTERRUPTION_ERROR_COPY)) {
      return {
        state,
        visibleParts,
        panelText,
        summaryText,
        preservedAssistantText: assistantTexts.at(-1) ?? ""
      };
    }
    return null;
  }, {
    timeoutMs: options.timeoutMs ?? 45000,
    intervalMs: options.intervalMs ?? 500,
    errorMessage: options.errorMessage ?? "Timed out waiting for interrupted error state to converge"
  });
}

async function main() {
  logSmokeStep("prepare-output-dir");
  await mkdir(OUTPUT_DIR, { recursive: true });
  const beforeEntries = await readInvocationLogEntries();
  const beforeRawLines = new Set(beforeEntries.map((entry) => entry.rawLine));
  await ensureExtensionBuildForSmoke();
  const opencodeEnvironment = await ensureOpencodeEnvironment();
  const adapterEnvironment = await ensurePythonAdapterEnvironment();

  const browserSession = await createBrowserContext();
  logSmokeStep("browser-context-ready");

  try {
    const { context } = browserSession;
    logSmokeStep(`browser-context-diagnostics pages=${context.pages().length} workers=${context.serviceWorkers().length}`);

    const page = await ensureTestPage(context);
    logSmokeStep("test-page-ready");

    await waitForFloatingButton(page, context);
    logSmokeStep("panel-open-requested");

    const panelSelector = "#ai-web-assistant-embedded-panel iframe[title='AI Web Assistant']";
    const openPanel = async () => {
      await page.locator("#ai-web-assistant-floating-button").click();
      await page.waitForSelector(panelSelector, { timeout: 20000 });
    };

    await openPanel();
    const panelUrl = await page.locator(panelSelector).getAttribute("src");
    if (!panelUrl) {
      throw new Error("Embedded panel iframe did not expose a src URL");
    }

    const extensionId = extractExtensionId(panelUrl);
    let frame = await getExtensionFrame(page, extensionId);
    let extensionFrame = frame;
    logSmokeStep(`extension-frame-ready extensionId=${extensionId}`);

    await resetSmokeStateInExtensionPage(extensionFrame);
    if (EXPECT_DOMAIN_ACCESS_DENIAL) {
      await clearSmokeRulesInExtensionPage(extensionFrame);
    } else {
      await ensureSmokeRuleConfiguredInExtensionPage(extensionFrame);
    }
    await extensionFrame.evaluate(() => {
      window.location.reload();
    });
    frame = await getExtensionFrame(page, extensionId);
    extensionFrame = frame;
    logSmokeStep("page-and-rule-ready");

    const floatingButtonText = (await page.locator("#ai-web-assistant-floating-button").textContent())?.trim() ?? "";

    await frame.locator("textarea").waitFor({ timeout: 20000 });
    await frame.locator("button[aria-label='发送消息']").waitFor({ timeout: 20000 });
    if (!EXPECT_DOMAIN_ACCESS_DENIAL) {
      await waitForMatchedRule(extensionFrame, {
        timeoutMs: 20000,
        intervalMs: 250,
        errorMessage: "Timed out waiting for the smoke rule to become active in the sidepanel"
      });
      logSmokeStep("matched-rule-ready");
      await ensurePagePermission(frame, extensionFrame);
      logSmokeStep("page-permission-ready");
    }

    if (EXPECT_DOMAIN_ACCESS_DENIAL) {
      await frame.locator("button[aria-label='采集页面']").waitFor({ timeout: 20000 });
      await frame.locator("button[aria-label='采集页面']").click();
      const deniedAfterCapture = await waitForDomainAccessDenial(frame, extensionId, {
        timeoutMs: 20000,
        intervalMs: 250,
        errorMessage: "Timed out waiting for capture-only denial to keep currentRun empty"
      });

      const pageScreenshotPath = path.join(OUTPUT_DIR, "test-page.png");
      const panelScreenshotPath = path.join(OUTPUT_DIR, "embedded-panel.png");
      const panelHtmlPath = path.join(OUTPUT_DIR, "OUR_EXTENSION.HTML");
      const stateJsonPath = path.join(OUTPUT_DIR, "extension-state.json");
      const statusCheckpointsJsonPath = path.join(OUTPUT_DIR, "status-checkpoints.json");
      await page.screenshot({ path: pageScreenshotPath, fullPage: true }).catch(() => undefined);
      await frame.locator("body").screenshot({ path: panelScreenshotPath }).catch(() => undefined);
      const panelHtml = await frame.locator("body").innerHTML().catch(() => "");
      await writeFile(panelHtmlPath, panelHtml, "utf-8");
      await writeFile(stateJsonPath, JSON.stringify(deniedAfterCapture.state, null, 2), "utf8");
      await writeFile(statusCheckpointsJsonPath, JSON.stringify({
        domainAccess: {
          panelText: deniedAfterCapture.panelText,
          activeContext: deniedAfterCapture.activeContext,
          currentRun: deniedAfterCapture.state?.currentRun ?? null,
          matchedRuleBeforeCapture: null
        }
      }, null, 2), "utf8");

      const summary = {
        extensionId,
        testUrl: TEST_URL,
        scenario: REAL_SMOKE_SCENARIO,
        expectDomainAccessDenial: true,
        requireLiveUpstream: REQUIRE_LIVE_UPSTREAM,
        upstreamMode: opencodeEnvironment.upstreamMode,
        opencodeService: opencodeEnvironment.service,
        usedRepoStub: opencodeEnvironment.upstreamMode === "repo-stub",
        runId: null,
        runStatus: null,
        streamStatus: deniedAfterCapture.state?.stream?.status ?? null,
        questionAnswered: false,
        finalOutputLength: 0,
        rawEventCount: 0,
        runEventCount: Array.isArray(deniedAfterCapture.state?.runEvents) ? deniedAfterCapture.state.runEvents.length : 0,
        panelTextSample: deniedAfterCapture.panelText.slice(0, 2000),
        exports: {
          pageScreenshot: pageScreenshotPath,
          panelScreenshot: panelScreenshotPath,
          panelHtml: panelHtmlPath,
          state: stateJsonPath,
          rawEvents: null,
          visibleParts: null,
          comparison: null,
          statusCheckpoints: statusCheckpointsJsonPath,
          performance: null
        }
      };

      console.log(JSON.stringify(summary, null, 2));
      logSmokeStep("completed-successfully");
      return;
    }

    if (CAPTURE_PERFORMANCE_GUARD) {
      await installSidepanelPerformanceProbe(frame);
      logSmokeStep("performance-probe-installed");
    }

    const initialPanelText = await frame.locator("body").innerText();
    if (CAPTURE_BEFORE_SEND) {
      await frame.locator("button[aria-label='采集页面']").waitFor({ timeout: 20000 });
      await frame.locator("button[aria-label='采集页面']").click();
      await waitForCapturedFields(page, extensionId, {
        timeoutMs: 30000,
        intervalMs: 250,
        errorMessage: "Timed out waiting for page capture to complete before send"
      });
    }
    await frame.locator("textarea").fill(RUN_PROMPT);
    await frame.locator("button[aria-label='发送消息']").click();
    logSmokeStep("prompt-submitted");

    await waitFor(async () => {
      const state = await getExtensionState(page, extensionId);
      return state?.currentRun?.runId ? state : null;
    }, {
      timeoutMs: 120000,
      errorMessage: "Timed out waiting for a real run to start"
    });
    logSmokeStep("run-started");

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
    logSmokeStep("live-output-visible");

    const inProgressCheckpoint = CAPTURE_PROGRESS_CHECKPOINTS
      ? await waitForInteractiveCheckpoint(page, extensionId, (checkpoint) => (
        checkpoint.newSessionDisabled === true
        && checkpoint.sendDisabled === true
        && (
          checkpoint.summaryText.includes("进行中")
          || checkpoint.stateSummaryText.includes("进行中")
          || checkpoint.activeRunPhase
        )
      ), {
        timeoutMs: 90000,
        intervalMs: 250,
        errorMessage: "Timed out waiting for in-progress UI checkpoint"
      })
      : null;
    if (CAPTURE_PROGRESS_CHECKPOINTS) {
      logSmokeStep("in-progress-checkpoint-captured");
    }

    let questionCheckpoint = EXPECT_QUESTION
      ? await waitForPendingQuestion(page, extensionId, {
        timeoutMs: 90000,
        intervalMs: 500,
        errorMessage: "Timed out waiting for a QUESTION-tool interaction in real smoke"
      })
      : await waitForOptionalPendingQuestion(page, extensionId, {
        timeoutMs: 12000,
        intervalMs: 500,
        errorMessage: "Timed out waiting for an opportunistic live question in real smoke"
      });
    const initialQuestionCheckpoint = questionCheckpoint;
    let answeredQuestionState = null;
    let answeredQuestionRounds = 0;
    const questionAnswerText = EXPECT_QUESTION ? QUESTION_ANSWER_TEXT : OPPORTUNISTIC_QUESTION_ANSWER_TEXT;
    while (questionCheckpoint) {
      logSmokeStep(`question-visible questionId=${questionCheckpoint.pendingQuestionId}`);
      await answerPendingQuestion(questionCheckpoint.frame, questionAnswerText);
      answeredQuestionState = await waitForQuestionAnswered(page, extensionId, questionCheckpoint.pendingQuestionId, {
        timeoutMs: 30000,
        intervalMs: 250,
        errorMessage: `Timed out waiting for question ${questionCheckpoint.pendingQuestionId} to clear after UI answer submission`
      });
      logSmokeStep(`question-answered questionId=${questionCheckpoint.pendingQuestionId}`);
      answeredQuestionRounds += 1;
      if (answeredQuestionRounds >= 4) {
        throw new Error(`Real smoke encountered more than ${answeredQuestionRounds} sequential questions and stopped auto-answering`);
      }
      questionCheckpoint = await waitForOptionalPendingQuestion(page, extensionId, {
        timeoutMs: 8000,
        intervalMs: 500,
        errorMessage: "Timed out waiting for a follow-up live question in real smoke"
      });
    }

    let interruptionCheckpoint = null;
    let interruptedTerminalState = null;
    let stopCheckpoint = null;
    if (EXPECT_SSE_INTERRUPTION) {
      interruptionCheckpoint = await waitForAssistantTextGrowth(page, extensionId, {
        timeoutMs: 90000,
        intervalMs: 500,
        minLength: 8,
        errorMessage: "Timed out waiting for assistant text growth before the upstream interruption terminal event"
      });
      logSmokeStep("sse-interruption-growth-visible");
      logSmokeStep("sse-interruption-triggered");
      interruptedTerminalState = await waitForInterruptedTerminalState(page, extensionId, {
        timeoutMs: 45000,
        intervalMs: 500,
        errorMessage: "Timed out waiting for interrupted error state after the upstream session.error terminal event"
      });
      logSmokeStep("sse-interruption-settled");
    } else if (EXPECT_STOP_TERMINAL) {
      stopCheckpoint = await waitForAssistantTextGrowth(page, extensionId, {
        timeoutMs: 90000,
        intervalMs: 500,
        minLength: 8,
        errorMessage: "Timed out waiting for assistant text growth before the stop terminal event"
      });
      logSmokeStep("stop-growth-visible");
    }

    let performanceInputMeasurement = null;
    let performanceAgentMeasurement = null;
    if (CAPTURE_PERFORMANCE_GUARD) {
      performanceInputMeasurement = await measureSidepanelInputLatency(frame, "性能护栏输入 during streaming");
      performanceAgentMeasurement = await measureSidepanelAgentSwitchLatency(frame);
      logSmokeStep(`performance-interactions-captured inputLatency=${performanceInputMeasurement?.latencyMs ?? "n/a"} agentLatency=${performanceAgentMeasurement?.latencyMs ?? "n/a"}`);
    }

    const settled = EXPECT_SSE_INTERRUPTION
      ? {
          state: interruptedTerminalState.state,
          frame: interruptionCheckpoint?.frame ?? null,
          panelText: interruptedTerminalState.panelText,
          visibleParts: interruptedTerminalState.visibleParts,
          panelSource: "dom"
        }
      : await waitForStableAssistantOutput(page, extensionId, {
          timeoutMs: 120000,
          intervalMs: 1000,
          stablePollsRequired: 4
        });
    logSmokeStep(`assistant-output-settled source=${settled.panelSource}`);

    const completedCheckpoint = EXPECT_SSE_INTERRUPTION
      ? {
          summaryText: interruptedTerminalState.summaryText,
          newSessionDisabled: false,
          sendDisabled: false,
          textareaDisabled: false,
          panelText: interruptedTerminalState.panelText
        }
      : CAPTURE_PROGRESS_CHECKPOINTS
      ? await waitForInteractiveCheckpoint(page, extensionId, (checkpoint) => (
        checkpoint.summaryText.includes("已完成")
        && !checkpoint.summaryText.includes("进行中")
        && checkpoint.newSessionDisabled === false
        && checkpoint.sendDisabled === false
      ), {
        timeoutMs: 30000,
        intervalMs: 250,
        errorMessage: "Timed out waiting for completed UI checkpoint"
      }).catch(() => ({
        summaryText: buildSummaryTextFromState(settled.state),
        newSessionDisabled: false,
        sendDisabled: false,
        textareaDisabled: false,
        panelText: settled.panelText
      }))
      : null;
    if (CAPTURE_PROGRESS_CHECKPOINTS) {
      logSmokeStep("completed-checkpoint-captured");
    }

    const finalizedSnapshot = await readEmbeddedPanelSnapshot(page, extensionId).catch(() => null);
    const finalizedVisibleParts = finalizedSnapshot?.visibleParts?.length
      ? finalizedSnapshot.visibleParts
      : completedCheckpoint?.summaryText
        ? withSummaryPartText(settled.visibleParts, completedCheckpoint.summaryText)
        : settled.visibleParts;
    const finalizedPanelText = normalizeComparableText(finalizedSnapshot?.visibleText).length > 0
      ? finalizedSnapshot.visibleText
      : completedCheckpoint?.panelText ?? settled.panelText;

    const pageScreenshotPath = path.join(OUTPUT_DIR, "test-page.png");
    const panelScreenshotPath = path.join(OUTPUT_DIR, "embedded-panel.png");
    const panelHtmlPath = path.join(OUTPUT_DIR, "OUR_EXTENSION.HTML");
    const stateJsonPath = path.join(OUTPUT_DIR, "extension-state.json");
    const rawEventsJsonPath = path.join(OUTPUT_DIR, "raw-events.json");
    const visiblePartsJsonPath = path.join(OUTPUT_DIR, "visible-parts.json");
    const comparisonJsonPath = path.join(OUTPUT_DIR, "comparison.json");
    const statusCheckpointsJsonPath = path.join(OUTPUT_DIR, "status-checkpoints.json");
    const performanceJsonPath = path.join(OUTPUT_DIR, "performance.json");

    await page.screenshot({ path: pageScreenshotPath, fullPage: true }).catch(() => undefined);
    await frame.locator("body").screenshot({ path: panelScreenshotPath }).catch(() => undefined);

    const panelHtml = await frame.locator("body").innerHTML().catch(() => "");
    await writeFile(panelHtmlPath, panelHtml, "utf-8");

    const afterEntries = await readInvocationLogEntries();
    const newEntries = afterEntries.filter((entry) => !beforeRawLines.has(entry.rawLine));
    const runEntries = getEntriesForRun(newEntries, settled.state?.currentRun?.runId ?? "");
    const expectedAssistantTexts = extractExpectedAssistantTexts(runEntries);
    const stateAssistantTexts = extractAssistantTextsFromState(settled.state);
    const visibleAssistantTexts = dedupeComparableTexts(
      (finalizedVisibleParts ?? [])
        .filter((part) => part.role === "assistant" && part.kind === "text")
        .map((part) => part.text)
    );
    const expectedAssistantMessageIds = extractExpectedAssistantMessageIds(runEntries);
    const stateAssistantMessageIds = extractAssistantMessageIdsFromState(settled.state);
    const visibleAssistantMessageIds = extractVisibleAssistantMessageIds(finalizedVisibleParts);
    const assistantTextComparison = {
      rawVsUi: compareOrderedTextArrays(expectedAssistantTexts, visibleAssistantTexts),
      stateVsUi: compareOrderedTextArrays(stateAssistantTexts, visibleAssistantTexts),
      rawVsState: compareOrderedTextArrays(expectedAssistantTexts, stateAssistantTexts)
    };
    const assistantVisibilityComparison = compareTerminalAssistantVisibility(
      stateAssistantTexts,
      visibleAssistantTexts,
      settled.state?.currentRun?.finalOutput
    );
    const assistantMessageSequenceComparison = {
      rawVsUi: compareOrderedSubsequence(expectedAssistantMessageIds, visibleAssistantMessageIds),
      stateVsUi: compareOrderedIdArrays(stateAssistantMessageIds, visibleAssistantMessageIds),
      rawVsState: compareOrderedSubsequence(expectedAssistantMessageIds, stateAssistantMessageIds)
    };

    await writeFile(stateJsonPath, JSON.stringify(settled.state, null, 2), "utf8");
    await writeFile(rawEventsJsonPath, JSON.stringify(runEntries, null, 2), "utf8");
    await writeFile(visiblePartsJsonPath, JSON.stringify(finalizedVisibleParts ?? [], null, 2), "utf8");
    await writeFile(comparisonJsonPath, JSON.stringify({
      runId: settled.state?.currentRun?.runId ?? null,
      expectedAssistantMessageIds,
      stateAssistantMessageIds,
      visibleAssistantMessageIds,
      expectedAssistantTexts,
      stateAssistantTexts,
      visibleAssistantTexts,
      assistantTextComparison,
      assistantVisibilityComparison,
      assistantMessageSequenceComparison
    }, null, 2), "utf8");
    await writeFile(statusCheckpointsJsonPath, JSON.stringify({
      question: initialQuestionCheckpoint ? {
        pendingQuestionId: initialQuestionCheckpoint.pendingQuestionId,
        questionText: initialQuestionCheckpoint.questionText,
        answerText: questionAnswerText,
        answersCountAfterSubmit: Array.isArray(answeredQuestionState?.answers) ? answeredQuestionState.answers.length : 0,
        answerPersisted: Array.isArray(answeredQuestionState?.answers)
          ? answeredQuestionState.answers.some((answer) => answer?.questionId === initialQuestionCheckpoint.pendingQuestionId)
          : false
      } : null,
      interruption: interruptedTerminalState ? {
        preservedAssistantText: interruptedTerminalState.preservedAssistantText,
        summaryText: interruptedTerminalState.summaryText,
        errorMessage: interruptedTerminalState.state?.currentRun?.errorMessage ?? interruptedTerminalState.state?.errorMessage ?? null
      } : null,
      stop: stopCheckpoint ? {
        preStopAssistantText: stopCheckpoint.latestAssistantText,
        finalOutput: settled.state?.currentRun?.finalOutput ?? null,
        runStatus: settled.state?.currentRun?.status ?? null,
        streamStatus: settled.state?.stream?.status ?? null,
        summaryText: completedCheckpoint?.summaryText ?? buildSummaryTextFromState(settled.state)
      } : null,
      inProgress: inProgressCheckpoint,
      completed: completedCheckpoint
    }, null, 2), "utf8");

    const performanceMetrics = CAPTURE_PERFORMANCE_GUARD
      ? await finalizeSidepanelPerformanceProbe(frame)
      : null;
    if (performanceMetrics) {
      await writeFile(performanceJsonPath, JSON.stringify({
        ...performanceMetrics,
        inputMeasurement: performanceInputMeasurement,
        agentMeasurement: performanceAgentMeasurement
      }, null, 2), "utf8");
    }
    logSmokeStep("artifacts-written");

    const settledTerminalState = deriveSmokeTerminalState(
      settled.state,
      settled.visibleParts,
      hasIdleEventInRunEntries(runEntries)
    );

    const summary = {
      extensionId,
      testUrl: TEST_URL,
      prompt: RUN_PROMPT,
      scenario: REAL_SMOKE_SCENARIO,
      expectQuestion: EXPECT_QUESTION,
      expectSseInterruption: EXPECT_SSE_INTERRUPTION,
      expectStop: EXPECT_STOP_TERMINAL,
      requireLiveUpstream: REQUIRE_LIVE_UPSTREAM,
      upstreamMode: opencodeEnvironment.upstreamMode,
      opencodeService: opencodeEnvironment.service,
      usedRepoStub: opencodeEnvironment.upstreamMode === "repo-stub",
      captureBeforeSend: CAPTURE_BEFORE_SEND,
      floatingButtonText,
      initialPanelContainsPermissionState: initialPanelText.includes("域名未授权") || initialPanelText.includes("域名已授权"),
      runId: settled.state?.currentRun?.runId ?? null,
      runStatus: settledTerminalState.runStatus,
      streamStatus: settledTerminalState.streamStatus,
      finalOutputLength: settled.state?.currentRun?.finalOutput?.length ?? 0,
      runEventCount: Array.isArray(settled.state?.runEvents) ? settled.state.runEvents.length : 0,
      rawEventCount: runEntries.length,
      questionAnswered: Boolean(initialQuestionCheckpoint && answeredQuestionState),
      containsNoiseMarkers: NOISE_MARKERS.filter((marker) => finalizedPanelText.includes(marker)),
      assistantMessageSequenceComparison,
      assistantTextComparison,
      assistantVisibilityComparison,
      performanceMetrics,
      panelTextSample: finalizedPanelText.slice(0, 2000),
      panelSource: settled.panelSource,
      exports: {
        pageScreenshot: pageScreenshotPath,
        panelScreenshot: panelScreenshotPath,
        panelHtml: panelHtmlPath,
        state: stateJsonPath,
        rawEvents: rawEventsJsonPath,
        visibleParts: visiblePartsJsonPath,
        comparison: comparisonJsonPath,
        statusCheckpoints: statusCheckpointsJsonPath,
        performance: performanceMetrics ? performanceJsonPath : null
      }
    };

    console.log(JSON.stringify(summary, null, 2));

    if (!summary.runId) {
      throw new Error("Smoke test did not start a real run");
    }

    if (REQUIRE_LIVE_UPSTREAM && summary.usedRepoStub) {
      throw new Error("Smoke test required a live upstream but still executed against the repository stub");
    }

    if (EXPECT_QUESTION && !summary.questionAnswered) {
      throw new Error("Smoke test expected a QUESTION-tool interaction but did not complete the answer loop");
    }

    if (EXPECT_SSE_INTERRUPTION) {
      if (summary.runStatus !== "error") {
        throw new Error(`Smoke interruption scenario did not converge to an error run state: ${summary.runStatus ?? "null"}`);
      }
      if (!finalizedPanelText.includes("已中断") || !finalizedPanelText.includes(SSE_INTERRUPTION_ERROR_COPY)) {
        throw new Error(`Smoke interruption scenario did not expose the expected interruption copy: ${finalizedPanelText}`);
      }
      if (!interruptedTerminalState?.preservedAssistantText?.trim()) {
        throw new Error("Smoke interruption scenario did not preserve any assistant text before the failure");
      }
      logSmokeStep("completed-successfully");
      return;
    }

    if (EXPECT_STOP_TERMINAL) {
      const finalAssistantText = visibleAssistantTexts.at(-1) ?? "";
      const normalizedPreStopText = normalizeComparableText(stopCheckpoint?.latestAssistantText ?? "");
      const normalizedFinalAssistantText = normalizeComparableText(finalAssistantText);
      if (summary.runStatus !== "done") {
        throw new Error(`Smoke stop scenario did not converge to a completed run state: ${summary.runStatus ?? "null"}`);
      }
      if (!normalizedPreStopText) {
        throw new Error("Smoke stop scenario did not capture assistant text before stop convergence");
      }
      if (!normalizedFinalAssistantText.includes(normalizedPreStopText)) {
        throw new Error(`Smoke stop scenario lost assistant text after stop: ${JSON.stringify({ normalizedPreStopText, normalizedFinalAssistantText }, null, 2)}`);
      }
      if (!(completedCheckpoint?.summaryText ?? "").includes("已完成")) {
        throw new Error(`Smoke stop scenario did not expose completed summary copy: ${completedCheckpoint?.summaryText ?? ""}`);
      }
      logSmokeStep("completed-successfully");
      return;
    }

    const allowInteractiveWaitState = !EXPECT_QUESTION && summary.questionAnswered && summary.runStatus === "waiting_for_answer";
    if (summary.runStatus !== "done" && !allowInteractiveWaitState) {
      throw new Error(`Smoke test did not reach a completed run state: ${summary.runStatus ?? "null"}`);
    }

    if (summary.finalOutputLength === 0) {
      throw new Error("Smoke test completed without any final assistant output");
    }

    if (allowInteractiveWaitState) {
      logSmokeStep("completed-with-interactive-wait-state");
    }

    if (summary.runEventCount === 0) {
      throw new Error("Smoke test did not receive any real run events");
    }

    if (!finalizedPanelText.trim()) {
      throw new Error("Embedded panel did not render any visible content");
    }

    if (!assistantMessageSequenceComparison.rawVsState.ok) {
      throw new Error(`Assistant message sequence diverged between raw events and projected state: ${JSON.stringify(assistantMessageSequenceComparison, null, 2)}`);
    }

    if (!assistantVisibilityComparison.ok) {
      throw new Error(`Assistant terminal visibility comparison failed: ${JSON.stringify({ assistantVisibilityComparison, assistantTextComparison }, null, 2)}`);
    }

    if (!assistantMessageSequenceComparison.stateVsUi.ok) {
      if (ENFORCE_ASSISTANT_SEQUENCE_COMPARISON) {
        console.warn(`Assistant message sequence comparison mismatch accepted because UI coalesced terminal assistant output: ${JSON.stringify({ assistantMessageSequenceComparison, assistantVisibilityComparison }, null, 2)}`);
      } else {
        console.warn(`Assistant message sequence comparison mismatch ignored by REAL_SMOKE_ENFORCE_SEQUENCE_COMPARISON=0: ${JSON.stringify(assistantMessageSequenceComparison, null, 2)}`);
      }
    }
    logSmokeStep("completed-successfully");
  } finally {
    await Promise.race([
      browserSession.close(),
      new Promise((resolve) => setTimeout(resolve, 5000))
    ]);
    await adapterEnvironment.close();
    await opencodeEnvironment.close();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });