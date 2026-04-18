import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedRunEvent } from "../shared/protocol";

vi.mock("../shared/api", () => ({
  submitMessageFeedback: vi.fn(async () => ({ ok: true, data: { feedback: "like" } }))
}));

const { ReasoningTimeline } = await import("./reasoningTimelineView");
const { buildStableTranscriptProjection } = await import("./reasoningTimeline");
const { createOpencodeRawEventProjector } = await import("./opencodeRawEventProjector");

function createRunEvent(sequence: number, overrides: Partial<NormalizedRunEvent> = {}): NormalizedRunEvent {
  return {
    id: `event-${sequence}`,
    runId: "run-1",
    type: "thinking",
    createdAt: `2026-04-02T00:00:0${sequence}.000Z`,
    sequence,
    message: `event ${sequence}`,
    ...overrides
  };
}

// @ArchitectureID: 2243
describe("sidepanel architecture acceptance", () => {
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

  it("TestCase2: hides transcript-part-tool in the main transcript while retaining user prompt, assistant text, and summary", async () => {
    await act(async () => {
      root.render(
        <ReasoningTimeline
          runId="run-1"
          prompt="请总结当前 SR 的风险与建议下一步动作。"
          events={[
            createRunEvent(1, { type: "thinking", message: "读取页面上下文" }),
            createRunEvent(2, { type: "tool_call", message: "查询历史 SR" }),
            createRunEvent(3, { type: "result", message: "最终结论", data: { message_id: "msg-1" } })
          ]}
          runStatus="done"
          finalOutput="最终结论"
        />
      );
    });

    const parts = Array.from(container.querySelectorAll("[data-section='part']")).map((node) => ({
      kind: node.getAttribute("data-part-kind"),
      role: node.getAttribute("data-part-role"),
      text: (node.textContent ?? "").trim()
    }));

    expect(parts.map((part) => part.kind)).toEqual(["prompt", "text", "summary"]);
    expect(parts.map((part) => part.role)).toEqual(["user", "assistant", "assistant"]);
    expect(container.textContent).toContain("最终结论");
    expect(container.textContent).not.toContain("查询历史 SR");
    expect(container.textContent).not.toContain("读取页面上下文");
    expect(container.querySelector("[data-part-kind='tool']")).toBeNull();
  });

  it("TestCase3: converges to completed summary once session.idle or result provides terminal evidence", async () => {
    const projector = createOpencodeRawEventProjector("run-1");

    const snapshotEvents = projector.project({
      id: "raw-1",
      runId: "run-1",
      createdAt: "2026-04-01T00:00:00.000Z",
      sequence: 1,
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
                text: "最终文本"
              }
            }
          }
        }
      }
    });

    const idleEvents = projector.project({
      id: "raw-2",
      runId: "run-1",
      createdAt: "2026-04-01T00:00:01.000Z",
      sequence: 2,
      source: "opencode",
      eventType: "session.idle",
      payload: {
        event: {
          payload: {
            type: "session.idle",
            properties: {
              sessionID: "ses-1"
            }
          }
        }
      }
    });

    expect(snapshotEvents[0]).toMatchObject({ type: "thinking", message: "最终文本" });
    expect(idleEvents[0]).toMatchObject({
      type: "result",
      message: "最终文本",
      semantic: expect.objectContaining({ channel: "assistant_text", emissionKind: "final" })
    });

    const transcriptReadModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-1",
        prompt: "请总结当前 SR 的风险与建议下一步动作。",
        events: [...snapshotEvents, ...idleEvents],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        finalOutput: "最终文本",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    await act(async () => {
      root.render(
        <ReasoningTimeline
          transcriptReadModel={transcriptReadModel}
          runId="run-1"
          prompt="请总结当前 SR 的风险与建议下一步动作。"
          events={[]}
          runStatus="streaming"
        />
      );
    });

    const summaryText = container.querySelector(".transcript-part[data-part-kind='summary']")?.textContent ?? "";
    expect(summaryText).toContain("已完成");
    expect(summaryText).not.toContain("进行中");
    expect(container.textContent).toContain("最终文本");
  });
});