import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NormalizedRunEvent } from "../shared/protocol";
import { buildStableTranscriptProjection, type BuildChatStreamItemsOptions, type TranscriptReadModel } from "./reasoningTimeline";
import { ReasoningTimeline } from "./reasoningTimelineView";

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

function renderTimeline(container: HTMLDivElement, model: TranscriptReadModel, runId: string, runStatus: "streaming" | "done") {
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
        />
      </div>
    );
  });

  return {
    root,
    durationMs: performance.now() - startedAt
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

    expect(durationMs).toBeLessThan(200);
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

    expect(durationMs).toBeLessThan(200);
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
    expect(durationMs).toBeLessThan(200);
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

    expect(durationMs).toBeLessThan(200);
    expect(container.querySelector("[data-part-kind='tool']")).toBeNull();
    expect(visiblePartKinds).toEqual(["prompt", "text", "summary"]);
    expect(container.textContent).toContain("最终助手回答");
    expect(container.textContent).not.toContain("查询 ECU 状态 10");

    act(() => root.unmount());
  });
});
