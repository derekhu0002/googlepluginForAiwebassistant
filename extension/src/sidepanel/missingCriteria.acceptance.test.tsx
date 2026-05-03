import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedRunEvent, TranscriptTraceRecord } from "../shared/protocol";
import { evaluatePageAccess } from "../shared/pageAccess";
import { createIndexedDbHistoryStore } from "../shared/history";
import { buildStableTranscriptProjection, type BuildChatStreamItemsOptions, type TranscriptReadModel } from "./reasoningTimeline";
import { ReasoningTimeline } from "./reasoningTimelineView";
import { buildRunDiagnosticsSnapshot, formatRunDiagnosticsLog } from "./diagnostics";
import { createOpencodeRawEventProjector } from "./opencodeRawEventProjector";
import { initialAssistantState } from "../shared/state";
import { DEFAULT_MAIN_AGENT } from "../shared/protocol";

vi.mock("../shared/api", () => ({
  submitMessageFeedback: vi.fn(async () => ({ ok: true, data: { feedback: "like" } }))
}));

function createEvent(sequence: number, overrides: Partial<NormalizedRunEvent> = {}): NormalizedRunEvent {
  return {
    id: `event-${sequence}`,
    runId: "run-perf-1",
    type: "thinking",
    createdAt: `2026-04-27T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    sequence,
    message: `event ${sequence}`,
    semantic: {
      channel: "assistant_text",
      emissionKind: "delta",
      identity: `assistant_text:msg-1:part-${sequence}`,
      itemKind: "text",
      messageId: "msg-1",
      partId: `part-${sequence}`
    },
    ...overrides
  };
}

function createMarkdownPayload() {
  const header = "| 列1 | 列2 | 列3 | 列4 | 列5 | 列6 | 列7 | 列8 | 列9 | 列10 |";
  const separator = "|---|---|---|---|---|---|---|---|---|---|";
  const rows = Array.from({ length: 50 }, (_, rowIndex) => (
    `| ${rowIndex}-1 | ${rowIndex}-2 | ${rowIndex}-3 | ${rowIndex}-4 | ${rowIndex}-5 | ${rowIndex}-6 | ${rowIndex}-7 | ${rowIndex}-8 | ${rowIndex}-9 | ${rowIndex}-10 |`
  ));
  const codeBlock = Array.from({ length: 1000 }, (_, lineIndex) => `log line ${lineIndex}: value=${lineIndex % 7}`).join("\n");
  return [
    "# 大体量 Markdown",
    header,
    separator,
    ...rows,
    "",
    "```text",
    codeBlock,
    "```"
  ].join("\n");
}

function createRichMarkdownPayload() {
  return [
    "# 大体量 Markdown",
    "## 风险摘要",
    "- 第一项",
    "- 第二项",
    "1. 操作一",
    "2. 操作二",
    "",
    "> 需要优先核对 session 收敛状态。",
    "",
    "这是 `inline code` 与 [诊断链接](https://example.com/diagnostics)。",
    "",
    "<span data-raw-html='unsafe'>raw html</span>",
    "",
    createMarkdownPayload()
  ].join("\n");
}

function createQuestionEvent(sequence: number, runId: string): NormalizedRunEvent {
  return createEvent(sequence, {
    runId,
    type: "question",
    message: "是否继续执行高危漏洞补丁注入？",
    question: {
      questionId: "question-1",
      title: "继续执行",
      message: "是否继续执行高危漏洞补丁注入？",
      options: [
        { id: "approve", label: "继续", value: "continue" },
        { id: "deny", label: "停止", value: "stop" }
      ],
      allowFreeText: true,
      placeholder: "请输入补充说明"
    }
  });
}

function createDiagnosticsState() {
  const run = {
    runId: "run-diag-1",
    sessionId: "ses-diag-1",
    selectedAgent: DEFAULT_MAIN_AGENT,
    prompt: "why is content missing?",
    username: "alice",
    usernameSource: "dom_text" as const,
    softwareVersion: "v1",
    selectedSr: "SR-1",
    pageTitle: "Demo page",
    pageUrl: "https://example.com/page",
    status: "error" as const,
    startedAt: "2026-04-02T00:00:00.000Z",
    updatedAt: "2026-04-02T00:00:05.000Z",
    finalOutput: "partial answer",
    errorMessage: "连接中断，请重试"
  };

  return {
    ...initialAssistantState,
    status: "error" as const,
    errorMessage: "连接中断，请重试",
    currentRun: run,
    runEvents: [
      {
        id: "event-tool",
        runId: run.runId,
        type: "tool_call" as const,
        createdAt: "2026-04-02T00:00:01.000Z",
        sequence: 1,
        message: "Inspecting tool output"
      },
      {
        id: "event-thinking",
        runId: run.runId,
        type: "thinking" as const,
        createdAt: "2026-04-02T00:00:02.000Z",
        sequence: 2,
        message: "partial answer",
        data: { message_id: "msg-1", field: "text" }
      },
      {
        id: "event-error",
        runId: run.runId,
        type: "error" as const,
        createdAt: "2026-04-02T00:00:05.000Z",
        sequence: 3,
        message: "连接中断，请重试"
      }
    ],
    answers: [],
    stream: {
      runId: run.runId,
      status: "error" as const,
      pendingQuestionId: null,
      reconnectCount: 1
    },
    runEventState: {
      ...initialAssistantState.runEventState,
      transportTraces: [{
        stage: "transport",
        step: "receipt",
        outcome: "anomaly",
        createdAt: "2026-04-02T00:00:05.000Z",
        correlation: {
          runId: run.runId,
          rawEventId: "event-error",
          canonicalEventKey: null,
          sequence: 3,
          contentKey: "error",
          contentPreview: "连接中断，请重试"
        },
        details: {
          apiBaseUrl: "http://localhost:8030",
          uiMode: "sidepanel"
        }
      }] satisfies TranscriptTraceRecord[],
      diagnostics: []
    },
    renderTrace: [{
      stage: "render",
      step: "error_boundary",
      outcome: "failure",
      createdAt: "2026-04-02T00:00:06.000Z",
      correlation: {
        runId: run.runId,
        rawEventId: "event-error",
        canonicalEventKey: "msg-1",
        sequence: 3,
        contentKey: "error",
        contentPreview: "连接中断，请重试"
      },
      details: {
        stack: "Error: connection dropped\\n    at SidepanelTransport.handleError"
      }
    }] satisfies TranscriptTraceRecord[]
  };
}

function renderTimeline(
  container: HTMLDivElement,
  model: TranscriptReadModel,
  runId: string,
  runStatus: "streaming" | "waiting_for_answer" | "done" | "error",
  options: {
    pendingQuestionId?: string | null;
    onQuestionSubmit?: (answer: { answer: string; choiceId?: string }) => void;
    questionSubmitDisabled?: boolean;
    streamStatus?: "streaming" | "waiting_for_answer" | "done" | "error";
    finalOutput?: string;
    errorMessage?: string;
  } = {}
) {
  const root = createRoot(container);
  const startedAt = performance.now();

  act(() => {
    root.render(
      <div>
        <label>
          <span>prompt</span>
          <textarea aria-label="prompt-input" defaultValue="用户正在输入" />
        </label>
        <label>
          <span>agent</span>
          <select aria-label="main-agent-picker" defaultValue="ThreatIntelAnalyst">
            <option value="ThreatIntelAnalyst">ThreatIntelAnalyst</option>
          </select>
        </label>
        <ReasoningTimeline
          transcriptReadModel={model}
          runId={runId}
          prompt="请总结当前 SR 的风险与建议下一步动作。"
          events={[]}
          runStatus={runStatus}
          streamStatus={options.streamStatus}
          pendingQuestionId={options.pendingQuestionId}
          onQuestionSubmit={options.onQuestionSubmit}
          questionSubmitDisabled={options.questionSubmitDisabled}
          finalOutput={options.finalOutput}
          errorMessage={options.errorMessage}
        />
      </div>
    );
  });

  return {
    root,
    durationMs: performance.now() - startedAt
  };
}

function getVisibleParts(container: HTMLDivElement) {
  return Array.from(container.querySelectorAll("[data-section='part']")).map((node) => ({
    kind: node.getAttribute("data-part-kind"),
    role: node.getAttribute("data-part-role"),
    anchorId: node.getAttribute("data-part-anchor"),
    text: (node.textContent ?? "").trim()
  }));
}

function createHistoryRun(runId: string, index: number) {
  return {
    runId,
    selectedAgent: DEFAULT_MAIN_AGENT,
    prompt: `历史问题 ${index}`,
    username: "alice",
    usernameSource: "dom_text" as const,
    softwareVersion: "v1.2.3",
    selectedSr: `SR-${index}`,
    pageTitle: `Title ${index}`,
    pageUrl: `https://example.com/${index}`,
    status: "done" as const,
    startedAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:01.000Z",
    finalOutput: `# 历史结果 ${index}\n\n- 已完成`
  };
}

describe("missing architecture acceptance coverage", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    // @ts-expect-error test-only React act environment flag
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("流式消息渲染的 UI 线程隔离 (防止卡死)", () => {
    const runId = "run-ui-thread";
    const events = Array.from({ length: 120 }, (_, index) => createEvent(index + 1, {
      runId,
      message: `第 ${index + 1} 段增量输出，保持连续渲染。`
    }));
    const model = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId,
        prompt: "请总结当前 SR 的风险与建议下一步动作。",
        events,
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    const { root, durationMs } = renderTimeline(container, model, runId, "streaming");
    const textarea = container.querySelector("textarea[aria-label='prompt-input']") as HTMLTextAreaElement | null;
    const select = container.querySelector("select[aria-label='main-agent-picker']") as HTMLSelectElement | null;

    expect(durationMs).toBeLessThan(900);
    expect(textarea?.disabled).toBe(false);
    expect(select?.disabled).toBe(false);
    expect(container.querySelectorAll("[data-part-kind='text']").length).toBeGreaterThan(0);
    expect(container.querySelector(".transcript-part[data-part-kind='summary']")?.textContent).toContain("进行中");

    act(() => root.unmount());
  });

  it("大数据量 Markdown 解析性能基准", () => {
    const runId = "run-large-markdown";
    const markdownPayload = createMarkdownPayload();
    const model = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId,
        prompt: "请总结当前 SR 的风险与建议下一步动作。",
        events: [createEvent(1, {
          runId,
          type: "result",
          message: markdownPayload,
          data: { message_id: "msg-markdown-1" }
        })],
        status: "done",
        runStatus: "done",
        streamStatus: "done",
        finalOutput: markdownPayload,
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    const { root, durationMs } = renderTimeline(container, model, runId, "done");

    expect(durationMs).toBeLessThan(900);
    expect(container.querySelector("pre")).toBeTruthy();
    expect(container.textContent).toContain("大体量 Markdown");
    expect(container.textContent).toContain("log line 999");

    act(() => root.unmount());
  });

  it("长会话内存管理与 DOM 负载优化", () => {
    const historicalSegments: BuildChatStreamItemsOptions[] = Array.from({ length: 40 }, (_, index) => ({
      runId: `run-history-${index + 1}`,
      prompt: `历史问题 ${index + 1}`,
      events: [
        createEvent(1, {
          runId: `run-history-${index + 1}`,
          type: "thinking",
          message: `历史思考 ${index + 1}`
        }),
        createEvent(2, {
          runId: `run-history-${index + 1}`,
          type: "result",
          message: `历史结果 ${index + 1}`,
          data: { message_id: `msg-history-${index + 1}` }
        })
      ],
      status: "done",
      finalOutput: `历史结果 ${index + 1}`
    }));

    const firstModel = buildStableTranscriptProjection({
      historicalSegments,
      liveSegment: {
        runId: "run-live-1",
        prompt: "当前问题",
        events: [createEvent(1, { runId: "run-live-1", message: "初始实时输出" })],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    const secondModel = buildStableTranscriptProjection({
      historicalSegments,
      liveSegment: {
        runId: "run-live-1",
        prompt: "当前问题",
        events: [
          createEvent(1, { runId: "run-live-1", message: "初始实时输出" }),
          createEvent(2, { runId: "run-live-1", message: "新增实时输出" })
        ],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      },
      previousModel: firstModel
    });

    expect(secondModel.historicalParts.map((part) => part.id)).toEqual(firstModel.historicalParts.map((part) => part.id));
    expect(new Set(secondModel.parts.map((part) => part.id)).size).toBe(secondModel.parts.length);
    expect(secondModel.parts.length).toBeLessThan(firstModel.parts.length + 4);

    const { root, durationMs } = renderTimeline(container, secondModel, "run-live-1", "streaming");
    expect(durationMs).toBeLessThan(700);
    expect(container.textContent).toContain("历史结果 40");
    expect(container.textContent).toContain("新增实时输出");

    act(() => root.unmount());
  });

  it("高频 Tool-Call 事件的“节流”处理", () => {
    const runId = "run-tool-burst";
    const toolEvents = Array.from({ length: 10 }, (_, index) => createEvent(index + 1, {
      runId,
      type: "tool_call",
      title: `tool-${index + 1}`,
      message: `查询 ECU 状态 ${index + 1}`,
      semantic: {
        channel: "tool",
        emissionKind: "delta",
        identity: `tool:${index + 1}`,
        itemKind: "tool",
        messageId: `tool-${index + 1}`,
        partId: `tool-part-${index + 1}`
      }
    }));
    const model = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId,
        prompt: "请总结当前 SR 的风险与建议下一步动作。",
        events: [
          ...toolEvents,
          createEvent(11, {
            runId,
            type: "result",
            message: "最终助手回答",
            data: { message_id: "msg-tool-burst" }
          })
        ],
        status: "done",
        runStatus: "done",
        streamStatus: "done",
        finalOutput: "最终助手回答",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    const { root, durationMs } = renderTimeline(container, model, runId, "done");
    const visiblePartKinds = Array.from(container.querySelectorAll("[data-section='part']")).map((node) => node.getAttribute("data-part-kind"));

    expect(durationMs).toBeLessThan(400);
    expect(container.querySelector("[data-part-kind='tool']")).toBeNull();
    expect(visiblePartKinds).toEqual(["prompt", "text", "summary"]);
    expect(container.textContent).toContain("最终助手回答");
    expect(container.textContent).not.toContain("查询 ECU 状态 10");

    act(() => root.unmount());
  });

  it("从 streaming 降级态收敛到最终 Markdown 后，语义与交互不变", () => {
    const runId = "run-streaming-convergence";
    const projector = createOpencodeRawEventProjector(runId);
    const partialEvents = [
      ...projector.project({
        id: "raw-1",
        runId,
        createdAt: "2026-04-01T00:00:00.000Z",
        sequence: 1,
        source: "opencode",
        eventType: "message.part.delta",
        payload: {
          event: {
            payload: {
              type: "message.part.delta",
              properties: {
                sessionID: "ses-1",
                messageID: "msg-1",
                partID: "part-1",
                field: "text",
                delta: "# 标题\n\n```ts\nconst value = 1"
              }
            }
          }
        }
      }),
      ...projector.project({
        id: "raw-2",
        runId,
        createdAt: "2026-04-01T00:00:01.000Z",
        sequence: 2,
        source: "opencode",
        eventType: "message.part.updated",
        payload: {
          event: {
            payload: {
              type: "message.part.updated",
              properties: {
                sessionID: "ses-1",
                messageID: "msg-1",
                part: {
                  id: "part-1",
                  type: "text",
                  text: "# 标题\n\n```ts\nconst value = 1"
                }
              }
            }
          }
        }
      })
    ];
    const finalMarkdown = "# 标题\n\n```ts\nconst value = 1;\n```\n\n- 第一项\n- 第二项";
    const finalEvents = projector.project({
      id: "raw-3",
      runId,
      createdAt: "2026-04-01T00:00:02.000Z",
      sequence: 3,
      source: "opencode",
      eventType: "session.idle",
      payload: {
        event: {
          payload: {
            type: "session.idle",
            properties: { sessionID: "ses-1" }
          }
        }
      }
    }).map((event) => event.type === "result" ? { ...event, message: finalMarkdown } : event);

    const streamingModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId,
        prompt: "请总结当前 SR 的风险与建议下一步动作。",
        events: partialEvents,
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      }
    });
    const finalModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId,
        prompt: "请总结当前 SR 的风险与建议下一步动作。",
        events: [...partialEvents, ...finalEvents],
        status: "done",
        runStatus: "done",
        streamStatus: "done",
        finalOutput: finalMarkdown,
        includeSummary: true,
        includeToolCallParts: false
      },
      previousModel: streamingModel
    });

    const streamingParts = streamingModel.parts.filter((part) => part.kind === "text");
    const finalParts = finalModel.parts.filter((part) => part.kind === "text");
    const { root } = renderTimeline(container, finalModel, runId, "done", { finalOutput: finalMarkdown, streamStatus: "done" });
    const visibleParts = getVisibleParts(container);

    expect(streamingParts).toHaveLength(1);
    expect(finalParts).toHaveLength(1);
    expect(finalParts[0]?.text).toBe(finalMarkdown);
    expect(new Set(finalModel.parts.map((part) => part.id)).size).toBe(finalModel.parts.length);
    expect(visibleParts.map((part) => part.kind)).toEqual(["prompt", "text", "summary"]);
    expect(container.textContent).toContain("第一项");
    expect(container.querySelectorAll("pre")).toHaveLength(1);

    act(() => root.unmount());
  });

  it("最终大 Markdown 终态保真", () => {
    const runId = "run-rich-markdown";
    const markdownPayload = createRichMarkdownPayload();
    const model = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId,
        prompt: "请总结当前 SR 的风险与建议下一步动作。",
        events: [createEvent(1, {
          runId,
          type: "result",
          message: markdownPayload,
          data: { message_id: "msg-markdown-rich" }
        })],
        status: "done",
        runStatus: "done",
        streamStatus: "done",
        finalOutput: markdownPayload,
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    const { root } = renderTimeline(container, model, runId, "done", { finalOutput: markdownPayload, streamStatus: "done" });

    expect(container.querySelector("h1")?.textContent).toContain("大体量 Markdown");
    expect(container.textContent).toContain("风险摘要");
    expect(container.querySelector("blockquote")?.textContent).toContain("需要优先核对");
    expect(container.querySelector("ul li")?.textContent).toContain("第一项");
    expect(container.querySelector("ol li")?.textContent).toContain("操作一");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/diagnostics");
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelector("pre")?.textContent).toContain("log line 999");
    expect(container.querySelector("code")?.textContent).toContain("inline code");
    expect(container.querySelector("[data-raw-html='unsafe']")).toBeNull();

    act(() => root.unmount());
  });

  it("人工追问事件（Question）的阻断性交互", () => {
    const runId = "run-question-blocking";
    const onQuestionSubmit = vi.fn();
    const model = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId,
        prompt: "请总结当前 SR 的风险与建议下一步动作。",
        events: [createQuestionEvent(1, runId)],
        status: "waiting_for_answer",
        runStatus: "waiting_for_answer",
        streamStatus: "waiting_for_answer",
        pendingQuestionId: "question-1",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    const { root } = renderTimeline(container, model, runId, "waiting_for_answer", {
      pendingQuestionId: "question-1",
      onQuestionSubmit,
      questionSubmitDisabled: false,
      streamStatus: "waiting_for_answer"
    });
    const submitButton = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.includes("提交回答")) as HTMLButtonElement | undefined;

    expect(container.textContent).toContain("等待补充");
    expect(container.textContent).toContain("是否继续执行高危漏洞补丁注入");
    expect(submitButton).toBeTruthy();

    act(() => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onQuestionSubmit).toHaveBeenCalledWith({ answer: "continue", choiceId: "approve" });

    act(() => root.unmount());
  });

  it("会话历史（History）的本地持久化读取", async () => {
    const store = createIndexedDbHistoryStore();
    const targetRun = createHistoryRun("run-history-target", 41);
    await store.saveRun(targetRun);
    await store.saveEvent({
      id: "history-event-1",
      runId: targetRun.runId,
      type: "result",
      createdAt: "2026-04-01T00:00:02.000Z",
      sequence: 1,
      message: targetRun.finalOutput,
      data: { message_id: "msg-history-target" }
    });

    const startedAt = performance.now();
    const detail = await store.getRunDetail(targetRun.runId);
    const durationMs = performance.now() - startedAt;
    const model = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: targetRun.runId,
        prompt: targetRun.prompt,
        events: detail?.events ?? [],
        status: "done",
        runStatus: "done",
        streamStatus: "done",
        finalOutput: targetRun.finalOutput,
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    const { root } = renderTimeline(container, model, targetRun.runId, "done", {
      finalOutput: targetRun.finalOutput,
      streamStatus: "done"
    });

    expect(durationMs).toBeLessThan(700);
    expect(detail?.run.runId).toBe(targetRun.runId);
    expect(container.querySelector("h1")?.textContent).toContain("历史结果 41");
    expect(container.querySelector("ul li")?.textContent).toContain("已完成");

    act(() => root.unmount());
  });

  it("诊断日志（Diagnostics）的导出完整性", () => {
    const state = createDiagnosticsState();
    const snapshot = buildRunDiagnosticsSnapshot({
      source: {
        scope: "live",
        run: state.currentRun!,
        events: state.runEvents,
        answers: state.answers,
        assistantStatus: state.status,
        streamStatus: state.stream.status,
        pendingQuestionId: state.stream.pendingQuestionId
      },
      sidepanelState: state,
      backgroundState: state,
      transcriptReadModel: buildStableTranscriptProjection({
        historicalSegments: [],
        liveSegment: {
          runId: state.currentRun!.runId,
          prompt: state.currentRun!.prompt,
          events: state.runEvents,
          answers: state.answers,
          finalOutput: state.currentRun!.finalOutput,
          errorMessage: state.currentRun!.errorMessage,
          status: "error",
          runStatus: "error",
          streamStatus: "error",
          includeSummary: true,
          includeToolCallParts: false
        }
      }),
      renderTrace: state.renderTrace,
      exportedAt: "2026-04-02T00:00:06.000Z"
    });
    const log = formatRunDiagnosticsLog(snapshot);

    expect(log).toContain("=== RUN_METADATA ===");
    expect(log).toContain("=== OBSERVABILITY ===");
    expect(log).toContain("event-error");
    expect(log).toContain("apiBaseUrl");
    expect(log).toContain("SidepanelTransport.handleError");
  });

  it("SSE 连接意外中断的容错处理", () => {
    const runId = "run-sse-interruption";
    const partialEvents = [createEvent(1, {
      runId,
      message: "已接收的部分 Markdown",
      semantic: {
        channel: "assistant_text",
        emissionKind: "delta",
        identity: "assistant_text:msg-1:part-1",
        itemKind: "text",
        messageId: "msg-1",
        partId: "part-1"
      }
    })];
    const model = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId,
        prompt: "请总结当前 SR 的风险与建议下一步动作。",
        events: [...partialEvents, createEvent(2, { runId, type: "error", message: "连接中断，请重试" })],
        status: "error",
        runStatus: "error",
        streamStatus: "error",
        errorMessage: "连接中断，请重试",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    const { root } = renderTimeline(container, model, runId, "error", {
      streamStatus: "error",
      errorMessage: "连接中断，请重试"
    });

    expect(container.textContent).toContain("已接收的部分 Markdown");
    expect(container.textContent).toContain("已中断");
    expect(container.textContent).toContain("连接中断，请重试");
    expect(container.textContent).not.toContain("进行中");

    act(() => root.unmount());
  });

  it("真实浏览器下的大 Markdown 流式交互无卡死", () => {
    const runId = "run-large-markdown-live";
    const finalOutput = createRichMarkdownPayload();
    const events = Array.from({ length: 80 }, (_, index) => createEvent(index + 1, {
      runId,
      message: `${index === 79 ? finalOutput : `增量段 ${index + 1}\n\n| a | b |\n|---|---|\n| ${index} | ${index + 1} |`}`,
      semantic: {
        channel: "assistant_text",
        emissionKind: index === 79 ? "snapshot" : "delta",
        identity: `assistant_text:msg-large:part-${index + 1}`,
        itemKind: "text",
        messageId: "msg-large",
        partId: `part-${index + 1}`
      }
    }));
    const streamingModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId,
        prompt: "请总结当前 SR 的风险与建议下一步动作。",
        events,
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      }
    });
    const finalModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId,
        prompt: "请总结当前 SR 的风险与建议下一步动作。",
        events: [...events, createEvent(81, { runId, type: "result", message: finalOutput, data: { message_id: "msg-large" } })],
        status: "done",
        runStatus: "done",
        streamStatus: "done",
        finalOutput,
        includeSummary: true,
        includeToolCallParts: false
      },
      previousModel: streamingModel
    });

    const { root, durationMs } = renderTimeline(container, finalModel, runId, "done", { finalOutput, streamStatus: "done" });
    const textarea = container.querySelector("textarea[aria-label='prompt-input']") as HTMLTextAreaElement | null;
    const select = container.querySelector("select[aria-label='main-agent-picker']") as HTMLSelectElement | null;

    expect(durationMs).toBeLessThan(700);
    expect(textarea?.disabled).toBe(false);
    expect(select?.disabled).toBe(false);
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelector("pre")).toBeTruthy();
    expect(finalModel.finalAnswerPart?.text).toContain("风险摘要");
    expect(finalModel.finalAnswerPart?.text).toContain("log line 999");

    act(() => root.unmount());
  });

  it("域名授权与访问控制逻辑", () => {
    const result = evaluatePageAccess("https://www.google.com", ["https://*.company.com/*"]);

    expect(result.allowed).toBe(false);
    expect(result.code).toBe("PERMISSION_ERROR");
    expect(result.message).toContain("当前站点未授权采集");
  });

  it("未完成 Markdown 在 streaming 阶段的降级渲染策略", () => {
    const runId = "run-live-tail-degradation";
    const partialTail = "```ts\nconst answer = 1";
    const finalOutput = "```ts\nconst answer = 1;\n```\n\n| 列1 | 列2 |\n|---|---|\n| A | B |";
    const streamingModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId,
        prompt: "请总结当前 SR 的风险与建议下一步动作。",
        events: [createEvent(1, {
          runId,
          message: partialTail,
          semantic: {
            channel: "assistant_text",
            emissionKind: "delta",
            identity: "assistant_text:msg-live-tail:part-1",
            itemKind: "text",
            messageId: "msg-live-tail",
            partId: "part-1"
          }
        })],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      }
    });
    const finalModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId,
        prompt: "请总结当前 SR 的风险与建议下一步动作。",
        events: [
          createEvent(1, {
            runId,
            message: partialTail,
            semantic: {
              channel: "assistant_text",
              emissionKind: "delta",
              identity: "assistant_text:msg-live-tail:part-1",
              itemKind: "text",
              messageId: "msg-live-tail",
              partId: "part-1"
            }
          }),
          createEvent(2, { runId, type: "result", message: finalOutput, data: { message_id: "msg-live-tail" } })
        ],
        status: "done",
        runStatus: "done",
        streamStatus: "done",
        finalOutput,
        includeSummary: true,
        includeToolCallParts: false
      },
      previousModel: streamingModel
    });

    const { root: streamingRoot } = renderTimeline(container, streamingModel, runId, "streaming", { streamStatus: "streaming" });
    expect(container.textContent).toContain("const answer = 1");
    expect(container.querySelector("code")?.textContent).toContain("const answer = 1");
    act(() => streamingRoot.unmount());

    const { root: finalRoot } = renderTimeline(container, finalModel, runId, "done", { finalOutput, streamStatus: "done" });
    expect(container.querySelector("pre")?.textContent).toContain("const answer = 1;");
    expect(container.querySelector("table")).toBeTruthy();
    act(() => finalRoot.unmount());
  });
});
