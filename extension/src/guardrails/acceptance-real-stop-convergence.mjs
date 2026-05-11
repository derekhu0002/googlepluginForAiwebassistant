/** Guardrail: watches extension/src stop semantics so user stop or finish=stop halts further growth without rolling back already visible content. */
import { assertStopHandled, runSmokeAndLoadArtifacts } from "../../scripts/real-smoke-assertions.mjs";

const artifacts = await runSmokeAndLoadArtifacts({
  env: {
    REAL_SMOKE_REQUIRE_REPO_STUB: "1",
    REAL_SMOKE_SCENARIO: "stop",
    EXTENSION_SMOKE_PROMPT: "请持续流式输出当前风险分析，随后以 stop 终态结束本轮回答。",
    OPENCODE_STUB_STREAM_CHUNK_COUNT: "12",
    OPENCODE_STUB_STREAM_EVENT_DELAY_MS: "200",
    OPENCODE_STUB_SESSION_IDLE_DELAY_MS: "800",
    OPENCODE_STUB_STEP_FINISH_STOP_AFTER_CHUNK: "4",
    REAL_SMOKE_CAPTURE_PROGRESS_CHECKPOINT: "1"
  }
});

assertStopHandled(artifacts);

console.log(JSON.stringify({
  testcase: "RealStopConvergence",
  result: "passed"
}, null, 2));