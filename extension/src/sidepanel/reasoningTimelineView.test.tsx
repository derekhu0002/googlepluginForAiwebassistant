import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api", () => ({
  submitMessageFeedback: vi.fn(async () => ({ ok: true, data: { feedback: "like" } }))
}));

const { ReasoningTimeline } = await import("./reasoningTimelineView");

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
});
