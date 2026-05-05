import { assertQuestionFlowCompleted, runSmokeAndLoadArtifacts } from "./real-smoke-assertions.mjs";

const artifacts = await runSmokeAndLoadArtifacts({
  env: {
    REAL_SMOKE_REQUIRE_LIVE_UPSTREAM: "1",
    REAL_SMOKE_REQUIRE_REPO_STUB: "0",
    REAL_SMOKE_SCENARIO: "question",
    EXTENSION_SMOKE_PROMPT: "请先澄清当前 SR 的处理优先级，再总结风险。",
    EXTENSION_SMOKE_RESPONSE_CONTRACT: "在收到我的回答后，只返回一行中文结论，格式必须是：风险结论：<不超过20个汉字>。不要换行，不要列表，不要补充解释。"
  }
});

assertQuestionFlowCompleted(artifacts);

console.log(JSON.stringify({
  testcase: "RealQuestionBlocking",
  result: "passed"
}, null, 2));