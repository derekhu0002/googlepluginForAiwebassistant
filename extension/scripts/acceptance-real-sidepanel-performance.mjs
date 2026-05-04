import { assertSidepanelPerformanceGuard, runSmokeAndLoadArtifacts } from "./real-smoke-assertions.mjs";

function buildLargeMarkdownPayload() {
  const heading = "# REAL_EXTENSION_SMOKE_OK\n\n## 风险摘要\n\n- 当前 SR 需要优先核对软件版本影响范围\n- 建议先执行分层回归，再安排增量修复验证\n";
  const tableHeader = "| 模块 | 风险 | 建议动作 |\n|---|---|---|";
  const tableRows = Array.from({ length: 24 }, (_, index) => `| 模块-${index + 1} | 风险-${index + 1} | 建议动作-${index + 1} |`).join("\n");
  const codeBlock = Array.from({ length: 320 }, (_, index) => `log line ${index}: value=${index % 11}`).join("\n");

  return [
    heading,
    tableHeader,
    tableRows,
    "",
    "```text",
    codeBlock,
    "```",
    "",
    "## 下一步动作",
    "1. 复核当前流式渲染的消息分段。",
    "2. 对照 sidepanel 的最终 Markdown 收敛结果。",
    "3. 采样真实浏览器下的输入与菜单交互时延。"
  ].join("\n");
}

const artifacts = await runSmokeAndLoadArtifacts({
  env: {
    EXTENSION_SMOKE_PROMPT: "请以大段 Markdown 流式输出当前 SR 的风险、建议动作和日志摘录。",
    REAL_SMOKE_CAPTURE_PERFORMANCE_GUARD: "1",
    REAL_SMOKE_CAPTURE_PROGRESS_CHECKPOINT: "1",
    REAL_SMOKE_REQUIRE_REPO_STUB: "1",
    REAL_SMOKE_ADAPTER_PORT: "18030",
    REAL_SMOKE_OPENCODE_STUB_PORT: "18124",
    REAL_SMOKE_EXTENSION_API_BASE_URL: "http://127.0.0.1:18030",
    OPENCODE_STUB_FINAL_TEXT: buildLargeMarkdownPayload(),
    OPENCODE_STUB_STREAM_CHUNK_COUNT: "12",
    OPENCODE_STUB_STREAM_EVENT_DELAY_MS: "120",
    OPENCODE_STUB_SESSION_IDLE_DELAY_MS: "600"
  }
});

assertSidepanelPerformanceGuard(artifacts);

console.log(JSON.stringify({
  testcase: "真实 sidepanel 性能护栏",
  result: "passed",
  inputLatencyMs: Math.max(0, ...(artifacts.performance?.inputMeasurements ?? []).map((entry) => entry?.latencyMs ?? 0)),
  agentSwitchLatencyMs: Math.max(0, ...(artifacts.performance?.agentMeasurements ?? []).map((entry) => entry?.latencyMs ?? 0)),
  growthEventCount: artifacts.performance?.growthEvents?.length ?? 0,
  maxGrowthStallMs: artifacts.performance?.maxGrowthStallMs ?? null,
  maxLongTaskMs: artifacts.performance?.maxLongTaskMs ?? null,
  maxRafGapMs: artifacts.performance?.maxRafGapMs ?? null,
  summary: artifacts.visibleParts.find((part) => part.kind === "summary")?.text ?? null
}, null, 2));