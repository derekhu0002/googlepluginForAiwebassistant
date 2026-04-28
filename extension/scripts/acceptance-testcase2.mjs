import { assertToolTranscriptHidden, runSmokeAndLoadArtifacts } from "./real-smoke-assertions.mjs";

const artifacts = await runSmokeAndLoadArtifacts({
  env: {
    EXTENSION_SMOKE_PROMPT: "请用一句话总结当前风险。"
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