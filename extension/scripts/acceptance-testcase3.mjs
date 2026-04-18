import { assertCompletedSummaryAfterTerminalEvidence, assertRunControlsTransition, runSmokeAndLoadArtifacts } from "./real-smoke-assertions.mjs";

const artifacts = await runSmokeAndLoadArtifacts({
  env: {
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