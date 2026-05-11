/** Guardrail: watches extension/src main-stage transcript projection so tool transcript stays hidden from the visible user conversation. */
import { assertToolTranscriptHidden, runSmokeAndLoadArtifacts } from "../../scripts/real-smoke-assertions.mjs";

const artifacts = await runSmokeAndLoadArtifacts({
  env: {
    REAL_SMOKE_REQUIRE_LIVE_UPSTREAM: "1",
    REAL_SMOKE_REQUIRE_REPO_STUB: "0",
    EXTENSION_SMOKE_PROMPT: "请总结当前风险。",
    EXTENSION_SMOKE_RESPONSE_CONTRACT: "只返回一行中文结论，格式必须是：风险结论：<不超过20个汉字>。不要换行，不要列表，不要补充解释。"
  }
});
assertToolTranscriptHidden(artifacts);
console.log(JSON.stringify({
  testcase: "TestCase2",
  result: "passed",
  visiblePartKinds: artifacts.visibleParts.map((part) => part.kind),
  visibleAssistantTextCount: artifacts.visibleParts.filter((part) => part.role === "assistant" && part.kind === "text").length,
  summary: artifacts.visibleParts.find((part) => part.kind === "summary")?.text ?? ""
}, null, 2));