/** Guardrail: watches extension/src capture orchestration so pre-captured page fields are reused on run start and projected into the transcript. */
import { assertCapturedContextVisibleInTranscript, runSmokeAndLoadArtifacts } from "../../scripts/real-smoke-assertions.mjs";

const artifacts = await runSmokeAndLoadArtifacts({
  env: {
    REAL_SMOKE_REQUIRE_LIVE_UPSTREAM: "1",
    REAL_SMOKE_REQUIRE_REPO_STUB: "0",
    EXTENSION_SMOKE_PROMPT: "请总结当前风险。",
    EXTENSION_SMOKE_RESPONSE_CONTRACT: "只返回一行中文结论，格式必须是：风险结论：<不超过20个汉字>。不要换行，不要列表，不要补充解释。",
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