import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "../..");
const smokeScriptPath = path.join(scriptsDir, "real-extension-smoke.mjs");
const smokeOutputDir = path.join(repoRoot, "temp", "real-extension-smoke");

const allowedVisibleKinds = new Set(["prompt", "text", "summary"]);

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

async function readJsonArtifact(fileName) {
  const filePath = path.join(smokeOutputDir, fileName);
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content);
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

  const [visibleParts, extensionState, comparison] = await Promise.all([
    readJsonArtifact("visible-parts.json"),
    readJsonArtifact("extension-state.json"),
    readJsonArtifact("comparison.json")
  ]);

  return { visibleParts, extensionState, comparison };
}

export function assertToolTranscriptHidden(artifacts) {
  const promptParts = artifacts.visibleParts.filter((part) => part.kind === "prompt");
  const assistantTextParts = artifacts.visibleParts.filter((part) => part.role === "assistant" && part.kind === "text");
  const summaryPart = artifacts.visibleParts.find((part) => part.kind === "summary");
  const invalidParts = artifacts.visibleParts.filter((part) => !allowedVisibleKinds.has(part.kind));

  assert(promptParts.length >= 1, "Visible transcript is missing the user prompt", artifacts.visibleParts);
  assert(assistantTextParts.length >= 1, "Visible transcript is missing assistant text output", artifacts.visibleParts);
  assert(Boolean(summaryPart), "Visible transcript is missing the summary part", artifacts.visibleParts);
  assert(invalidParts.length === 0, "Visible transcript exposed non-user-facing parts", invalidParts);
  assert(!artifacts.visibleParts.some((part) => part.kind === "tool"), "Visible transcript leaked tool parts", artifacts.visibleParts);
  assert(
    artifacts.comparison?.assistantTextComparison?.rawVsUi?.ok === true
      && artifacts.comparison?.assistantTextComparison?.stateVsUi?.ok === true,
    "Real smoke assistant text comparison did not match UI output",
    artifacts.comparison?.assistantTextComparison
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