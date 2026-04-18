import { assertCompletedSummaryAfterTerminalEvidence, runSmokeAndLoadArtifacts } from "./real-smoke-assertions.mjs";

const artifacts = await runSmokeAndLoadArtifacts({
  env: {
    REAL_SMOKE_ENFORCE_TEXT_COMPARISON: "0"
  }
});
assertCompletedSummaryAfterTerminalEvidence(artifacts);
console.log(JSON.stringify({
  testcase: "TestCase3",
  result: "passed",
  runStatus: artifacts.extensionState?.currentRun?.status ?? null,
  streamStatus: artifacts.extensionState?.stream?.status ?? null,
  summary: artifacts.visibleParts.find((part) => part.kind === "summary")?.text ?? "",
  terminalEvidenceCount: Array.isArray(artifacts.extensionState?.runEvents)
    ? artifacts.extensionState.runEvents.filter((event) => event?.type === "result" || event?.semantic?.emissionKind === "final").length
    : 0
}, null, 2));