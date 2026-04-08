import { describe, expect, it } from "vitest";
import type { NormalizedRunEvent } from "../shared/protocol";
import {
  buildChatStreamItems,
  buildConversationTurns,
  buildReasoningTimelineItems,
  collectRunAssistantResponseText,
  collectAssistantResponseAggregation,
  getTimelineCardStatus,
  getTimelineStatusCopy,
  resolveTimelinePresentationState
} from "./reasoningTimeline";

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

/** @ArchitectureID: REQ-AIASSIST-UI-CHAT-SEND-DECOUPLE-AND-COMPLETE-RESPONSE-RENDER */
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

  it("does not expose done copy without terminal evidence", () => {
    const events = [createEvent(1, { type: "thinking", message: "读取页面上下文" })];

    expect(resolveTimelinePresentationState({
      events,
      runStatus: "done",
      streamStatus: "done",
      finalOutput: ""
    })).toMatchObject({
      runStatus: "streaming",
      streamStatus: "streaming",
      hasTerminalEvidence: false
    });

    expect(getTimelineStatusCopy({
      events,
      runStatus: "done",
      finalOutput: ""
    })).toBe("助手正在继续生成回答，完成后会显示最终结果。");
  });

  it("maps question to answer to streaming to result in one chat stream", () => {
    const items = buildChatStreamItems({
      runId: "run-1",
      prompt: "请继续",
      status: "streaming",
      pendingQuestionId: null,
      answers: [{
        id: "answer-1",
        runId: "run-1",
        questionId: "q-1",
        answer: "继续执行",
        choiceId: "resume",
        submittedAt: "2026-04-02T00:00:02.500Z"
      }],
      events: [
        createEvent(1, {
          type: "question",
          message: "请选择下一步",
          question: {
            questionId: "q-1",
            title: "需要确认",
            message: "请选择下一步",
            options: [{ id: "resume", label: "继续执行", value: "继续执行" }],
            allowFreeText: false
          }
        }),
        createEvent(2, { type: "thinking", message: "我会根据你的选择继续处理。" }),
        createEvent(3, { type: "result", message: "最终完成" })
      ],
      finalOutput: "最终完成",
      updatedAt: "2026-04-02T00:00:03.000Z"
    });

    expect(items.map((item) => item.kind)).toEqual([
      "user_prompt",
      "assistant_question",
      "user_answer",
      "assistant_result"
    ]);
    expect(items[3]?.summary).toBe("最终完成");
    expect(items[3]?.processSummary).toContain("已记录 1 条推理过程");
  });

  it("merges multiple assistant response sources into one complete rendered answer", () => {
    const events = [
      createEvent(1, { type: "thinking", message: "第一段", data: { field: "text" } }),
      createEvent(2, { type: "result", message: "第一段" }),
      createEvent(3, { type: "thinking", message: "第二段", data: { field: "text" } }),
      createEvent(4, { type: "result", message: "第一段第二段\n第三段" })
    ];

    expect(collectRunAssistantResponseText(events, "第一段第二段\n第三段")).toBe("第一段第二段\n第三段");

    const items = buildChatStreamItems({
      runId: "run-1",
      prompt: "请回答",
      events,
      status: "done",
      finalOutput: "第一段第二段\n第三段"
    });

    const assistantResult = items.find((item) => item.kind === "assistant_result");
    expect(assistantResult?.summary).toBe("第一段第二段\n第三段");
    expect(items.filter((item) => item.kind === "assistant_result")).toHaveLength(1);
  });

  it("keeps rendering later valid response content that arrives after a result event", () => {
    const items = buildChatStreamItems({
      runId: "run-1",
      prompt: "请回答",
      events: [
        createEvent(1, { type: "result", message: "先到结果" }),
        createEvent(2, { type: "thinking", message: "后续补充", data: { field: "text" } })
      ],
      status: "done",
      finalOutput: "先到结果后续补充"
    });

    expect(items.find((item) => item.kind === "assistant_result")?.summary).toBe("先到结果后续补充");
  });

  it("does not duplicate content when assistant delta events contain cumulative snapshots", () => {
    const events = [
      createEvent(1, {
        type: "thinking",
        message: "Assessing task requirements\n\nIt looks like I need to provide answer in Chinese, but first, I have to understand what SR means in this context.",
        data: { field: "text", message_id: "msg-1" }
      }),
      createEvent(2, {
        type: "thinking",
        message: "Assessing task requirements\n\nIt looks like I need to provide answer in Chinese, but first, I have to understand what SR means in this context. Since I'm a TARA risk analyst, I should check the workspace for any SR documents.",
        data: { field: "text", message_id: "msg-1" }
      })
    ];

    expect(collectAssistantResponseAggregation(events).text).toBe(
      "Assessing task requirements\n\nIt looks like I need to provide answer in Chinese, but first, I have to understand what SR means in this context. Since I'm a TARA risk analyst, I should check the workspace for any SR documents."
    );

    const items = buildChatStreamItems({
      runId: "run-1",
      prompt: "请总结当前 SR 的风险与建议下一步动作。",
      events,
      status: "streaming",
      finalOutput: ""
    });

    expect(items.find((item) => item.kind === "assistant_progress")?.summary).toBe(
      "Assessing task requirements\n\nIt looks like I need to provide answer in Chinese, but first, I have to understand what SR means in this context. Since I'm a TARA risk analyst, I should check the workspace for any SR documents."
    );
  });

  it("preserves spaces and paragraph breaks across assistant delta chunks", () => {
    const aggregation = collectAssistantResponseAggregation([
      createEvent(1, { type: "thinking", message: "# Summary\n\nHello ", data: { field: "text", message_id: "msg-1" } }),
      createEvent(2, { type: "thinking", message: "world\n\n- item 1", data: { field: "text", message_id: "msg-1" } })
    ]);

    expect(aggregation.text).toBe("# Summary\n\nHello world\n\n- item 1");
  });

  it("keeps a stable assistant message id across streaming deltas and final result", () => {
    const aggregation = collectAssistantResponseAggregation([
      createEvent(1, { type: "thinking", message: "# 标题", data: { field: "text", message_id: "msg-1" } }),
      createEvent(2, { type: "result", message: "# 标题\n\n正文", data: { message_id: "msg-1" } })
    ]);

    expect(aggregation.preferredMessageId).toBe("msg-1");

    const items = buildChatStreamItems({
      runId: "run-1",
      prompt: "请回答",
      events: [
        createEvent(1, { type: "thinking", message: "# 标题", data: { field: "text", message_id: "msg-1" } }),
        createEvent(2, { type: "result", message: "# 标题\n\n正文", data: { message_id: "msg-1" } })
      ],
      status: "done",
      finalOutput: "# 标题\n\n正文"
    });

    expect(items.filter((item) => item.kind === "assistant_result")).toHaveLength(1);
    expect(items.find((item) => item.kind === "assistant_result")?.id).toBe("msg-1");
  });

  it("keeps live and history mapping semantics aligned", () => {
    const events = [
      createEvent(1, { type: "thinking", message: "读取页面上下文" }),
      createEvent(2, { type: "result", message: "一致结果" })
    ];

    const liveItems = buildChatStreamItems({
      runId: "run-1",
      prompt: "同一问题",
      events,
      status: "done",
      finalOutput: "一致结果"
    });
    const historyItems = buildChatStreamItems({
      runId: "run-1",
      prompt: "同一问题",
      events,
      status: "done",
      finalOutput: "一致结果"
    });

    expect(liveItems.map((item) => item.kind)).toEqual(historyItems.map((item) => item.kind));
    expect(liveItems.at(-1)?.summary).toBe(historyItems.at(-1)?.summary);
  });

  it("does not render assistant chat items when a run has only process logs and no assistant text yet", () => {
    const items = buildChatStreamItems({
      runId: "run-1",
      prompt: "继续分析",
      events: [
        createEvent(1, { type: "thinking", message: "我先整理当前页面上下文，再判断风险点。" })
      ],
      status: "streaming",
      finalOutput: ""
    });

    expect(items.map((item) => item.kind)).toEqual([
      "user_prompt"
    ]);
  });

  it("adds hover action metadata for assistant result items", () => {
    const items = buildChatStreamItems({
      runId: "run-1",
      prompt: "原始问题",
      events: [createEvent(1, { type: "result", message: "最终回答" })],
      status: "done",
      finalOutput: "最终回答"
    });

    const resultItem = items.find((item) => item.kind === "assistant_result");
    expect(resultItem).toMatchObject({
      supportsCopy: true,
      supportsRetry: true,
      supportsFeedback: true,
      sourceQuestionPrompt: "原始问题",
      feedbackState: { status: "idle" }
    });
  });

  it("does not offer feedback or retry for user answer items", () => {
    const items = buildChatStreamItems({
      runId: "run-1",
      prompt: "原始问题",
      answers: [{
        id: "answer-1",
        runId: "run-1",
        questionId: "q-1",
        answer: "继续执行",
        submittedAt: "2026-04-02T00:00:01.000Z"
      }],
      events: [createEvent(1, {
        type: "question",
        message: "请选择下一步",
        question: {
          questionId: "q-1",
          title: "需要确认",
          message: "请选择下一步",
          options: [],
          allowFreeText: true
        }
      })],
      status: "waiting_for_answer"
    });

    const userAnswer = items.find((item) => item.kind === "user_answer");
    expect(userAnswer).toMatchObject({
      supportsCopy: true,
      supportsRetry: false,
      supportsFeedback: false
    });
  });
});
