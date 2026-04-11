import { describe, expect, it } from "vitest";
import type { NormalizedRunEvent } from "../shared/protocol";
import {
  buildChatStreamItems,
  buildTranscriptMessages,
  buildTranscriptSummary,
  buildReasoningTimelineItems,
  collectAssistantResponseAggregation,
  collectRunAssistantResponseText,
  getTimelineCardStatus,
  getTimelineStatusCopy,
  resolveCockpitStatusModel,
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

/** @ArchitectureID: ELM-APP-EXT-RUN-CONVERSATION-MAPPER */
describe("reasoning timeline fragment sequence", () => {
  it("projects fragments into OpenCode-style messages to parts transcript contract", () => {
    const messages = buildTranscriptMessages({
      runId: "run-1",
      prompt: "请继续",
      status: "done",
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

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(messages.at(-1)?.parts.every((part) => part.kind === "text")).toBe(true);
    expect(messages.every((message) => message.parts.length >= 1)).toBe(true);
  });

  it("embeds tool and answer parts inside ordered assistant transcript messages", () => {
    const messages = buildTranscriptMessages({
      runId: "run-1",
      prompt: "请回答",
      events: [
        createEvent(1, {
          type: "tool_call",
          message: "读取历史记录"
        }),
        createEvent(2, { type: "result", message: "最终回答", data: { message_id: "msg-1" } })
      ],
      status: "done",
      finalOutput: "最终回答"
    });

    expect(messages).toHaveLength(2);
    expect(messages[1]?.parts[0]?.kind).toBe("tool");
    expect(messages[1]?.parts.at(-1)?.kind).toBe("text");
  });

  it("keeps question, history, and follow-up rendering on the same message-to-parts contract", () => {
    const options = {
      runId: "run-1",
      prompt: "继续原问题",
      events: [
        createEvent(1, {
          type: "question",
          message: "请选择处理方式",
          question: {
            questionId: "q-1",
            title: "需要确认",
            message: "请选择处理方式",
            options: [{ id: "resume", label: "继续执行", value: "继续执行" }],
            allowFreeText: false
          }
        }),
        createEvent(2, { type: "result", message: "继续完成" })
      ],
      answers: [{
        id: "answer-1",
        runId: "run-1",
        questionId: "q-1",
        answer: "继续执行",
        choiceId: "resume",
        submittedAt: "2026-04-02T00:00:02.500Z"
      }],
      status: "done" as const,
      finalOutput: "继续完成"
    };

    const liveMessages = buildTranscriptMessages(options);
    const historyMessages = buildTranscriptMessages(options);

    expect(liveMessages).toEqual(historyMessages);
    expect(liveMessages[0]?.parts.map((part) => part.kind)).toEqual(["prompt"]);
    expect(liveMessages[1]?.parts.map((part) => part.kind)).toEqual(["question"]);
    expect(liveMessages[2]?.parts.map((part) => part.kind)).toEqual(["answer"]);
    expect(liveMessages[3]?.parts.every((part) => part.kind === "text")).toBe(true);
  });

  it("builds transcript tail summary for pause resume and completion states", () => {
    expect(buildTranscriptSummary({
      events: [createEvent(1, { type: "question", message: "请选择处理方式" })],
      runStatus: "waiting_for_answer",
      streamStatus: "waiting_for_answer",
      pendingQuestionId: "q-1"
    })).toMatchObject({
      label: "等待补充",
      tone: "warning"
    });

    expect(buildTranscriptSummary({
      events: [createEvent(2, { type: "result", message: "最终完成" })],
      runStatus: "done",
      streamStatus: "done",
      finalOutput: "最终完成"
    })).toMatchObject({
      label: "已完成",
      tone: "success"
    });
  });

  it("aggregates consecutive compact process events for reasoning drawer summaries", () => {
    const items = buildReasoningTimelineItems([
      createEvent(1, { message: "读取页面上下文" }),
      createEvent(2, { message: "整理可用字段" }),
      createEvent(3, { type: "result", message: "输出结论" })
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]?.entries).toHaveLength(2);
    expect(items[0]?.isAggregated).toBe(true);
    expect(items[1]?.type).toBe("result");
  });

  it("keeps assistant text deltas and final snapshots on one assistant_output fragment", () => {
    const items = buildChatStreamItems({
      runId: "run-1",
      prompt: "请回答",
      events: [
        createEvent(1, { type: "thinking", message: "第一段", data: { field: "text", message_id: "msg-1" } }),
        createEvent(2, { type: "result", message: "第一段\n\n第二段", data: { message_id: "msg-1" } })
      ],
      status: "done",
      finalOutput: "第一段\n\n第二段"
    });

    const outputs = items.filter((item) => item.kind === "assistant_output");
    expect(outputs.length).toBeGreaterThanOrEqual(1);
    expect(outputs.at(-1)?.anchorId).toBe("msg-1");
    expect(outputs.map((item) => item.summary).join("\n")).toContain("第一段");
    expect(outputs.at(-1)?.supportsRetry).toBe(true);
    expect(outputs.at(-1)?.supportsFeedback).toBe(true);
  });

  it("uses the same assistant_output fragment kind for streaming and final convergence", () => {
    const streamingItems = buildChatStreamItems({
      runId: "run-1",
      prompt: "继续分析",
      events: [
        createEvent(1, {
          type: "thinking",
          message: "## 当前风险结论\n\n1. SR 本体缺失。",
          semantic: {
            channel: "assistant_text",
            emissionKind: "delta",
            identity: "assistant_text:msg-1:part-1",
            messageId: "msg-1",
            partId: "part-1"
          }
        })
      ],
      status: "streaming",
      finalOutput: ""
    });

    const finalItems = buildChatStreamItems({
      runId: "run-1",
      prompt: "继续分析",
      events: [
        createEvent(1, {
          type: "thinking",
          message: "## 当前风险结论\n\n1. SR 本体缺失。",
          semantic: {
            channel: "assistant_text",
            emissionKind: "delta",
            identity: "assistant_text:msg-1:part-1",
            messageId: "msg-1",
            partId: "part-1"
          }
        }),
        createEvent(2, { type: "result", message: "## 当前风险结论\n\n1. SR 本体缺失。", data: { message_id: "msg-1" } })
      ],
      status: "done",
      finalOutput: "## 当前风险结论\n\n1. SR 本体缺失。"
    });

    expect(streamingItems[0]?.kind).toBe("user_prompt");
    expect(streamingItems.some((item) => item.kind === "assistant_output")).toBe(true);
    expect(finalItems[0]?.kind).toBe("user_prompt");
    expect(finalItems.some((item) => item.kind === "assistant_output")).toBe(true);
    expect(streamingItems.find((item) => item.kind === "assistant_output")?.anchorId).toBe("msg-1");
    expect(finalItems.find((item) => item.kind === "assistant_output")?.anchorId).toBe("msg-1");
  });

  it("keeps tool fragments inline before assistant output in the same transcript flow", () => {
    const items = buildChatStreamItems({
      runId: "run-1",
      prompt: "继续分析",
      events: [
        createEvent(1, { type: "tool_call", message: "调用工具检查历史" }),
        createEvent(3, { type: "thinking", message: "## 当前风险结论\n\n1. SR 本体缺失。", data: { field: "text", message_id: "msg-1" } })
      ],
      status: "streaming",
      finalOutput: ""
    });

    expect(items[0]?.kind).toBe("user_prompt");
    expect(items.some((item) => item.kind === "assistant_process")).toBe(true);
    expect(items.some((item) => item.kind === "assistant_output")).toBe(true);
    expect(items.find((item) => item.kind === "assistant_process")?.summary).toContain("调用工具检查历史");
    expect(items.find((item) => item.kind === "assistant_output")?.summary).toContain("当前风险结论");
  });

  it("keeps question answer and output in one ordered fragment sequence", () => {
    const items = buildChatStreamItems({
      runId: "run-1",
      prompt: "请继续",
      status: "done",
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

    expect(items[0]?.kind).toBe("user_prompt");
    expect(items.some((item) => item.kind === "assistant_question")).toBe(true);
    expect(items.some((item) => item.kind === "user_answer")).toBe(true);
    expect(items.some((item) => item.kind === "assistant_output")).toBe(true);
    expect(items[1]?.groupAnchorId).toBe("fragment-group:run-1:assistant:0");
    expect(items[2]?.groupAnchorId).toBe("fragment-group:run-1:q-1");
    expect(items.at(-1)?.summary).toContain("最终完成");
  });

  it("keeps live and history transcript messages identical under one contract", () => {
    const options = {
      runId: "run-1",
      prompt: "同一问题",
      events: [
        createEvent(1, { type: "thinking", message: "读取页面上下文" }),
        createEvent(2, { type: "result", message: "一致结果" })
      ],
      status: "done" as const,
      finalOutput: "一致结果"
    };

    expect(buildTranscriptMessages(options)).toEqual(buildTranscriptMessages(options));
  });

  it("keeps tool fragments and output inside the same assistant message group", () => {
    const items = buildChatStreamItems({
      runId: "run-1",
      prompt: "请回答",
      events: [
        createEvent(1, {
          type: "tool_call",
          message: "先查上下文"
        }),
        createEvent(2, { type: "result", message: "最终回答", data: { message_id: "msg-1" } })
      ],
      status: "done",
      finalOutput: "最终回答"
    });

    const process = items.find((item) => item.kind === "assistant_process");
    const output = items.find((item) => item.kind === "assistant_output");
    expect(process?.groupAnchorId).toBe(output?.groupAnchorId);
    expect(output?.anchorId).toBe("msg-1");
  });

  it("splits follow-up assistant output into a new assistant message segment after question answer pairs", () => {
    const messages = buildTranscriptMessages({
      runId: "run-1",
      prompt: "继续原问题",
      events: [
        createEvent(1, { type: "tool_call", message: "先检查上下文" }),
        createEvent(2, { type: "thinking", message: "第一段结论", data: { field: "text", message_id: "msg-1" } }),
        createEvent(3, {
          type: "question",
          message: "请选择处理方式",
          question: {
            questionId: "q-1",
            title: "需要确认",
            message: "请选择处理方式",
            options: [{ id: "resume", label: "继续执行", value: "继续执行" }],
            allowFreeText: false
          }
        }),
        createEvent(4, { type: "thinking", message: "第二段结论", data: { field: "text", message_id: "msg-2" } })
      ],
      answers: [{
        id: "answer-1",
        runId: "run-1",
        questionId: "q-1",
        answer: "继续执行",
        choiceId: "resume",
        submittedAt: "2026-04-02T00:00:02.500Z"
      }],
      status: "streaming",
      finalOutput: ""
    });

    expect(messages[0]?.parts.map((part) => part.kind)).toEqual(["prompt"]);
    expect(messages[1]?.parts.some((part) => part.kind === "tool")).toBe(true);
    expect(messages[1]?.parts.some((part) => part.kind === "question")).toBe(true);
    expect(messages[2]?.parts.map((part) => part.kind)).toEqual(["answer"]);
    expect(messages[3]?.parts.every((part) => part.kind === "text")).toBe(true);
    expect(messages[1]?.parts.some((part) => part.text.includes("第一段结论"))).toBe(true);
    expect(messages[3]?.parts.some((part) => part.text.includes("第二段结论"))).toBe(true);
  });

  it("does not reintroduce role shell markers into the transcript message model", () => {
    const messages = buildTranscriptMessages({
      runId: "run-1",
      prompt: "请回答",
      events: [createEvent(1, { type: "result", message: "最终回答" })],
      status: "done",
      finalOutput: "最终回答"
    });

    expect(messages).toHaveLength(2);
    expect(messages.every((message) => Array.isArray(message.parts) && message.parts.length > 0)).toBe(true);
    expect(messages.some((message) => message.parts.some((part) => part.kind === "text"))).toBe(true);
    expect(messages[1]).not.toHaveProperty("avatar");
    expect(messages[1]).not.toHaveProperty("icon");
  });

  it("keeps tool-only streaming state out of assistant transcript body", () => {
    const items = buildChatStreamItems({
      runId: "run-1",
      prompt: "继续分析",
      events: [createEvent(1, { type: "tool_call", message: "读取上下文" })],
      status: "streaming",
      finalOutput: ""
    });

    expect(items.map((item) => item.kind)).toEqual(["user_prompt", "assistant_process"]);
    expect(items[1]?.summary).toBe("读取上下文");
  });

  it("keeps live and history runs on the same fragment mapping contract", () => {
    const options = {
      runId: "run-1",
      prompt: "同一问题",
      events: [
        createEvent(1, { type: "thinking", message: "读取页面上下文" }),
        createEvent(2, { type: "result", message: "一致结果" })
      ],
      status: "done" as const,
      finalOutput: "一致结果"
    };

    const liveItems = buildChatStreamItems(options);
    const historyItems = buildChatStreamItems(options);

    expect(liveItems).toEqual(historyItems);
  });

  it("merges cumulative response snapshots without duplicating text", () => {
    const aggregation = collectAssistantResponseAggregation([
      createEvent(1, { type: "thinking", message: "# Summary\n\nHello ", data: { field: "text", message_id: "msg-1" } }),
      createEvent(2, { type: "thinking", message: "world\n\n- item 1", data: { field: "text", message_id: "msg-1" } }),
      createEvent(3, { type: "result", message: "# Summary\n\nHello world\n\n- item 1", data: { message_id: "msg-1" } })
    ]);

    expect(aggregation.text).toBe("# Summary\n\nHello world\n\n- item 1");
    expect(aggregation.preferredMessageId).toBe("msg-1");
  });

  /** @ArchitectureID: ELM-APP-EXT-CONVERSATION-LIVE-HISTORY-UX */
  it("keeps current history and follow-up turns on the same user/assistant role contract", () => {
    const messages = buildTranscriptMessages({
      runId: "run-1",
      prompt: "继续原问题",
      events: [
        createEvent(1, {
          type: "question",
          message: "请选择处理方式",
          question: {
            questionId: "q-1",
            title: "需要确认",
            message: "请选择处理方式",
            options: [{ id: "resume", label: "继续执行", value: "继续执行" }],
            allowFreeText: false
          }
        }),
        createEvent(2, { type: "result", message: "继续完成" })
      ],
      answers: [{
        id: "answer-1",
        runId: "run-1",
        questionId: "q-1",
        answer: "继续执行",
        choiceId: "resume",
        submittedAt: "2026-04-02T00:00:02.500Z"
      }],
      status: "done",
      finalOutput: "继续完成"
    });

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(messages[0]?.parts.map((part) => part.kind)).toEqual(["prompt"]);
    expect(messages[1]?.parts.map((part) => part.kind)).toEqual(["question"]);
    expect(messages[2]?.parts.map((part) => part.kind)).toEqual(["answer"]);
    expect(messages[3]?.parts.every((part) => part.kind === "text")).toBe(true);
  });

  it("treats assistant text deltas as direct incremental transcript content", () => {
    const messages = buildTranscriptMessages({
      runId: "run-1",
      prompt: "继续分析",
      events: [
        createEvent(1, {
          type: "thinking",
          message: "第一段",
          data: { field: "text", message_id: "msg-1" }
        }),
        createEvent(2, {
          type: "thinking",
          message: "第二段",
          data: { field: "text", message_id: "msg-1" }
        })
      ],
      status: "streaming",
      finalOutput: ""
    });

    expect(messages).toHaveLength(2);
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[1]?.parts.every((part) => part.kind === "text")).toBe(true);
    expect(messages[1]?.parts.map((part) => part.text).join("\n")).toContain("第一段第二段");
  });

  it("does not let stale finalOutput overwrite newer live assistant body text", () => {
    const messages = buildTranscriptMessages({
      runId: "run-1",
      prompt: "继续分析",
      events: [
        createEvent(1, {
          type: "thinking",
          message: "第一段",
          data: { field: "text", message_id: "msg-1" }
        }),
        createEvent(2, {
          type: "thinking",
          message: "第二段",
          data: { field: "text", message_id: "msg-1" }
        })
      ],
      status: "streaming",
      finalOutput: "第一段"
    });

    expect(messages[1]?.parts.every((part) => part.kind === "text")).toBe(true);
    expect(messages[1]?.parts.map((part) => part.text).join("\n")).toContain("第一段第二段");
  });

  it("does not surface generic streaming copy as transcript body or history text", () => {
    const messages = buildTranscriptMessages({
      runId: "run-1",
      prompt: "继续分析",
      events: [createEvent(1, { type: "tool_call", message: "读取上下文" })],
      status: "streaming",
      finalOutput: ""
    });

    expect(messages[0]?.role).toBe("user");
    expect(messages.every((message) => message.parts.every((part) => part.text !== "正在继续…"))).toBe(true);
    expect(messages.map((message) => message.parts.flatMap((part) => part.text))).not.toContain("正在继续…");
  });

  it("prefers terminal answer text when leaked reasoning blocks are mixed into response deltas", () => {
    const finalOutput = "当前主要风险\n\n1. 数据最小化风险。\n\n2. 访问边界需要补强。";
    const events = [
      createEvent(1, {
        type: "thinking",
        message: "there's no detailed text available for it. I should give a caveat about this.基于仓库现有信息，当前页面默认 SR 是 SR-DEMO-001，但没找到该 SR 的正式需求正文/安全目标定义。",
        data: { field: "text", message_id: "msg-1" }
      }),
      createEvent(2, {
        type: "result",
        message: finalOutput,
        data: { message_id: "msg-1" }
      })
    ];

    expect(collectRunAssistantResponseText(events, finalOutput)).toBe(finalOutput);
  });

  it("derives conservative timeline and cockpit states from terminal evidence", () => {
    expect(resolveTimelinePresentationState({
      events: [createEvent(1, { type: "thinking", message: "读取页面上下文" })],
      runStatus: "done",
      streamStatus: "done",
      finalOutput: ""
    })).toMatchObject({
      runStatus: "streaming",
      streamStatus: "streaming",
      hasTerminalEvidence: false
    });

    expect(resolveCockpitStatusModel({
      events: [createEvent(2, { type: "result", message: "最终完成" })],
      assistantStatus: "done",
      runStatus: "done",
      streamStatus: "done",
      finalOutput: "最终完成"
    })).toMatchObject({
      stageKey: "completed",
      tone: "success"
    });

    expect(getTimelineStatusCopy({
      events: [createEvent(2, { type: "result", message: "最终完成" })],
      runStatus: "done",
      finalOutput: "最终完成"
    })).toBe("助手已完成本轮回答。");
  });

  it("maps waiting questions and terminal output card statuses correctly", () => {
    expect(getTimelineCardStatus({
      type: "question",
      isLast: true,
      live: true,
      streamStatus: "waiting_for_answer",
      runStatus: "waiting_for_answer"
    })).toBe("waiting");

    expect(getTimelineCardStatus({
      type: "result",
      isLast: true,
      live: false,
      streamStatus: "done",
      runStatus: "done"
    })).toBe("complete");
  });
});
