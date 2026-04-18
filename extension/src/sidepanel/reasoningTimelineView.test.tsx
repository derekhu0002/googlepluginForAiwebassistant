import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api", () => ({
  submitMessageFeedback: vi.fn(async () => ({ ok: true, data: { feedback: "like" } }))
}));

const { ReasoningTimeline } = await import("./reasoningTimelineView");
const { buildStableTranscriptProjection } = await import("./reasoningTimeline");

function createRafController() {
  let frameId = 0;
  const queue = new Map<number, FrameRequestCallback>();

  return {
    request(callback: FrameRequestCallback) {
      frameId += 1;
      queue.set(frameId, callback);
      return frameId;
    },
    cancel(id: number) {
      queue.delete(id);
    },
    flush(time = 0) {
      const entries = [...queue.entries()];
      queue.clear();
      for (const [, callback] of entries) {
        callback(time);
      }
    },
    size() {
      return queue.size;
    }
  };
}

function createEvent(sequence: number, overrides: Partial<import("../shared/protocol").NormalizedRunEvent> = {}) {
  return {
    id: overrides.id ?? `event-${sequence}`,
    runId: overrides.runId ?? "run-current",
    type: overrides.type ?? "thinking",
    createdAt: overrides.createdAt ?? `2026-04-02T00:00:0${sequence}.000Z`,
    sequence,
    message: overrides.message ?? "",
    ...overrides
  } satisfies import("../shared/protocol").NormalizedRunEvent;
}

// @ArchitectureID: ELM-APP-EXT-CONVERSATION-RENDERER
// @ArchitectureID: ELM-APP-EXT-CONVERSATION-LIVE-HISTORY-UX
// @RequirementID: ELM-REQ-OPENCODE-UX
describe("ReasoningTimeline transcript rendering", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    // @ts-expect-error test-only React act environment flag
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    vi.unstubAllGlobals();
    vi.useRealTimers();
    container.remove();
  });

  it("renders transcript parts without avatar-like decoration markup", async () => {
    await act(async () => {
      root.render(
        <ReasoningTimeline
          runId="run-1"
          prompt="请回答"
          events={[
            {
              id: "event-1",
              runId: "run-1",
              type: "result",
              createdAt: "2026-04-02T00:00:01.000Z",
              sequence: 1,
              message: "最终回答",
              data: { message_id: "msg-1" }
            }
          ]}
          runStatus="done"
          finalOutput="最终回答"
        />
      );
    });

    expect(container.querySelector(".transcript-part-decoration")).toBeNull();
    expect(container.querySelector(".transcript-part-anchor")).toBeNull();
    expect(container.querySelector(".transcript-part-rail")).toBeNull();
    expect(container.textContent).toContain("最终回答");
  });

  it("adds role-specific alignment classes for user and assistant messages", async () => {
    await act(async () => {
      root.render(
        <ReasoningTimeline
          runId="run-1"
          prompt="请回答"
          events={[
            {
              id: "event-1",
              runId: "run-1",
              type: "result",
              createdAt: "2026-04-02T00:00:01.000Z",
              sequence: 1,
              message: "最终回答",
              data: { message_id: "msg-1" }
            }
          ]}
          runStatus="done"
          finalOutput="最终回答"
        />
      );
    });

    expect(container.querySelector(".transcript-part[data-part-role='user']")?.classList.contains("transcript-part-user")).toBe(true);
    expect(container.querySelector(".transcript-part[data-part-role='assistant']")?.classList.contains("transcript-part-assistant")).toBe(true);
  });

  it("renders user prompts as compact cards and assistant content as flat markdown flow", async () => {
    await act(async () => {
      root.render(
        <ReasoningTimeline
          runId="run-1"
          prompt="用户提问"
          events={[
            {
              id: "event-1",
              runId: "run-1",
              type: "thinking",
              createdAt: "2026-04-02T00:00:01.000Z",
              sequence: 1,
              message: "# 助手回答",
              data: { field: "text", message_id: "msg-1" }
            }
          ]}
          runStatus="done"
          finalOutput="# 助手回答"
        />
      );
    });

    const userCopy = container.querySelector(".transcript-part[data-part-role='user'] .transcript-part-copy-user");
    const assistantCopy = container.querySelector(".transcript-part[data-part-role='assistant'] .transcript-part-copy-assistant.markdown-body");

    expect(userCopy).toBeTruthy();
    expect(userCopy?.classList.contains("transcript-part-copy-assistant")).toBe(false);
    expect(assistantCopy).toBeTruthy();
    expect(assistantCopy?.classList.contains("transcript-part-copy-user")).toBe(false);
    expect(container.querySelector(".transcript-part[data-part-role='assistant'] h1")?.textContent).toBe("助手回答");
  });

  it("renders only supplied session segments without duplicating the current run base transcript", async () => {
    await act(async () => {
      root.render(
        <ReasoningTimeline
          runId="run-current"
          prompt="当前问题"
          events={[
            {
              id: "event-current",
              runId: "run-current",
              type: "result",
              createdAt: "2026-04-02T00:00:02.000Z",
              sequence: 2,
              message: "当前回答",
              data: { message_id: "msg-current" }
            }
          ]}
          runSegments={[
            {
              runId: "run-previous",
              prompt: "历史问题",
              events: [
                {
                  id: "event-previous",
                  runId: "run-previous",
                  type: "result",
                  createdAt: "2026-04-02T00:00:01.000Z",
                  sequence: 1,
                  message: "历史回答",
                  data: { message_id: "msg-previous" }
                }
              ],
              status: "done",
              finalOutput: "历史回答"
            },
            {
              runId: "run-current",
              prompt: "当前问题",
              events: [
                {
                  id: "event-current",
                  runId: "run-current",
                  type: "result",
                  createdAt: "2026-04-02T00:00:02.000Z",
                  sequence: 2,
                  message: "当前回答",
                  data: { message_id: "msg-current" }
                }
              ],
              status: "done",
              finalOutput: "当前回答"
            }
          ]}
          runStatus="done"
          finalOutput="当前回答"
        />
      );
    });

    expect(container.textContent).toContain("历史回答");
    expect(container.textContent).toContain("当前回答");
    expect(container.textContent?.match(/当前回答/g)?.length).toBe(1);
  });

  it("renders from stable projected read model without requiring whole-transcript rerender inputs", async () => {
    const transcriptReadModel = buildStableTranscriptProjection({
      historicalSegments: [{
        runId: "run-history",
        prompt: "历史问题",
        events: [{
          id: "event-history",
          runId: "run-history",
          type: "result",
          createdAt: "2026-04-02T00:00:01.000Z",
          sequence: 1,
          message: "历史回答",
          data: { message_id: "msg-history" }
        }],
        status: "done",
        finalOutput: "历史回答"
      }],
      liveSegment: {
        runId: "run-current",
        prompt: "当前问题",
        events: [{
          id: "event-current",
          runId: "run-current",
          type: "thinking",
          createdAt: "2026-04-02T00:00:02.000Z",
          sequence: 2,
          message: "当前回答",
          data: { field: "text", message_id: "msg-current" }
        }],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: true
      }
    });

    await act(async () => {
      root.render(
        <ReasoningTimeline
          transcriptReadModel={transcriptReadModel}
          runId="run-current"
          prompt="当前问题"
          events={[]}
          runStatus="streaming"
        />
      );
    });

    expect(container.textContent).toContain("历史回答");
    expect(container.textContent).toContain("当前回答");
  });

  it("renders updated live tail from incremental transcript projection debug state", async () => {
    const firstModel = buildStableTranscriptProjection({
      historicalSegments: [{
        runId: "run-history",
        prompt: "历史问题",
        events: [{
          id: "event-history",
          runId: "run-history",
          type: "result",
          createdAt: "2026-04-02T00:00:01.000Z",
          sequence: 1,
          message: "历史回答",
          data: { message_id: "msg-history" }
        }],
        status: "done",
        finalOutput: "历史回答"
      }],
      liveSegment: {
        runId: "run-current",
        prompt: "当前问题",
        events: [{
          id: "event-current-1",
          runId: "run-current",
          type: "thinking",
          createdAt: "2026-04-02T00:00:02.000Z",
          sequence: 2,
          message: "第一段",
          data: { field: "text", message_id: "msg-current" }
        }],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: true
      }
    });

    const secondModel = buildStableTranscriptProjection({
      historicalSegments: [{
        runId: "run-history",
        prompt: "历史问题",
        events: [{
          id: "event-history",
          runId: "run-history",
          type: "result",
          createdAt: "2026-04-02T00:00:01.000Z",
          sequence: 1,
          message: "历史回答",
          data: { message_id: "msg-history" }
        }],
        status: "done",
        finalOutput: "历史回答"
      }],
      liveSegment: {
        runId: "run-current",
        prompt: "当前问题",
        events: [
          {
            id: "event-current-1",
            runId: "run-current",
            type: "thinking",
            createdAt: "2026-04-02T00:00:02.000Z",
            sequence: 2,
            message: "第一段",
            data: { field: "text", message_id: "msg-current" }
          },
          {
            id: "event-current-2",
            runId: "run-current",
            type: "thinking",
            createdAt: "2026-04-02T00:00:03.000Z",
            sequence: 3,
            message: "第二段",
            data: { field: "text", message_id: "msg-current" }
          }
        ],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: true
      },
      previousModel: firstModel
    });

    await act(async () => {
      root.render(
        <ReasoningTimeline
          transcriptReadModel={secondModel}
          runId="run-current"
          prompt="当前问题"
          events={[]}
          runStatus="streaming"
        />
      );
    });

    expect(secondModel.liveProjectionDebug).toMatchObject({ reusedPreviousStore: true, appliedDeltaEventCount: 1 });
    expect(container.textContent).toContain("历史回答");
    expect(container.textContent).toContain("第一段第二段");
  });

  it("renders final answer after inline reasoning and tool process parts", async () => {
    const transcriptReadModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-current",
        prompt: "当前问题",
        events: [
          createEvent(1, {
            type: "thinking",
            message: "先分析页面上下文",
            semantic: {
              channel: "reasoning",
              emissionKind: "delta",
              identity: "reasoning:msg-current:1",
              itemKind: "reasoning",
              messageId: "msg-current",
              partId: "reasoning-1"
            }
          }),
          createEvent(2, {
            type: "tool_call",
            message: "调用搜索工具",
            semantic: {
              channel: "tool",
              emissionKind: "delta",
              identity: "tool:msg-current:1",
              itemKind: "tool",
              messageId: "msg-current",
              partId: "tool-1"
            }
          }),
          createEvent(3, {
            type: "result",
            message: "最终回答",
            data: { message_id: "msg-current" }
          })
        ],
        status: "done",
        runStatus: "done",
        streamStatus: "done",
        finalOutput: "最终回答",
        includeSummary: true,
        includeToolCallParts: true
      }
    });

    await act(async () => {
      root.render(
        <ReasoningTimeline
          transcriptReadModel={transcriptReadModel}
          runId="run-current"
          prompt="当前问题"
          events={[]}
          runStatus="done"
        />
      );
    });

    expect(container.querySelector("[data-component='process-stream']")?.textContent).toContain("先分析页面上下文");
    expect(container.querySelector("[data-component='process-stream']")?.textContent).toContain("调用搜索工具");
    expect(container.querySelector("[data-part-kind='reasoning']")?.textContent).toContain("先分析页面上下文");
    expect(container.querySelector("[data-part-kind='tool']")?.textContent).toContain("调用搜索工具");
    expect(container.querySelector("[data-component='final-answer-panel']")?.textContent).toContain("最终回答");
  });

  it("renders one user article and one assistant article with inline process flow for a single run", async () => {
    const transcriptReadModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-single",
        prompt: "当前问题",
        events: [
          createEvent(1, {
            runId: "run-single",
            type: "thinking",
            message: "先分析",
            semantic: {
              channel: "reasoning",
              emissionKind: "delta",
              identity: "reasoning:msg-single:1",
              itemKind: "reasoning",
              messageId: "msg-single",
              partId: "reasoning-1"
            }
          }),
          createEvent(2, {
            runId: "run-single",
            type: "tool_call",
            message: "调用工具",
            semantic: {
              channel: "tool",
              emissionKind: "delta",
              identity: "tool:msg-single:1",
              itemKind: "tool",
              messageId: "msg-single",
              partId: "tool-1"
            }
          }),
          createEvent(3, {
            runId: "run-single",
            type: "thinking",
            message: "A",
            data: { field: "text", message_id: "msg-single" }
          })
        ],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: true
      }
    });

    await act(async () => {
      root.render(
        <ReasoningTimeline
          transcriptReadModel={transcriptReadModel}
          runId="run-single"
          prompt="当前问题"
          events={[]}
          runStatus="streaming"
        />
      );
    });

    const articles = container.querySelectorAll("article.transcript-message");
    expect(articles).toHaveLength(2);
    expect(container.querySelectorAll("article.transcript-message-user")).toHaveLength(1);
    expect(container.querySelectorAll("article.transcript-message-assistant")).toHaveLength(1);
    expect(container.querySelector("article.transcript-message-assistant article.transcript-message")).toBeNull();
    expect(container.querySelector("[data-component='process-stream']")?.textContent).toContain("调用工具");
    expect(container.querySelector("[data-component='final-answer-panel']")?.textContent).toContain("A");
  });

  it("keeps the assistant article stable across streaming growth and terminal finalize", async () => {
    const raf = createRafController();
    const performanceSpy = vi.spyOn(performance, "now");
    let now = 0;
    performanceSpy.mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => raf.request(callback)));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => raf.cancel(id)));

    const firstModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-grow",
        prompt: "当前问题",
        events: [createEvent(1, { runId: "run-grow", type: "thinking", message: "A", data: { field: "text", message_id: "msg-grow" } })],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    await act(async () => {
      root.render(<ReasoningTimeline transcriptReadModel={firstModel} runId="run-grow" prompt="当前问题" events={[]} runStatus="streaming" live />);
      now = 16;
      raf.flush(now);
    });

    const assistantArticleA = container.querySelector("article.transcript-message-assistant");
    const finalPanelA = container.querySelector("[data-component='final-answer-panel']");
    const rendererA = container.querySelector("[data-component='active-tail-renderer']");

    const secondModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-grow",
        prompt: "当前问题",
        events: [
          createEvent(1, { runId: "run-grow", type: "thinking", message: "A", data: { field: "text", message_id: "msg-grow" } }),
          createEvent(2, { runId: "run-grow", type: "thinking", message: "B", data: { field: "text", message_id: "msg-grow" } })
        ],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      },
      previousModel: firstModel
    });

    await act(async () => {
      root.render(<ReasoningTimeline transcriptReadModel={secondModel} runId="run-grow" prompt="当前问题" events={[]} runStatus="streaming" live />);
      now = 20;
      raf.flush(now);
      vi.runOnlyPendingTimers();
      now = 60;
      raf.flush(now);
      await Promise.resolve();
    });

    const assistantArticleB = container.querySelector("article.transcript-message-assistant");
    const finalPanelB = container.querySelector("[data-component='final-answer-panel']");
    const rendererB = container.querySelector("[data-component='active-tail-renderer']");
    expect(assistantArticleA).toBe(assistantArticleB);
    expect(finalPanelA).toBe(finalPanelB);
    expect(rendererA).toBe(rendererB);

    const thirdModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-grow",
        prompt: "当前问题",
        events: [
          createEvent(1, { runId: "run-grow", type: "thinking", message: "A", data: { field: "text", message_id: "msg-grow" } }),
          createEvent(2, { runId: "run-grow", type: "thinking", message: "B", data: { field: "text", message_id: "msg-grow" } }),
          createEvent(3, { runId: "run-grow", type: "result", message: "ABC", data: { message_id: "msg-grow" } })
        ],
        status: "done",
        runStatus: "done",
        streamStatus: "done",
        finalOutput: "ABC",
        includeSummary: true,
        includeToolCallParts: false
      },
      previousModel: secondModel
    });

    await act(async () => {
      root.render(<ReasoningTimeline transcriptReadModel={thirdModel} runId="run-grow" prompt="当前问题" events={[]} runStatus="done" live />);
      await Promise.resolve();
    });

    const assistantArticleC = container.querySelector("article.transcript-message-assistant");
    const finalPanelC = container.querySelector("[data-component='final-answer-panel']");
    expect(assistantArticleA).toBe(assistantArticleC);
    expect(finalPanelA).toBe(finalPanelC);
    expect(container.querySelector("[data-component='final-answer-panel']")?.textContent).toContain("ABC");
    performanceSpy.mockRestore();
  });

  it("does not rerender historical list during active tail updates", async () => {
    const historicalSegments = Array.from({ length: 200 }, (_, index) => ({
      runId: `run-history-${index}`,
      prompt: `历史问题${index}`,
      events: [createEvent(index + 1, {
        runId: `run-history-${index}`,
        type: "result",
        message: `历史回答${index}`,
        data: { message_id: `msg-history-${index}` }
      })],
      status: "done" as const,
      finalOutput: `历史回答${index}`
    }));

    const firstModel = buildStableTranscriptProjection({
      historicalSegments,
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [createEvent(1000, { runId: "run-live", type: "thinking", message: "A", data: { field: "text", message_id: "msg-live" } })],
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
        runId: "run-live",
        prompt: "当前问题",
        events: [
          createEvent(1000, { runId: "run-live", type: "thinking", message: "A", data: { field: "text", message_id: "msg-live" } }),
          createEvent(1001, { runId: "run-live", type: "thinking", message: "B", data: { field: "text", message_id: "msg-live" } })
        ],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      },
      previousModel: firstModel
    });

    await act(async () => {
      root.render(<ReasoningTimeline transcriptReadModel={firstModel} runId="run-live" prompt="当前问题" events={[]} runStatus="streaming" />);
    });

    const firstHistoricalNode = container.querySelector("[data-component='historical-transcript-list'] [data-message-id='message:run-history-0:assistant-message:run-history-0:msg-history-0:assistant']");

    await act(async () => {
      root.render(<ReasoningTimeline transcriptReadModel={secondModel} runId="run-live" prompt="当前问题" events={[]} runStatus="streaming" />);
    });

    const secondHistoricalNode = container.querySelector("[data-component='historical-transcript-list'] [data-message-id='message:run-history-0:assistant-message:run-history-0:msg-history-0:assistant']");
    expect(secondModel.historicalMessages).toBe(firstModel.historicalMessages);
    expect(firstHistoricalNode).toBe(secondHistoricalNode);
  }, 10000);

  it("flushes active tail markdown immediately on revision updates and terminal state", async () => {
    const raf = createRafController();
    const performanceSpy = vi.spyOn(performance, "now");
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => raf.request(callback));
    const cancelAnimationFrameMock = vi.fn((id: number) => raf.cancel(id));
    let now = 0;
    performanceSpy.mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrameMock);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);

    const firstModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [createEvent(1, { runId: "run-live", type: "thinking", message: "A", data: { field: "text", message_id: "msg-live" } })],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    await act(async () => {
      root.render(<ReasoningTimeline transcriptReadModel={firstModel} runId="run-live" prompt="当前问题" events={[]} runStatus="streaming" live />);
    });

    now = 16;
    const secondModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [
          createEvent(1, { runId: "run-live", type: "thinking", message: "A", data: { field: "text", message_id: "msg-live" } }),
          createEvent(2, { runId: "run-live", type: "thinking", message: "B", data: { field: "text", message_id: "msg-live" } })
        ],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      },
      previousModel: firstModel
    });

    await act(async () => {
      root.render(<ReasoningTimeline transcriptReadModel={secondModel} runId="run-live" prompt="当前问题" events={[]} runStatus="streaming" live />);
    });

    expect(container.querySelector("[data-component='active-tail-renderer']")?.textContent).toContain("AB");

    const terminalModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [
          createEvent(1, { runId: "run-live", type: "thinking", message: "A", data: { field: "text", message_id: "msg-live" } }),
          createEvent(2, { runId: "run-live", type: "result", message: "ABCD", data: { message_id: "msg-live" } })
        ],
        status: "done",
        runStatus: "done",
        streamStatus: "done",
        finalOutput: "ABCD",
        includeSummary: true,
        includeToolCallParts: false
      },
      previousModel: secondModel
    });

    await act(async () => {
      root.render(<ReasoningTimeline transcriptReadModel={terminalModel} runId="run-live" prompt="当前问题" events={[]} runStatus="done" live />);
    });

    expect(container.querySelector("[data-component='final-answer-panel']")?.textContent).toContain("ABCD");
    performanceSpy.mockRestore();
  });

  it("keeps scroll detached until latest message button is clicked", async () => {
    const raf = createRafController();
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => raf.request(callback)));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => raf.cancel(id)));
    const transcriptReadModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [createEvent(1, { runId: "run-live", type: "thinking", message: "A", data: { field: "text", message_id: "msg-live" } })],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    await act(async () => {
      root.render(<ReasoningTimeline transcriptReadModel={transcriptReadModel} runId="run-live" prompt="当前问题" events={[]} runStatus="streaming" live />);
    });

    const feed = container.querySelector(".chat-stream-feed") as HTMLDivElement;
    Object.defineProperty(feed, "scrollHeight", { configurable: true, value: 1000 });
    Object.defineProperty(feed, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(feed, "scrollTop", { configurable: true, value: 300, writable: true });

    await act(async () => {
      feed.dispatchEvent(new Event("scroll"));
    });

    const nextModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [
          createEvent(1, { runId: "run-live", type: "thinking", message: "A", data: { field: "text", message_id: "msg-live" } }),
          createEvent(2, { runId: "run-live", type: "thinking", message: "B", data: { field: "text", message_id: "msg-live" } })
        ],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      },
      previousModel: transcriptReadModel
    });

    await act(async () => {
      root.render(<ReasoningTimeline transcriptReadModel={nextModel} runId="run-live" prompt="当前问题" events={[]} runStatus="streaming" live />);
    });

    const latestButton = container.querySelector("[data-component='latest-message-button']") as HTMLButtonElement | null;
    expect(latestButton).toBeTruthy();
    expect(feed.scrollTop).toBe(300);

    await act(async () => {
      latestButton?.click();
      raf.flush(32);
    });

    expect(feed.scrollTop).toBe(feed.scrollHeight);
  });

  it("aligns a new live assistant answer to the top of the viewport instead of jumping to the tail", async () => {
    const raf = createRafController();
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => raf.request(callback)));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => raf.cancel(id)));

    const transcriptReadModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [
          createEvent(1, { runId: "run-live", type: "thinking", message: "第一段", data: { field: "text", message_id: "msg-live" } }),
          createEvent(2, { runId: "run-live", type: "thinking", message: "第二段", data: { field: "text", message_id: "msg-live" } }),
          createEvent(3, { runId: "run-live", type: "thinking", message: "第三段", data: { field: "text", message_id: "msg-live" } })
        ],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    await act(async () => {
      root.render(<ReasoningTimeline transcriptReadModel={transcriptReadModel} runId="run-live" prompt="当前问题" events={[]} runStatus="streaming" live />);
    });

    const feed = container.querySelector(".chat-stream-feed") as HTMLDivElement;
    const activeMessage = container.querySelector(".transcript-message-active") as HTMLElement | null;
    expect(activeMessage).toBeTruthy();

    Object.defineProperty(feed, "scrollHeight", { configurable: true, value: 1500 });
    Object.defineProperty(feed, "clientHeight", { configurable: true, value: 420 });
    Object.defineProperty(feed, "scrollTop", { configurable: true, value: 0, writable: true });
    Object.defineProperty(activeMessage as HTMLElement, "offsetTop", { configurable: true, value: 160 });

    await act(async () => {
      raf.flush(32);
    });

    expect(feed.scrollTop).toBe(160);
    expect(feed.scrollTop).not.toBe(feed.scrollHeight);
  });

  it("renders reasoning and suppresses tool parts in the main transcript", async () => {
    await act(async () => {
      root.render(
        <ReasoningTimeline
          runId="run-1"
          prompt="请分析"
          events={[
            {
              id: "event-1",
              runId: "run-1",
              type: "thinking",
              createdAt: "2026-04-02T00:00:01.000Z",
              sequence: 1,
              message: "我先读取页面上下文，再整理结论。"
            },
            {
              id: "event-2",
              runId: "run-1",
              type: "tool_call",
              createdAt: "2026-04-02T00:00:02.000Z",
              sequence: 2,
              message: "查询历史 SR"
            },
            {
              id: "event-3",
              runId: "run-1",
              type: "result",
              createdAt: "2026-04-02T00:00:03.000Z",
              sequence: 3,
              message: "最终结论",
              data: { message_id: "msg-1" }
            }
          ]}
          runStatus="done"
          finalOutput="最终结论"
        />
      );
    });

    expect(container.querySelector("[data-part-kind='reasoning']")?.textContent).toContain("我先读取页面上下文，再整理结论。");
    expect(container.querySelector("[data-part-kind='tool']")).toBeNull();
    expect(container.querySelector("[data-part-kind='text']")?.textContent).toContain("最终结论");
  });

  it("renders merged assistant text chunks as one displayed assistant message", async () => {
    const transcriptReadModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-current",
        prompt: "当前问题",
        events: [
          {
            id: "event-current-1",
            runId: "run-current",
            type: "thinking",
            createdAt: "2026-04-02T00:00:02.000Z",
            sequence: 2,
            message: "第一段",
            semantic: {
              channel: "assistant_text",
              emissionKind: "delta",
              identity: "assistant_text:msg-current:part-1",
              itemKind: "text",
              messageId: "msg-current",
              partId: "part-1"
            }
          },
          {
            id: "event-current-2",
            runId: "run-current",
            type: "thinking",
            createdAt: "2026-04-02T00:00:03.000Z",
            sequence: 3,
            message: "第二段",
            semantic: {
              channel: "assistant_text",
              emissionKind: "delta",
              identity: "assistant_text:msg-current:part-2",
              itemKind: "text",
              messageId: "msg-current",
              partId: "part-2"
            }
          }
        ],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    await act(async () => {
      root.render(
        <ReasoningTimeline
          transcriptReadModel={transcriptReadModel}
          runId="run-current"
          prompt="当前问题"
          events={[]}
          runStatus="streaming"
        />
      );
    });

    const assistantTextParts = container.querySelectorAll("[data-part-kind='text']");
    expect(assistantTextParts).toHaveLength(1);
    expect(assistantTextParts[0]?.textContent).toContain("第一段第二段");
  });

  it("keeps exactly one user bubble and one assistant bubble for adversarial mixed-order transcript", async () => {
    const transcriptReadModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-current",
        prompt: "当前问题",
        events: [
          {
            id: "event-current-1",
            runId: "run-current",
            type: "thinking",
            createdAt: "2026-04-02T00:00:02.000Z",
            sequence: 1,
            message: "第一段",
            semantic: {
              channel: "assistant_text",
              emissionKind: "delta",
              identity: "assistant_text:msg-current:part-1",
              itemKind: "text",
              messageId: "msg-current",
              partId: "part-1"
            }
          },
          {
            id: "event-current-2",
            runId: "run-current",
            type: "tool_call",
            createdAt: "2026-04-02T00:00:03.000Z",
            sequence: 2,
            message: "读取工具",
            semantic: {
              channel: "tool",
              emissionKind: "delta",
              identity: "tool:msg-current:tool-1",
              itemKind: "tool",
              messageId: "msg-current",
              partId: "tool-1"
            }
          },
          {
            id: "event-current-3",
            runId: "run-current",
            type: "thinking",
            createdAt: "2026-04-02T00:00:04.000Z",
            sequence: 3,
            message: "第二段",
            semantic: {
              channel: "assistant_text",
              emissionKind: "delta",
              identity: "assistant_text:msg-current:part-2",
              itemKind: "text",
              messageId: "msg-current",
              partId: "part-2"
            }
          }
        ],
        answers: [{
          id: "answer-empty",
          runId: "run-current",
          questionId: "q-empty",
          answer: "   ",
          submittedAt: "2026-04-02T00:00:05.000Z"
        }],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: true
      }
    });

    await act(async () => {
      root.render(
        <ReasoningTimeline
          transcriptReadModel={transcriptReadModel}
          runId="run-current"
          prompt="当前问题"
          events={[]}
          runStatus="streaming"
        />
      );
    });

    expect(container.querySelectorAll("[data-message-role='user']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-message-role='assistant']")).toHaveLength(1);
    expect(container.querySelectorAll(".transcript-part[data-part-role='user']")).toHaveLength(1);
    expect(container.querySelectorAll(".transcript-part[data-part-role='assistant']")).toHaveLength(4);
    expect(container.querySelectorAll("[data-part-kind='answer']")).toHaveLength(0);
    expect(container.querySelectorAll("[data-part-kind='text']")).toHaveLength(1);
    expect(container.querySelector("[data-part-kind='text']")?.textContent).toContain("第一段第二段");
  });

  it("deduplicates adjacent assistant text parts with the same anchor", async () => {
    const transcriptReadModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-dedupe",
        prompt: "当前问题",
        events: [
          {
            id: "event-dedupe-1",
            runId: "run-dedupe",
            type: "thinking",
            createdAt: "2026-04-02T00:00:02.000Z",
            sequence: 1,
            message: "重复段落",
            semantic: {
              channel: "assistant_text",
              emissionKind: "delta",
              identity: "assistant_text:msg-dedupe:part-1",
              itemKind: "text",
              messageId: "msg-dedupe",
              partId: "part-1"
            }
          },
          {
            id: "event-dedupe-2",
            runId: "run-dedupe",
            type: "thinking",
            createdAt: "2026-04-02T00:00:03.000Z",
            sequence: 2,
            message: "重复段落",
            semantic: {
              channel: "assistant_text",
              emissionKind: "snapshot",
              identity: "assistant_text:msg-dedupe:part-1",
              itemKind: "text",
              messageId: "msg-dedupe",
              partId: "part-1"
            }
          }
        ],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    await act(async () => {
      root.render(
        <ReasoningTimeline
          transcriptReadModel={transcriptReadModel}
          runId="run-dedupe"
          prompt="当前问题"
          events={[]}
          runStatus="streaming"
        />
      );
    });

    const duplicateAnchors = container.querySelectorAll("[data-part-anchor='msg-dedupe']");
    expect(duplicateAnchors).toHaveLength(1);
    expect(container.querySelector("[data-part-kind='text']")?.textContent).toContain("重复段落");
    expect(container.textContent).not.toContain("重复段落重复段落");
  });

  it("renders one continuous assistant text block when message ids churn before completion", async () => {
    const baseModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-render-churn",
        prompt: "当前问题",
        events: [
          createEvent(1, {
            runId: "run-render-churn",
            type: "thinking",
            message: "我先检查当前安全事件的上下文。",
            data: { field: "text", message_id: "msg-1" }
          }),
          createEvent(2, {
            runId: "run-render-churn",
            type: "tool_call",
            message: "读取上下文"
          }),
          createEvent(3, {
            runId: "run-render-churn",
            type: "thinking",
            message: "现在我需要确认现有证据是否完整。",
            data: { field: "text", message_id: "msg-2" }
          }),
          createEvent(4, {
            runId: "run-render-churn",
            type: "tool_call",
            message: "检查测试输入"
          }),
          createEvent(5, {
            runId: "run-render-churn",
            type: "result",
            message: "当前安全事件风险总结：建议立即隔离受影响资产并补充日志保全。",
            data: { message_id: "msg-3" }
          })
        ],
        status: "done",
        runStatus: "done",
        streamStatus: "done",
        finalOutput: "当前安全事件风险总结：建议立即隔离受影响资产并补充日志保全。",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    const userMessage = baseModel.messages.find((message) => message.role === "user");
    const assistantMessage = baseModel.messages.find((message) => message.role === "assistant");
    expect(userMessage).toBeTruthy();
    expect(assistantMessage).toBeTruthy();

    const assistantParts = [
      {
        ...assistantMessage!.parts[0],
        id: "assistant-part-1",
        anchorId: "msg-1",
        text: "我先检查当前安全事件的上下文。"
      },
      {
        ...assistantMessage!.parts[0],
        id: "assistant-part-2",
        anchorId: "msg-2",
        text: "现在我需要确认现有证据是否完整。",
        createdAt: "2026-04-02T00:00:03.000Z",
        updatedAt: "2026-04-02T00:00:03.000Z"
      },
      {
        ...assistantMessage!.parts[0],
        id: "assistant-part-3",
        anchorId: "msg-3",
        text: "当前安全事件风险总结：建议立即隔离受影响资产并补充日志保全。",
        createdAt: "2026-04-02T00:00:04.000Z",
        updatedAt: "2026-04-02T00:00:04.000Z"
      }
    ];

    const transcriptReadModel = {
      ...baseModel,
      messages: [
        userMessage!,
        {
          ...assistantMessage!,
          parts: assistantParts,
          updatedAt: "2026-04-02T00:00:04.000Z"
        }
      ],
      sealedMessages: [
        userMessage!,
        {
          ...assistantMessage!,
          parts: assistantParts,
          updatedAt: "2026-04-02T00:00:04.000Z"
        }
      ],
      parts: [userMessage!.parts[0], ...assistantParts],
      finalAnswerPart: null,
      processParts: [],
      questionPart: null,
      errorPart: null,
      tailPatch: null,
      activeMessage: null,
      activeAssistantMessageId: null
    };

    await act(async () => {
      root.render(
        <ReasoningTimeline
          transcriptReadModel={transcriptReadModel}
          runId="run-render-churn"
          prompt="当前问题"
          events={[]}
          runStatus="done"
        />
      );
    });

    const assistantTextParts = container.querySelectorAll(".transcript-part[data-part-kind='text']");
    expect(assistantTextParts).toHaveLength(1);
    expect(container.textContent).toContain("我先检查当前安全事件的上下文。");
    expect(container.textContent).toContain("现在我需要确认现有证据是否完整。");
    expect(container.textContent).toContain("当前安全事件风险总结：建议立即隔离受影响资产并补充日志保全。");
  });

  it("keeps active assistant DOM boundary stable across tail-only updates", async () => {
    const raf = createRafController();
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => raf.request(callback)));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => raf.cancel(id)));
    const firstModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-current",
        prompt: "当前问题",
        events: [{
          id: "event-current-1",
          runId: "run-current",
          type: "thinking",
          createdAt: "2026-04-02T00:00:02.000Z",
          sequence: 1,
          message: "A",
          data: { field: "text", message_id: "msg-current" }
        }],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    await act(async () => {
      root.render(
        <ReasoningTimeline
          transcriptReadModel={firstModel}
          runId="run-current"
          prompt="当前问题"
          events={[]}
          runStatus="streaming"
          live
        />
      );
      raf.flush(16);
    });

    const firstAssistantMessage = container.querySelector("[data-message-role='assistant']");

    const secondModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-current",
        prompt: "当前问题",
        events: [
          {
            id: "event-current-1",
            runId: "run-current",
            type: "thinking",
            createdAt: "2026-04-02T00:00:02.000Z",
            sequence: 1,
            message: "A",
            data: { field: "text", message_id: "msg-current" }
          },
          {
            id: "event-current-2",
            runId: "run-current",
            type: "thinking",
            createdAt: "2026-04-02T00:00:03.000Z",
            sequence: 2,
            message: "B",
            data: { field: "text", message_id: "msg-current" }
          }
        ],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      },
      previousModel: firstModel
    });

    await act(async () => {
      root.render(
        <ReasoningTimeline
          transcriptReadModel={secondModel}
          runId="run-current"
          prompt="当前问题"
          events={[]}
          runStatus="streaming"
          live
        />
      );
      raf.flush(20);
      vi.runOnlyPendingTimers();
      raf.flush(60);
      await Promise.resolve();
    });

    const secondAssistantMessage = container.querySelector("[data-message-role='assistant']");
    expect(container.querySelectorAll("[data-message-role='assistant']")).toHaveLength(1);
    expect(firstAssistantMessage?.getAttribute("data-message-id")).toBe(secondAssistantMessage?.getAttribute("data-message-id"));
  });

  it("renders exactly one assistant article when one run emits multiple semantic message ids", async () => {
    const transcriptReadModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-current",
        prompt: "当前问题",
        events: [
          createEvent(1, {
            runId: "run-current",
            type: "thinking",
            message: "第一段",
            semantic: {
              channel: "assistant_text",
              emissionKind: "delta",
              identity: "assistant_text:msg-1:part-1",
              itemKind: "text",
              messageId: "msg-1",
              partId: "part-1"
            }
          }),
          createEvent(2, {
            runId: "run-current",
            type: "tool_call",
            message: "调用工具",
            semantic: {
              channel: "tool",
              emissionKind: "delta",
              identity: "tool:msg-2:tool-1",
              itemKind: "tool",
              messageId: "msg-2",
              partId: "tool-1"
            }
          }),
          createEvent(3, {
            runId: "run-current",
            type: "result",
            message: "最终回答",
            semantic: {
              channel: "assistant_text",
              emissionKind: "final",
              identity: "assistant_text:msg-3:final",
              itemKind: "text",
              messageId: "msg-3",
              partId: "final"
            },
            data: { message_id: "msg-3" }
          })
        ],
        status: "done",
        runStatus: "done",
        streamStatus: "done",
        finalOutput: "最终回答",
        includeSummary: true,
        includeToolCallParts: true
      }
    });

    await act(async () => {
      root.render(
        <ReasoningTimeline
          transcriptReadModel={transcriptReadModel}
          runId="run-current"
          prompt="当前问题"
          events={[]}
          runStatus="done"
        />
      );
    });

    expect(container.querySelectorAll("[data-message-role='assistant']")).toHaveLength(1);
    expect(transcriptReadModel.messages.find((message) => message.role === "assistant")?.id).toBe("message:run-current:assistant-run:run-current:assistant");
    expect(container.querySelector("[data-message-role='assistant']")?.getAttribute("data-message-id")).toBe("sealed-assistant");
    expect(container.querySelector("[data-component='process-stream'] [data-part-kind='tool']")?.textContent).toContain("调用工具");
    expect(container.querySelector("[data-component='final-answer-panel']")?.textContent).toContain("最终回答");
  });

  it("marks transcript messages with actions as focusable hover targets for action visibility", async () => {
    await act(async () => {
      root.render(
        <ReasoningTimeline
          runId="run-1"
          prompt="请回答"
          events={[
            {
              id: "event-1",
              runId: "run-1",
              type: "result",
              createdAt: "2026-04-02T00:00:01.000Z",
              sequence: 1,
              message: "最终回答",
              data: { message_id: "msg-1" }
            }
          ]}
          runStatus="done"
          finalOutput="最终回答"
        />
      );
    });

    const actionPart = container.querySelector(".transcript-part[data-has-message-actions='true']");
    expect(actionPart?.getAttribute("tabindex")).toBe("0");
    expect(actionPart?.querySelector(".transcript-part-footer-actions")).toBeTruthy();

    const summaryPart = container.querySelector(".transcript-part[data-part-kind='summary']");
    expect(summaryPart?.hasAttribute("tabindex")).toBe(false);
  });

  it("emits correlated render traces without changing visible transcript rendering", async () => {
    const onRenderTrace = vi.fn();
    const transcriptReadModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-current",
        prompt: "当前问题",
        events: [
          createEvent(1, {
            type: "thinking",
            message: "第一段",
            data: { field: "text", message_id: "msg-current" }
          }),
          createEvent(2, {
            type: "result",
            message: "最终回答",
            data: { message_id: "msg-current" }
          })
        ],
        status: "done",
        runStatus: "done",
        streamStatus: "done",
        finalOutput: "最终回答",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    await act(async () => {
      root.render(
        <ReasoningTimeline
          transcriptReadModel={transcriptReadModel}
          runId="run-current"
          prompt="当前问题"
          events={[]}
          runStatus="done"
          onRenderTrace={onRenderTrace}
        />
      );
    });

    expect(container.textContent).toContain("最终回答");
    expect(onRenderTrace).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ stage: "render", step: "render_path" }),
      expect.objectContaining({ stage: "render", step: "visible_order", outcome: "visible" }),
      expect.objectContaining({ stage: "render", step: "tail_revision" })
    ]));
  });

  // @ArchitectureID: ELM-APP-EXT-CONVERSATION-RENDERER
  // @ArchitectureID: ELM-APP-EXT-CONVERSATION-LIVE-HISTORY-UX
  it("keeps transcript action controls hidden by default and reveals them only on hover or focus-within selectors", () => {
    const css = readFileSync(path.join(process.cwd(), "src/sidepanel/style/transcript.css"), "utf8");

    expect(css).toMatch(/\.transcript-part-footer-actions\s*\{[^}]*opacity:\s*0;[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;[^}]*\}/s);
    expect(css).toContain(".transcript-part-has-actions:hover .transcript-part-footer-actions");
    expect(css).toContain(".transcript-part-has-actions:focus-within .transcript-part-footer-actions");
  });

  it("includes latest-message affordance and conversation viewport styling hooks", () => {
    const css = readFileSync(path.join(process.cwd(), "src/sidepanel/style/transcript.css"), "utf8");

    expect(css).toContain(".latest-message-button");
    expect(css).toContain(".conversation-viewport");
    expect(css).toContain(".conversation-final-answer-panel");
    expect(css).toContain(".conversation-process-stream");
  });

  it("uses tighter transcript spacing tokens for adjacent messages", () => {
    const css = readFileSync(path.join(process.cwd(), "src/sidepanel/style/transcript.css"), "utf8");

    expect(css).toMatch(/\.event-feed\s*\{[^}]*gap:\s*6px;[^}]*\}/s);
    expect(css).toMatch(/\.transcript-feed\s*\{[^}]*gap:\s*14px;[^}]*\}/s);
    expect(css).toMatch(/\.transcript-part-body\s*\{[^}]*gap:\s*6px;[^}]*padding:\s*0\s+0\s+0\.125rem;[^}]*\}/s);
    expect(css).toMatch(/\.transcript-part-body-assistant,\s*\.transcript-part-assistant\s+\.transcript-part-body\s*\{[^}]*gap:\s*6px;[^}]*\}/s);
  });
});
