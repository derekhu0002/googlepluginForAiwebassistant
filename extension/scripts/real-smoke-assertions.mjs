import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "../..");
const smokeScriptPath = path.join(scriptsDir, "real-extension-smoke.mjs");
const smokeOutputDir = path.join(repoRoot, "temp", "real-extension-smoke");

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
    const child = spawn(process.execPath, [smokeScriptPath], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
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

export async function runSmokeAndLoadArtifacts(options = {}) {
  await runSmokeScript(options);

  const [visibleParts, extensionState, comparison, statusCheckpoints] = await Promise.all([
    readJsonArtifact("visible-parts.json"),
    readJsonArtifact("extension-state.json"),
    readJsonArtifact("comparison.json"),
    readOptionalJsonArtifact("status-checkpoints.json")
  ]);

  return { visibleParts, extensionState, comparison, statusCheckpoints };
}

export function assertToolTranscriptHidden(artifacts) {
  const promptParts = artifacts.visibleParts.filter((part) => part.kind === "prompt");
  const assistantTextParts = artifacts.visibleParts.filter((part) => part.role === "assistant" && part.kind === "text");
  const summaryPart = artifacts.visibleParts.find((part) => part.kind === "summary");
  const invalidParts = artifacts.visibleParts.filter((part) => !allowedVisibleKinds.has(part.kind));
  const sequenceComparison = artifacts.comparison?.assistantMessageSequenceComparison;

  assert(promptParts.length >= 1, "Visible transcript is missing the user prompt", artifacts.visibleParts);
  assert(assistantTextParts.length >= 1, "Visible transcript is missing assistant text output", artifacts.visibleParts);
  assert(Boolean(summaryPart), "Visible transcript is missing the summary part", artifacts.visibleParts);
  assert(invalidParts.length === 0, "Visible transcript exposed non-user-facing parts", invalidParts);
  assert(!artifacts.visibleParts.some((part) => part.kind === "tool"), "Visible transcript leaked tool parts", artifacts.visibleParts);
  assert(Boolean(sequenceComparison), "Real smoke did not produce assistant message sequence diagnostics", artifacts.comparison);
  assert(
    sequenceComparison?.rawVsUi?.ok === true
      && sequenceComparison?.stateVsUi?.ok === true,
    "Real smoke assistant message sequence did not match UI output",
    sequenceComparison
  );
}

export function assertCompletedSummaryAfterTerminalEvidence(artifacts) {
  const summaryPart = artifacts.visibleParts.find((part) => part.kind === "summary");
  const summaryText = normalizeText(summaryPart?.text);
  const runEvents = Array.isArray(artifacts.extensionState?.runEvents) ? artifacts.extensionState.runEvents : [];
  const hasTerminalEvidence = runEvents.some((event) => event?.type === "result" || event?.semantic?.emissionKind === "final");
  const assistantTextParts = artifacts.visibleParts.filter((part) => part.role === "assistant" && part.kind === "text");

  assert(Boolean(summaryPart), "Visible transcript is missing the summary part", artifacts.visibleParts);
  assert(summaryText.includes("已完成"), "Summary did not converge to completed copy", { summaryText });
  assert(!summaryText.includes("进行中"), "Summary still shows in-progress copy after terminal evidence", { summaryText });
  assert(hasTerminalEvidence, "Real smoke did not capture terminal result evidence in extension state", {
    runEventCount: runEvents.length,
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