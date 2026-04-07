import { describe, expect, it } from "vitest";
import type { NormalizedRunEvent } from "../shared/protocol";
import { buildConversationTurns, buildReasoningTimelineItems, getTimelineCardStatus } from "./reasoningTimeline";

function createEvent(sequence: number, overrides: Partial<NormalizedRunEvent> = {}): NormalizedRunEvent {
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

describe("reasoning timeline view-model", () => {
  it("aggregates consecutive compact thinking events into one reading unit", () => {
    const items = buildReasoningTimelineItems([
      createEvent(1, { message: "读取页面上下文" }),
      createEvent(2, { message: "整理可用字段" }),
      createEvent(3, { type: "result", message: "输出结论" })
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]?.entries).toHaveLength(2);
    expect(items[0]?.isAggregated).toBe(true);
    expect(items[0]?.summary).toContain("读取页面上下文");
    expect(items[0]?.summary).toContain("整理可用字段");
    expect(items[1]?.type).toBe("result");
  });

  it("keeps question payload title and does not merge across different event types", () => {
    const items = buildReasoningTimelineItems([
      createEvent(1, { type: "tool_call", message: "查询历史记录" }),
      createEvent(2, {
        type: "question",
        message: "请选择下一步",
        question: {
          questionId: "q-1",
          title: "需要确认",
          message: "请选择下一步",
          options: [],
          allowFreeText: true
        }
      })
    ]);

    expect(items).toHaveLength(2);
    expect(items[1]?.title).toBe("需要确认");
    expect(items[1]?.question?.questionId).toBe("q-1");
  });

  it("maps reasoning events into conversation-first assistant turns", () => {
    const turns = buildConversationTurns([
      createEvent(1, { type: "thinking", message: "我先核对页面上下文，再判断哪些字段会影响结论。" }),
      createEvent(2, { type: "tool_call", message: "调用工具检查历史" }),
      createEvent(3, { type: "result", message: "总结结论" })
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0]?.kind).toBe("assistant");
    expect(turns[0]?.primaryType).toBe("thinking");
    expect(turns[0]?.summary).toContain("我先核对页面上下文");
    expect(turns[1]?.primaryType).toBe("result");
    expect(turns[1]?.summary).toContain("总结结论");
  });

  it("hides orchestration-style process entries while keeping the final result visible", () => {
    const turns = buildConversationTurns([
      createEvent(1, { type: "thinking", message: "读取页面上下文" }),
      createEvent(2, { type: "tool_call", message: "查询历史 SR" }),
      createEvent(3, { type: "result", message: "完整回答正文" })
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.summary).toBe("完整回答正文");
    expect(turns[0]?.primaryType).toBe("result");
  });

  it("keeps user-meaningful thinking while filtering session and step noise", () => {
    const turns = buildConversationTurns([
      createEvent(1, { type: "thinking", message: "已创建 opencode session，准备提交 prompt..." }),
      createEvent(2, { type: "thinking", message: "opencode session 状态更新：busy" }),
      createEvent(3, { type: "thinking", message: "我先比较历史记录与当前上下文，再给出建议。" }),
      createEvent(4, { type: "result", message: "最终建议" })
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0]?.summary).toBe("我先比较历史记录与当前上下文，再给出建议。");
    expect(turns[1]?.summary).toBe("最终建议");
  });

  it("breaks conversation turns when a question arrives", () => {
    const turns = buildConversationTurns([
      createEvent(1, { type: "thinking", message: "我需要先确认你的偏好，再继续分析。" }),
      createEvent(2, {
        type: "question",
        message: "请选择下一步",
        question: {
          questionId: "q-1",
          title: "需要确认",
          message: "请选择下一步",
          options: [],
          allowFreeText: true
        }
      }),
      createEvent(3, { type: "thinking", message: "我会根据你的选择继续处理。" })
    ]);

    expect(turns).toHaveLength(3);
    expect(turns[0]?.kind).toBe("assistant");
    expect(turns[1]?.kind).toBe("question");
    expect(turns[1]?.question?.questionId).toBe("q-1");
    expect(turns[2]?.kind).toBe("assistant");
    expect(turns[2]?.summary).toContain("继续处理");
  });

  it("derives waiting and active card states for live timeline cards", () => {
    expect(getTimelineCardStatus({
      type: "thinking",
      isLast: true,
      live: true,
      streamStatus: "streaming",
      runStatus: "streaming"
    })).toBe("active");

    expect(getTimelineCardStatus({
      type: "question",
      isLast: true,
      live: true,
      streamStatus: "waiting_for_answer",
      runStatus: "waiting_for_answer"
    })).toBe("waiting");
  });

  it("marks question cards complete after the run has continued or finished", () => {
    expect(getTimelineCardStatus({
      type: "question",
      isLast: false,
      live: true,
      streamStatus: "streaming",
      runStatus: "streaming"
    })).toBe("complete");

    expect(getTimelineCardStatus({
      type: "question",
      isLast: true,
      live: false,
      streamStatus: "done",
      runStatus: "done"
    })).toBe("complete");

    expect(getTimelineCardStatus({
      type: "question",
      isLast: true,
      live: true,
      streamStatus: "streaming",
      runStatus: "streaming"
    })).toBe("complete");
  });
});
