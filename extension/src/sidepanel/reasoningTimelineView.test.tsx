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

/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-RENDERER */
/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-LIVE-HISTORY-UX */
describe("ReasoningTimeline transcript rendering", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    // @ts-expect-error test-only React act environment flag
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
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
    expect(container.querySelectorAll(".transcript-part[data-part-role='assistant']")).toHaveLength(3);
    expect(container.querySelectorAll("[data-part-kind='answer']")).toHaveLength(0);
    expect(container.querySelectorAll("[data-part-kind='text']")).toHaveLength(1);
    expect(container.querySelector("[data-part-kind='text']")?.textContent).toContain("第一段第二段");
  });

  it("keeps active assistant DOM boundary stable across tail-only updates", async () => {
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
        />
      );
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
        />
      );
    });

    const secondAssistantMessage = container.querySelector("[data-message-role='assistant']");
    expect(container.querySelectorAll("[data-message-role='assistant']")).toHaveLength(1);
    expect(firstAssistantMessage?.getAttribute("data-message-id")).toBe(secondAssistantMessage?.getAttribute("data-message-id"));
    expect(container.querySelector("[data-message-role='assistant'] [data-part-kind='text']")?.textContent).toContain("AB");
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

  /** @ArchitectureID: ELM-APP-EXT-CONVERSATION-RENDERER */
  /** @ArchitectureID: ELM-APP-EXT-CONVERSATION-LIVE-HISTORY-UX */
  it("keeps transcript action controls hidden by default and reveals them only on hover or focus-within selectors", () => {
    const css = readFileSync(path.join(process.cwd(), "src/sidepanel/style/transcript.css"), "utf8");

    expect(css).toMatch(/\.transcript-part-footer-actions\s*\{[^}]*opacity:\s*0;[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;[^}]*\}/s);
    expect(css).toContain(".transcript-part-has-actions:hover .transcript-part-footer-actions");
    expect(css).toContain(".transcript-part-has-actions:focus-within .transcript-part-footer-actions");
  });

  it("uses tighter transcript spacing tokens for adjacent messages", () => {
    const css = readFileSync(path.join(process.cwd(), "src/sidepanel/style/transcript.css"), "utf8");

    expect(css).toMatch(/\.event-feed\s*\{[^}]*gap:\s*6px;[^}]*\}/s);
    expect(css).toMatch(/\.transcript-feed\s*\{[^}]*gap:\s*6px;[^}]*\}/s);
    expect(css).toMatch(/\.transcript-part-body\s*\{[^}]*gap:\s*6px;[^}]*padding:\s*0\s+0\s+0\.125rem;[^}]*\}/s);
    expect(css).toMatch(/\.transcript-part-body-assistant,\s*\.transcript-part-assistant\s+\.transcript-part-body\s*\{[^}]*gap:\s*6px;[^}]*\}/s);
  });
});
