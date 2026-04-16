import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildStableTranscriptProjection } from "./reasoningTimeline";
import { ReasoningTimeline } from "./reasoningTimelineView";

// @ArchitectureID: ELM-FUNC-EXT-RENDER-INCREMENTAL-TRANSCRIPT
// @ArchitectureID: ELM-COMP-EXT-SIDEPANEL
// @RequirementID: ELM-REQ-OPENCODE-UX
describe("ReasoningTimeline chrome sandbox transcript boundary", () => {
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
    vi.unstubAllGlobals();
    container.remove();
  });

  it("renders exactly one user bubble and one assistant bubble for adversarial mixed-order stream", async () => {
    const transcriptReadModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-sandbox",
        prompt: "当前问题",
        events: [
          {
            id: "evt-1",
            runId: "run-sandbox",
            type: "thinking",
            createdAt: "2026-04-02T00:00:01.000Z",
            sequence: 1,
            message: "第一段",
            semantic: {
              channel: "assistant_text",
              emissionKind: "delta",
              identity: "assistant_text:msg-sandbox:part-1",
              itemKind: "text",
              messageId: "msg-sandbox",
              partId: "part-1"
            }
          },
          {
            id: "evt-2",
            runId: "run-sandbox",
            type: "tool_call",
            createdAt: "2026-04-02T00:00:02.000Z",
            sequence: 2,
            message: "调用工具",
            semantic: {
              channel: "tool",
              emissionKind: "delta",
              identity: "tool:msg-sandbox:tool-1",
              itemKind: "tool",
              messageId: "msg-sandbox",
              partId: "tool-1"
            }
          },
          {
            id: "evt-3",
            runId: "run-sandbox",
            type: "thinking",
            createdAt: "2026-04-02T00:00:03.000Z",
            sequence: 3,
            message: "第二段",
            semantic: {
              channel: "assistant_text",
              emissionKind: "delta",
              identity: "assistant_text:msg-sandbox:part-2",
              itemKind: "text",
              messageId: "msg-sandbox",
              partId: "part-2"
            }
          }
        ],
        answers: [{
          id: "answer-empty",
          runId: "run-sandbox",
          questionId: "q-empty",
          answer: "   ",
          submittedAt: "2026-04-02T00:00:04.000Z"
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
          runId="run-sandbox"
          prompt="当前问题"
          events={[]}
          runStatus="streaming"
        />
      );
    });

    expect(container.querySelectorAll("[data-message-role='user']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-message-role='assistant']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-part-kind='answer']")).toHaveLength(0);
    expect(container.querySelectorAll("[data-part-kind='text']")).toHaveLength(1);
    expect(container.querySelector("[data-part-kind='text']")?.textContent).toContain("第一段第二段");
    const details = container.querySelector(".conversation-process-details") as HTMLDetailsElement | null;
    expect(details).toBeTruthy();
    expect(details?.open).toBe(false);
    expect(container.querySelectorAll("article.transcript-message")).toHaveLength(2);
  });

  it("keeps the assistant article stable while mixed-order stream grows and then finalizes in sandbox", async () => {
    let frameId = 0;
    const queue = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameId += 1;
      queue.set(frameId, callback);
      return frameId;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => {
      queue.delete(id);
    }));

    const flushFrames = async (time: number) => {
      const entries = [...queue.values()];
      queue.clear();
      await act(async () => {
        for (const callback of entries) {
          callback(time);
        }
      });
    };

    const firstModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-sandbox",
        prompt: "当前问题",
        events: [{
          id: "evt-1",
          runId: "run-sandbox",
          type: "thinking",
          createdAt: "2026-04-02T00:00:01.000Z",
          sequence: 1,
          message: "A",
          data: { field: "text", message_id: "msg-sandbox" }
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
          transcriptReadModel={firstModel}
          runId="run-sandbox"
          prompt="当前问题"
          events={[]}
          runStatus="streaming"
          live
        />
      );
    });
    await flushFrames(16);

    const firstAssistantArticle = container.querySelector("article.transcript-message-assistant");

    const secondModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-sandbox",
        prompt: "当前问题",
        events: [
          {
            id: "evt-1",
            runId: "run-sandbox",
            type: "thinking",
            createdAt: "2026-04-02T00:00:01.000Z",
            sequence: 1,
            message: "A",
            data: { field: "text", message_id: "msg-sandbox" }
          },
          {
            id: "evt-2",
            runId: "run-sandbox",
            type: "tool_call",
            createdAt: "2026-04-02T00:00:02.000Z",
            sequence: 2,
            message: "调用工具",
            semantic: {
              channel: "tool",
              emissionKind: "delta",
              identity: "tool:msg-sandbox:tool-1",
              itemKind: "tool",
              messageId: "msg-sandbox",
              partId: "tool-1"
            }
          },
          {
            id: "evt-3",
            runId: "run-sandbox",
            type: "result",
            createdAt: "2026-04-02T00:00:03.000Z",
            sequence: 3,
            message: "ABC",
            data: { message_id: "msg-sandbox" }
          }
        ],
        status: "done",
        runStatus: "done",
        streamStatus: "done",
        finalOutput: "ABC",
        includeSummary: true,
        includeToolCallParts: true
      },
      previousModel: firstModel
    });

    await act(async () => {
      root.render(
        <ReasoningTimeline
          transcriptReadModel={secondModel}
          runId="run-sandbox"
          prompt="当前问题"
          events={[]}
          runStatus="done"
          live
        />
      );
    });

    const secondAssistantArticle = container.querySelector("article.transcript-message-assistant");
    expect(container.querySelectorAll("article.transcript-message")).toHaveLength(2);
    expect(firstAssistantArticle).toBe(secondAssistantArticle);
    expect(container.querySelector("[data-component='final-answer-panel']")?.textContent).toContain("ABC");
  });
});
