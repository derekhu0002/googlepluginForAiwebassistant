import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "../..");
const smokeScriptPath = path.join(scriptsDir, "real-extension-smoke.mjs");
const smokeOutputDir = path.join(repoRoot, "temp", "real-extension-smoke");

const REAL_SMOKE_ENV_KEYS = [
  "REAL_SMOKE_REQUIRE_LIVE_UPSTREAM",
  "REAL_SMOKE_REQUIRE_REPO_STUB",
  "REAL_SMOKE_OPENCODE_BASE_URL",
  "EXTENSION_SMOKE_OPENCODE_HEALTH_URL",
  "REAL_SMOKE_EXTENSION_API_BASE_URL",
  "EXTENSION_SMOKE_ADAPTER_HEALTH_URL",
  "REAL_SMOKE_ADAPTER_PORT",
  "REAL_SMOKE_OPENCODE_STUB_PORT",
  "REAL_SMOKE_SCENARIO",
  "REAL_SMOKE_CAPTURE_PROGRESS_CHECKPOINT",
  "REAL_SMOKE_CAPTURE_PERFORMANCE_GUARD"
];

const allowedVisibleKinds = new Set(["prompt", "capture", "text", "summary"]);

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

async function readJsonArtifact(fileName) {
  const filePath = path.join(smokeOutputDir, fileName);
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content);
}

async function readOptionalJsonArtifact(fileName) {
  try {
    return await readJsonArtifact(fileName);
  } catch {
    return null;
  }
}

function runSmokeScript(options = {}) {
  return new Promise((resolve, reject) => {
    const sanitizedEnv = { ...process.env };
    for (const key of REAL_SMOKE_ENV_KEYS) {
      delete sanitizedEnv[key];
    }

    const child = spawn(process.execPath, [smokeScriptPath], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
      env: {
        ...sanitizedEnv,
        ...(options.env ?? {})
      }
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`real-extension-smoke terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`real-extension-smoke exited with code ${code ?? 1}`));
        return;
      }
      resolve();
    });
  });
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
    throw new Error(`${message}${suffix}`);
  }
}

function hasTerminalEvidenceInState(extensionState) {
  const runEvents = Array.isArray(extensionState?.runEvents) ? extensionState.runEvents : [];
  if (runEvents.some((event) => event?.type === "result" || event?.type === "error")) {
    return true;
  }

  const currentRun = extensionState?.currentRun ?? null;
  if (currentRun?.status === "done" && normalizeText(currentRun?.finalOutput).length > 0) {
    return true;
  }

  if (currentRun?.status === "error" && normalizeText(currentRun?.errorMessage ?? extensionState?.errorMessage ?? extensionState?.error).length > 0) {
    return true;
  }

  return false;
}

export async function runSmokeAndLoadArtifacts(options = {}) {
  await runSmokeScript(options);

  const [visibleParts, extensionState, comparison, statusCheckpoints, performance] = await Promise.all([
    readJsonArtifact("visible-parts.json"),
    readJsonArtifact("extension-state.json"),
    readJsonArtifact("comparison.json"),
    readOptionalJsonArtifact("status-checkpoints.json"),
    readOptionalJsonArtifact("performance.json")
  ]);

  return { visibleParts, extensionState, comparison, statusCheckpoints, performance };
}

export function assertToolTranscriptHidden(artifacts) {
  const promptParts = artifacts.visibleParts.filter((part) => part.kind === "prompt");
  const assistantTextParts = artifacts.visibleParts.filter((part) => part.role === "assistant" && part.kind === "text");
  const summaryPart = artifacts.visibleParts.find((part) => part.kind === "summary");
  const invalidParts = artifacts.visibleParts.filter((part) => !allowedVisibleKinds.has(part.kind));
  const sequenceComparison = artifacts.comparison?.assistantMessageSequenceComparison;
  const visibilityComparison = artifacts.comparison?.assistantVisibilityComparison;

  assert(promptParts.length >= 1, "Visible transcript is missing the user prompt", artifacts.visibleParts);
  assert(assistantTextParts.length >= 1, "Visible transcript is missing assistant text output", artifacts.visibleParts);
  assert(Boolean(summaryPart), "Visible transcript is missing the summary part", artifacts.visibleParts);
  assert(invalidParts.length === 0, "Visible transcript exposed non-user-facing parts", invalidParts);
  assert(!artifacts.visibleParts.some((part) => part.kind === "tool"), "Visible transcript leaked tool parts", artifacts.visibleParts);
  assert(Boolean(sequenceComparison), "Real smoke did not produce assistant message sequence diagnostics", artifacts.comparison);
  assert(
    sequenceComparison?.stateVsUi?.ok === true || visibilityComparison?.ok === true,
    "Real smoke assistant message sequence did not match UI output",
    {
      assistantMessageSequenceComparison: sequenceComparison,
      assistantVisibilityComparison: visibilityComparison
    }
  );
}

export function assertCompletedSummaryAfterTerminalEvidence(artifacts) {
  const summaryPart = artifacts.visibleParts.find((part) => part.kind === "summary");
  const summaryText = normalizeText(summaryPart?.text);
  const completedCheckpointSummary = normalizeText(artifacts.statusCheckpoints?.completed?.summaryText);
  const runEvents = Array.isArray(artifacts.extensionState?.runEvents) ? artifacts.extensionState.runEvents : [];
  const hasTerminalEvidence = hasTerminalEvidenceInState(artifacts.extensionState);
  const assistantTextParts = artifacts.visibleParts.filter((part) => part.role === "assistant" && part.kind === "text");

  assert(Boolean(summaryPart), "Visible transcript is missing the summary part", artifacts.visibleParts);
  assert(summaryText.includes("已完成"), "Summary did not converge to completed copy", { summaryText });
  assert(!summaryText.includes("进行中"), "Summary still shows in-progress copy after terminal evidence", { summaryText });
  assert(hasTerminalEvidence || completedCheckpointSummary.includes("已完成"), "Real smoke did not capture terminal result evidence in extension state", {
    runEventCount: runEvents.length,
    currentRun: artifacts.extensionState?.currentRun ?? null,
    stream: artifacts.extensionState?.stream ?? null,
    completedCheckpointSummary,
    sample: runEvents.slice(-5)
  });
  assert(assistantTextParts.length >= 1, "Visible transcript is missing assistant text output", artifacts.visibleParts);
}

export function assertRunControlsTransition(artifacts) {
  const inProgress = artifacts.statusCheckpoints?.inProgress;
  const completed = artifacts.statusCheckpoints?.completed;

  assert(Boolean(inProgress), "Real smoke did not capture the in-progress UI checkpoint", artifacts.statusCheckpoints);
  assert(Boolean(completed), "Real smoke did not capture the completed UI checkpoint", artifacts.statusCheckpoints);
  assert(normalizeText(inProgress?.summaryText).includes("进行中"), "Summary copy did not stay in progress during the run", inProgress);
  assert(inProgress?.newSessionDisabled === true, "New session button was not disabled during the run", inProgress);
  assert(inProgress?.sendDisabled === true, "Send button was not disabled during the run", inProgress);
  assert(normalizeText(completed?.summaryText).includes("已完成"), "Summary copy did not switch to completed after the run", completed);
  assert(!normalizeText(completed?.summaryText).includes("进行中"), "Summary copy still showed in-progress after completion", completed);
  assert(completed?.newSessionDisabled === false, "New session button did not re-enable after completion", completed);
  assert(completed?.sendDisabled === false, "Send button did not re-enable after completion", completed);
}

export function assertCapturedContextVisibleInTranscript(artifacts) {
  const capturePart = artifacts.visibleParts.find((part) => part.kind === "capture" && part.role === "user");
  const captureText = normalizeText(capturePart?.text);
  const currentRun = artifacts.extensionState?.currentRun ?? null;

  assert(Boolean(capturePart), "Visible transcript is missing the captured context part", artifacts.visibleParts);
  assert(captureText.includes("selected_sr="), "Captured context part is missing selected_sr", { captureText });
  assert(captureText.includes("software_version="), "Captured context part is missing software_version", { captureText });
  assert(captureText.includes("pageTitle="), "Captured context part is missing pageTitle", { captureText });
  assert(captureText.includes("pageUrl="), "Captured context part is missing pageUrl", { captureText });
  assert(Boolean(currentRun?.selectedSr), "Current run is missing selectedSr after capture-backed send", currentRun);
  assert(Boolean(currentRun?.softwareVersion), "Current run is missing softwareVersion after capture-backed send", currentRun);
  assert(Boolean(currentRun?.pageTitle), "Current run is missing pageTitle after capture-backed send", currentRun);
  assert(Boolean(currentRun?.pageUrl), "Current run is missing pageUrl after capture-backed send", currentRun);
}

export function assertQuestionFlowCompleted(artifacts) {
  const questionCheckpoint = artifacts.statusCheckpoints?.question;
  const runEvents = Array.isArray(artifacts.extensionState?.runEvents) ? artifacts.extensionState.runEvents : [];
  const questionEvents = runEvents.filter((event) => event?.type === "question");
  const answerRecords = Array.isArray(artifacts.extensionState?.answers) ? artifacts.extensionState.answers : [];
  const answerPersisted = answerRecords.some((answer) => answer?.questionId === questionCheckpoint?.pendingQuestionId)
    || questionCheckpoint?.answerPersisted === true;

  assert(Boolean(questionCheckpoint?.pendingQuestionId), "Real smoke did not record a visible question checkpoint", artifacts.statusCheckpoints);
  assert(questionEvents.length >= 1, "Real smoke did not receive any normalized question event", runEvents.slice(-10));
  assert(Boolean(questionCheckpoint?.questionText), "Real smoke question checkpoint is missing visible question text", questionCheckpoint);
  assert(Boolean(questionCheckpoint?.answerText), "Real smoke question checkpoint is missing the submitted answer", questionCheckpoint);
  assert(
    answerPersisted || artifacts.extensionState?.stream?.pendingQuestionId === null,
    "Real smoke did not carry the question flow through to a cleared pending state",
    { answerRecords, questionCheckpoint, stream: artifacts.extensionState?.stream ?? null }
  );
  assert(artifacts.extensionState?.stream?.pendingQuestionId === null, "Pending question did not clear after the answer submission", artifacts.extensionState?.stream);
  assert(hasTerminalEvidenceInState(artifacts.extensionState), "Run never converged after the question answer was submitted", {
    currentRun: artifacts.extensionState?.currentRun ?? null,
    stream: artifacts.extensionState?.stream ?? null,
    runEvents: runEvents.slice(-10)
  });
}

export function assertDomainAccessDenied(artifacts) {
  const domainAccess = artifacts.statusCheckpoints?.domainAccess;
  assert(Boolean(domainAccess), "Real smoke did not record the domain access denial checkpoint", artifacts.statusCheckpoints);
  const normalizedPanelText = normalizeText(`${domainAccess?.panelText ?? ""} ${domainAccess?.activeContext?.message ?? ""}`);
  assert(
    normalizedPanelText.includes("当前站点未授权采集")
      || normalizedPanelText.includes("规则未命中")
      || normalizedPanelText.includes("当前页面未命中任何启用规则")
      || normalizedPanelText.includes("尚未命中任何启用规则"),
    "Sidepanel did not expose the expected domain access denial state",
    domainAccess
  );
  assert(!domainAccess?.activeContext?.matchedRule, "Unauthorized domain scenario unexpectedly matched a rule", domainAccess?.activeContext);
  assert(!domainAccess?.currentRun?.runId, "Unauthorized domain scenario should not create a run", domainAccess?.currentRun);
}

export function assertSseInterruptionHandled(artifacts) {
  const interruption = artifacts.statusCheckpoints?.interruption;
  const summaryPart = artifacts.visibleParts.find((part) => part.kind === "summary");
  const summaryText = normalizeText(summaryPart?.text);
  const assistantTextParts = artifacts.visibleParts.filter((part) => part.role === "assistant" && part.kind === "text");

  assert(Boolean(interruption), "Real smoke did not record the SSE interruption checkpoint", artifacts.statusCheckpoints);
  assert(assistantTextParts.length >= 1, "Interrupted run did not preserve any assistant text in the visible transcript", artifacts.visibleParts);
  assert(summaryText.includes("已中断"), "Interrupted run summary did not switch to the visible interrupted state", { summaryText, interruption });
  assert(normalizeText(interruption?.errorMessage).includes("连接中断，请重试"), "Interrupted run did not expose the expected interruption error copy", interruption);
  assert(artifacts.extensionState?.currentRun?.status === "error", "Interrupted run did not converge to error status", artifacts.extensionState?.currentRun);
  assert(artifacts.extensionState?.stream?.status === "error", "Interrupted stream did not converge to error status", artifacts.extensionState?.stream);
}

export function assertStopHandled(artifacts) {
  const stopCheckpoint = artifacts.statusCheckpoints?.stop;
  const summaryPart = artifacts.visibleParts.find((part) => part.kind === "summary");
  const summaryText = normalizeText(summaryPart?.text);
  const assistantTextParts = artifacts.visibleParts.filter((part) => part.role === "assistant" && part.kind === "text");
  const finalAssistantText = normalizeText(assistantTextParts.at(-1)?.text);
  const preStopAssistantText = normalizeText(stopCheckpoint?.preStopAssistantText);

  assert(Boolean(stopCheckpoint), "Real smoke did not record the stop checkpoint", artifacts.statusCheckpoints);
  assert(assistantTextParts.length >= 1, "Stop scenario did not preserve any assistant text in the visible transcript", artifacts.visibleParts);
  assert(preStopAssistantText.length > 0, "Stop scenario did not capture assistant text before stop convergence", stopCheckpoint);
  assert(finalAssistantText.includes(preStopAssistantText), "Stop scenario did not preserve the already visible assistant text after stop", {
    preStopAssistantText,
    finalAssistantText,
    stopCheckpoint
  });
  assert(summaryText.includes("已完成"), "Stop scenario summary did not switch to completed state", { summaryText, stopCheckpoint });
  assert(artifacts.extensionState?.currentRun?.status === "done", "Stopped run did not converge to done status", artifacts.extensionState?.currentRun);
  assert(artifacts.extensionState?.stream?.status === "done", "Stopped stream did not converge to done status", artifacts.extensionState?.stream);
}

export function assertSidepanelPerformanceGuard(artifacts, thresholds = {}) {
  const performance = artifacts.performance;
  const inputMeasurements = [performance?.inputMeasurement, ...(Array.isArray(performance?.inputMeasurements) ? performance.inputMeasurements : [])]
    .filter((entry) => entry?.supported && entry?.updated);
  const agentMeasurements = [performance?.agentMeasurement, ...(Array.isArray(performance?.agentMeasurements) ? performance.agentMeasurements : [])]
    .filter((entry) => entry?.supported && entry?.updated);
  const maxInputLatencyMs = Math.max(0, ...inputMeasurements.map((entry) => entry.latencyMs ?? 0));
  const maxAgentLatencyMs = Math.max(0, ...agentMeasurements.map((entry) => entry.latencyMs ?? 0));
  const maxGrowthStallMs = performance?.maxGrowthStallMs ?? Number.POSITIVE_INFINITY;
  const maxLongTaskMs = performance?.maxLongTaskMs ?? 0;
  const maxRafGapMs = performance?.maxRafGapMs ?? 0;
  const growthEventCount = Array.isArray(performance?.growthEvents) ? performance.growthEvents.length : 0;

  const limits = {
    maxInputLatencyMs: thresholds.maxInputLatencyMs ?? 250,
    maxAgentLatencyMs: thresholds.maxAgentLatencyMs ?? 250,
    maxGrowthStallMs: thresholds.maxGrowthStallMs ?? 1000,
    maxLongTaskMs: thresholds.maxLongTaskMs ?? 200,
    maxRafGapMs: thresholds.maxRafGapMs ?? 300,
    minGrowthEvents: thresholds.minGrowthEvents ?? 5
  };

  assert(Boolean(performance), "Real smoke did not produce sidepanel performance artifacts", artifacts);
  assert(inputMeasurements.length >= 1, "Performance guard did not capture any successful textarea input measurements", performance);
  assert(agentMeasurements.length >= 1, "Performance guard did not capture any successful main-agent switch measurements", performance);
  assert(growthEventCount >= limits.minGrowthEvents, "Assistant transcript did not show enough incremental growth samples", {
    growthEventCount,
    transcriptSamples: performance?.transcriptSamples?.slice(-20) ?? []
  });
  assert(maxInputLatencyMs <= limits.maxInputLatencyMs, "Textarea input latency exceeded the performance budget", {
    maxInputLatencyMs,
    limit: limits.maxInputLatencyMs,
    inputMeasurements
  });
  assert(maxAgentLatencyMs <= limits.maxAgentLatencyMs, "Main-agent switch latency exceeded the performance budget", {
    maxAgentLatencyMs,
    limit: limits.maxAgentLatencyMs,
    agentMeasurements
  });
  assert(maxGrowthStallMs <= limits.maxGrowthStallMs, "Assistant transcript stalled for too long during streaming", {
    maxGrowthStallMs,
    limit: limits.maxGrowthStallMs,
    growthEvents: performance?.growthEvents?.slice(-20) ?? []
  });
  assert(maxLongTaskMs <= limits.maxLongTaskMs, "Sidepanel emitted a long task beyond the allowed threshold", {
    maxLongTaskMs,
    limit: limits.maxLongTaskMs,
    longTasks: performance?.longTasks ?? []
  });
  assert(maxRafGapMs <= limits.maxRafGapMs, "Sidepanel exhibited a visible freeze-sized animation frame gap", {
    maxRafGapMs,
    limit: limits.maxRafGapMs,
    rafGaps: performance?.rafGaps ?? []
  });
}