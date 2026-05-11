/** Guardrail: watches extension/src run lifecycle convergence so in-progress and completed UI states switch at the right checkpoints. */
import { assertCompletedSummaryAfterTerminalEvidence, assertRunControlsTransition, runSmokeAndLoadArtifacts } from "../../scripts/real-smoke-assertions.mjs";

const artifacts = await runSmokeAndLoadArtifacts({
  env: {
    REAL_SMOKE_REQUIRE_LIVE_UPSTREAM: "1",
    REAL_SMOKE_REQUIRE_REPO_STUB: "0",
    EXTENSION_SMOKE_PROMPT: "请总结当前风险。",
    EXTENSION_SMOKE_RESPONSE_CONTRACT: "只返回一行中文结论，格式必须是：风险结论：<不超过20个汉字>。不要换行，不要列表，不要补充解释。",
    REAL_SMOKE_ENFORCE_TEXT_COMPARISON: "0",
    REAL_SMOKE_CAPTURE_PROGRESS_CHECKPOINT: "1"
  }
});
assertCompletedSummaryAfterTerminalEvidence(artifacts);
assertRunControlsTransition(artifacts);
console.log(JSON.stringify({
  testcase: "TestCase3",
  result: "passed",
  runStatus: artifacts.extensionState?.currentRun?.status ?? null,
  streamStatus: artifacts.extensionState?.stream?.status ?? null,
  summary: artifacts.visibleParts.find((part) => part.kind === "summary")?.text ?? "",
  inProgressSummary: artifacts.statusCheckpoints?.inProgress?.summaryText ?? null,
  inProgressNewSessionDisabled: artifacts.statusCheckpoints?.inProgress?.newSessionDisabled ?? null,
  inProgressSendDisabled: artifacts.statusCheckpoints?.inProgress?.sendDisabled ?? null,
  completedNewSessionDisabled: artifacts.statusCheckpoints?.completed?.newSessionDisabled ?? null,
  completedSendDisabled: artifacts.statusCheckpoints?.completed?.sendDisabled ?? null,
  terminalEvidenceCount: Array.isArray(artifacts.extensionState?.runEvents)
    ? artifacts.extensionState.runEvents.filter((event) => event?.type === "result" || event?.semantic?.emissionKind === "final").length
    : 0
}, null, 2));