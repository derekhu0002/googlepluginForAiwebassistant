import { assertCapturedContextVisibleInTranscript, runSmokeAndLoadArtifacts } from "./real-smoke-assertions.mjs";

const artifacts = await runSmokeAndLoadArtifacts({
  env: {
    EXTENSION_SMOKE_PROMPT: "请用一句话总结当前风险。",
    REAL_SMOKE_CAPTURE_BEFORE_SEND: "1",
    REAL_SMOKE_ENFORCE_SEQUENCE_COMPARISON: "0"
  }
});

assertCapturedContextVisibleInTranscript(artifacts);

console.log(JSON.stringify({
  testcase: "TestCase4",
  result: "passed",
  capturePart: artifacts.visibleParts.find((part) => part.kind === "capture")?.text ?? null,
  currentRunCapture: {
    selectedSr: artifacts.extensionState?.currentRun?.selectedSr ?? null,
    softwareVersion: artifacts.extensionState?.currentRun?.softwareVersion ?? null,
    pageTitle: artifacts.extensionState?.currentRun?.pageTitle ?? null,
    pageUrl: artifacts.extensionState?.currentRun?.pageUrl ?? null
  }
}, null, 2));