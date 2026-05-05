import { assertSseInterruptionHandled, runSmokeAndLoadArtifacts } from "./real-smoke-assertions.mjs";

const artifacts = await runSmokeAndLoadArtifacts({
  env: {
    REAL_SMOKE_REQUIRE_REPO_STUB: "1",
    REAL_SMOKE_SCENARIO: "sse-interruption",
    EXTENSION_SMOKE_PROMPT: "请持续流式输出一段较长的 Markdown 风险分析，直到被外部中断。",
    OPENCODE_STUB_STREAM_CHUNK_COUNT: "12",
    OPENCODE_STUB_STREAM_EVENT_DELAY_MS: "250",
    OPENCODE_STUB_SESSION_IDLE_DELAY_MS: "2000",
    OPENCODE_STUB_SESSION_ERROR_AFTER_CHUNK: "4"
  }
});

assertSseInterruptionHandled(artifacts);

console.log(JSON.stringify({
  testcase: "RealSseInterruption",
  result: "passed"
}, null, 2));