import { describe, expect, it } from "vitest";
import type { NormalizedRunEvent } from "../shared/protocol";
import {
  buildStableTranscriptProjection,
  buildTranscriptMessages,
  buildTranscriptPartStream,
  buildTranscriptSummary,
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

// @ArchitectureID: ELM-FUNC-EXT-PROJECT-TRANSCRIPT
// @ArchitectureID: ELM-APP-EXT-RUN-CONVERSATION-MAPPER
// @RequirementID: ELM-REQ-OPENCODE-UX
describe("reasoning timeline share-aligned transcript contract", () => {
  it("projects source-ordered message parts into a flat part stream with tail summary", () => {
    const parts = buildTranscriptPartStream({
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
        createEvent(2, { type: "thinking", message: "我会根据你的选择继续处理。", data: { field: "text", message_id: "msg-1" } }),
        createEvent(3, { type: "result", message: "最终完成", data: { message_id: "msg-1" } })
      ],
      finalOutput: "最终完成",
      updatedAt: "2026-04-02T00:00:03.000Z"
    });

    expect(parts.map((part) => part.kind)).toEqual(["prompt", "question", "answer", "text", "summary"]);
    expect(parts.at(-1)?.text).toBe("已完成");
  });

  it("suppresses tool-call parts from the transcript stream by default", () => {
    const parts = buildTranscriptPartStream({
      runId: "run-1",
      prompt: "请回答",
      events: [
        createEvent(1, { type: "tool_call", message: "读取历史记录" }),
        createEvent(2, { type: "result", message: "最终回答", data: { message_id: "msg-1" } })
      ],
      status: "done",
      finalOutput: "最终回答"
    });

    expect(parts.map((part) => part.kind)).toEqual(["prompt", "text", "summary"]);
  });

  it("can still include tool-call parts when explicitly requested", () => {
    const parts = buildTranscriptPartStream({
      runId: "run-1",
      prompt: "请回答",
      events: [
        createEvent(1, { type: "tool_call", message: "读取历史记录" }),
        createEvent(2, { type: "result", message: "最终回答", data: { message_id: "msg-1" } })
      ],
      status: "done",
      finalOutput: "最终回答",
      includeToolCallParts: true
    });

    expect(parts.map((part) => part.kind)).toEqual(["prompt", "tool", "text", "summary"]);
  });

  it("keeps follow-up pause resume on a single ordered transcript stream", () => {
    const parts = buildTranscriptPartStream({
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

    expect(parts.map((part) => part.kind)).toEqual(["prompt", "question", "answer", "text", "summary"]);
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

  it("keeps transcript messages as a compatibility projection from the flat part contract", () => {
    const messages = buildTranscriptMessages({
      runId: "run-1",
      prompt: "请回答",
      events: [createEvent(1, { type: "result", message: "最终回答" })],
      status: "done",
      finalOutput: "最终回答"
    });

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.parts.every((part) => part.kind === "text")).toBe(true);
  });

  it("keeps newer assistant text ahead of stale final output", () => {
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

    expect(messages[1]?.parts.map((part) => part.text).join("\n")).toContain("第一段第二段");
  });

  it("does not surface generic streaming copy as transcript content", () => {
    const parts = buildTranscriptPartStream({
      runId: "run-1",
      prompt: "继续分析",
      events: [createEvent(1, { type: "tool_call", message: "读取上下文" })],
      status: "streaming",
      finalOutput: ""
    });

    expect(parts.map((part) => part.text)).not.toContain("正在继续…");
  });

  it("keeps reasoning visible while suppressing tool process parts in transcript projection", () => {
    const parts = buildTranscriptPartStream({
      runId: "run-1",
      prompt: "继续分析",
      events: [
        createEvent(1, { type: "thinking", message: "我先读取当前上下文，再比对已有结论。" }),
        createEvent(2, { type: "tool_call", message: "查询历史 SR" }),
        createEvent(3, { type: "result", message: "最终结论", data: { message_id: "msg-1" } })
      ],
      status: "done",
      finalOutput: "最终结论"
    });

    expect(parts.map((part) => ({ kind: part.kind, text: part.text }))).toEqual([
      { kind: "prompt", text: "继续分析" },
      { kind: "reasoning", text: "我先读取当前上下文，再比对已有结论。" },
      { kind: "text", text: "最终结论" },
      { kind: "summary", text: "已完成" }
    ]);
  });

  it("merges assistant text chunks by semantic message identity instead of raw adjacency", () => {
    const messages = buildTranscriptMessages({
      runId: "run-1",
      prompt: "继续分析",
      events: [
        createEvent(1, {
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
          type: "thinking",
          message: "第二段",
          semantic: {
            channel: "assistant_text",
            emissionKind: "delta",
            identity: "assistant_text:msg-1:part-2",
            itemKind: "text",
            messageId: "msg-1",
            partId: "part-2"
          }
        }),
        createEvent(3, {
          type: "thinking",
          message: "其他消息",
          semantic: {
            channel: "assistant_text",
            emissionKind: "delta",
            identity: "assistant_text:msg-2:part-1",
            itemKind: "text",
            messageId: "msg-2",
            partId: "part-1"
          }
        })
      ],
      status: "streaming"
    });

    expect(messages.map((message) => message.parts.map((part) => part.text).join(""))).toEqual(["继续分析", "第一段第二段", "其他消息"]);
  });

  it("coalesces split Chinese assistant fragments into one visible message", () => {
    const messages = buildTranscriptMessages({
      runId: "run-1",
      prompt: "继续分析",
      events: [
        createEvent(1, {
          type: "thinking",
          message: "让我先加载这个",
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
          type: "tool_call",
          message: "读取技能列表",
          semantic: {
            channel: "tool",
            emissionKind: "delta",
            identity: "tool:msg-1:tool-1",
            itemKind: "tool",
            messageId: "msg-1",
            partId: "tool-1"
          }
        }),
        createEvent(3, {
          type: "thinking",
          message: "技能。",
          semantic: {
            channel: "assistant_text",
            emissionKind: "delta",
            identity: "assistant_text:msg-1:part-2",
            itemKind: "text",
            messageId: "msg-1",
            partId: "part-2"
          }
        })
      ],
      status: "streaming"
    });

    const assistantMessages = messages.filter((message) => message.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.parts.filter((part) => part.kind === "text").map((part) => part.text)).toEqual(["让我先加载这个技能。"]);
  });

  it("preserves one visible assistant transcript message across tool-interleaved streaming updates", () => {
    const messages = buildTranscriptMessages({
      runId: "run-1",
      prompt: "继续分析",
      includeToolCallParts: true,
      events: [
        createEvent(1, {
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
          type: "tool_call",
          message: "查询上下文",
          semantic: {
            channel: "tool",
            emissionKind: "delta",
            identity: "tool:msg-1:tool-1",
            itemKind: "tool",
            messageId: "msg-1",
            partId: "tool-1"
          }
        }),
        createEvent(3, {
          type: "thinking",
          message: "第二段",
          semantic: {
            channel: "assistant_text",
            emissionKind: "delta",
            identity: "assistant_text:msg-1:part-2",
            itemKind: "text",
            messageId: "msg-1",
            partId: "part-2"
          }
        })
      ],
      status: "streaming"
    });

    const assistantMessages = messages.filter((message) => message.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.parts.map((part) => ({ kind: part.kind, text: part.text }))).toEqual([
      { kind: "text", text: "第一段第二段" },
      { kind: "tool", text: "查询上下文" }
    ]);
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

  it("merges cumulative response snapshots without duplicating text", () => {
    const aggregation = collectAssistantResponseAggregation([
      createEvent(1, { type: "thinking", message: "# Summary\n\nHello ", data: { field: "text", message_id: "msg-1" } }),
      createEvent(2, { type: "thinking", message: "world\n\n- item 1", data: { field: "text", message_id: "msg-1" } }),
      createEvent(3, { type: "result", message: "# Summary\n\nHello world\n\n- item 1", data: { message_id: "msg-1" } })
    ]);

    expect(aggregation.text).toBe("# Summary\n\nHello world\n\n- item 1");
    expect(aggregation.preferredMessageId).toBe("msg-1");
  });

  it("does not repeatedly append the full assistant snapshot during streaming updates", () => {
    const messages = buildTranscriptMessages({
      runId: "run-1",
      prompt: "继续分析",
      events: [
        createEvent(1, { type: "thinking", message: "第一段", data: { field: "text", message_id: "msg-1" } }),
        createEvent(2, { type: "thinking", message: "第一段第二段", data: { field: "text", message_id: "msg-1" } }),
        createEvent(3, { type: "thinking", message: "第一段第二段第三段", data: { field: "text", message_id: "msg-1" } })
      ],
      status: "streaming"
    });

    expect(messages[1]?.parts).toHaveLength(1);
    expect(messages[1]?.parts[0]?.text).toBe("第一段第二段第三段");
  });

  it("suppresses duplicate final assistant text when snapshot and result finalize the same message", () => {
    const parts = buildTranscriptPartStream({
      runId: "run-1",
      prompt: "继续分析",
      events: [
        createEvent(1, {
          type: "thinking",
          message: "让我先加载这个",
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
          type: "tool_call",
          message: "读取技能列表",
          semantic: {
            channel: "tool",
            emissionKind: "delta",
            identity: "tool:msg-1:tool-1",
            itemKind: "tool",
            messageId: "msg-1",
            partId: "tool-1"
          }
        }),
        createEvent(3, {
          type: "thinking",
          message: "让我先加载这个技能。",
          semantic: {
            channel: "assistant_text",
            emissionKind: "snapshot",
            identity: "assistant_text:msg-1:part-2",
            itemKind: "text",
            messageId: "msg-1",
            partId: "part-2"
          }
        }),
        createEvent(4, {
          type: "result",
          message: "让我先加载这个技能。",
          data: { message_id: "msg-1" }
        })
      ],
      status: "done",
      finalOutput: "让我先加载这个技能。"
    });

    expect(parts.filter((part) => part.kind === "text").map((part) => part.text)).toEqual(["让我先加载这个技能。"]);
  });

  it("dedupes adjacent assistant text snapshots when msg_ and prt_ anchors represent the same visible turn", () => {
    const messages = buildTranscriptMessages({
      runId: "run-1",
      prompt: "继续分析",
      includeToolCallParts: true,
      events: [
        createEvent(1, {
          type: "tool_call",
          message: "读取上下文",
          semantic: {
            channel: "tool",
            emissionKind: "delta",
            identity: "tool:msg-1:tool-1",
            itemKind: "tool",
            messageId: "msg-1",
            partId: "tool-1"
          }
        }),
        createEvent(2, {
          type: "thinking",
          message: "当前结论：需要补充权限范围",
          semantic: {
            channel: "assistant_text",
            emissionKind: "snapshot",
            identity: "assistant_text:msg-1:part-1",
            itemKind: "text",
            messageId: "msg-1",
            partId: "part-1"
          }
        }),
        createEvent(3, {
          type: "result",
          message: "当前结论：需要补充权限范围\n\n建议同时校验最小授权。",
          semantic: {
            channel: "assistant_text",
            emissionKind: "snapshot",
            identity: "assistant_text:prt-9:part-9",
            itemKind: "text",
            messageId: "prt-9",
            partId: "part-9"
          },
          data: { message_id: "prt-9" }
        })
      ],
      status: "done",
      finalOutput: "当前结论：需要补充权限范围\n\n建议同时校验最小授权。"
    });

    const assistantMessages = messages.filter((message) => message.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.parts.map((part) => ({ kind: part.kind, text: part.text }))).toEqual([
      { kind: "tool", text: "读取上下文" },
      { kind: "text", text: "当前结论：需要补充权限范围\n\n建议同时校验最小授权。" }
    ]);
  });

  it("replaces an earlier incomplete assistant snapshot with the fuller adjacent snapshot", () => {
    const parts = buildTranscriptPartStream({
      runId: "run-1",
      prompt: "继续分析",
      events: [
        createEvent(1, {
          type: "thinking",
          message: "第一段结论，正在补充",
          data: { field: "text", message_id: "msg-early" }
        }),
        createEvent(2, {
          type: "result",
          message: "第一段结论，正在补充完整说明。",
          data: { message_id: "prt-final" }
        })
      ],
      status: "done",
      finalOutput: "第一段结论，正在补充完整说明。"
    });

    expect(parts.filter((part) => part.kind === "text").map((part) => part.text)).toEqual(["第一段结论，正在补充完整说明。"]);
  });

  it("dedupes reasoning parts when the same anchor drifts between assistant-message and fragment-group containers", () => {
    const parts = buildTranscriptPartStream({
      runId: "run-1",
      prompt: "继续分析",
      includeToolCallParts: true,
      events: [
        createEvent(1, {
          type: "thinking",
          message: "先校验权限边界。",
          semantic: {
            channel: "reasoning",
            emissionKind: "delta",
            identity: "prt-9",
            itemKind: "reasoning",
            partId: "prt-9"
          }
        }),
        createEvent(2, {
          type: "tool_call",
          message: "读取权限配置",
          semantic: {
            channel: "tool",
            emissionKind: "delta",
            identity: "tool:msg-1:tool-1",
            itemKind: "tool",
            messageId: "msg-1",
            partId: "tool-1"
          }
        }),
        createEvent(3, {
          type: "thinking",
          message: "先校验权限边界。",
          semantic: {
            channel: "reasoning",
            emissionKind: "snapshot",
            identity: "prt-9",
            itemKind: "reasoning",
            messageId: "prt-9",
            partId: "prt-9"
          },
          data: { message_id: "prt-9" }
        }),
        createEvent(4, {
          type: "result",
          message: "最终结论",
          data: { message_id: "prt-9" }
        })
      ],
      status: "done",
      finalOutput: "最终结论"
    });

    expect(parts.filter((part) => part.kind === "reasoning").map((part) => part.text)).toEqual(["先校验权限边界。"]);
    expect(parts.filter((part) => part.kind === "tool").map((part) => part.text)).toEqual(["读取权限配置"]);
    expect(parts.filter((part) => part.kind === "text").map((part) => part.text)).toEqual(["最终结论"]);
  });

  it("does not swallow genuinely different adjacent assistant turns", () => {
    const messages = buildTranscriptMessages({
      runId: "run-1",
      prompt: "继续分析",
      events: [
        createEvent(1, {
          type: "result",
          message: "这是第一条独立回答。",
          data: { message_id: "msg-1" }
        }),
        createEvent(2, {
          type: "result",
          message: "这是第二条不同回答。",
          data: { message_id: "msg-2" }
        })
      ],
      status: "done",
      finalOutput: "这是第二条不同回答。"
    });

    expect(messages.map((message) => message.parts.map((part) => part.text).join("\n"))).toEqual([
      "继续分析",
      "这是第一条独立回答。",
      "这是第二条不同回答。"
    ]);
  });

  it("projects only the provided run segments without rebuilding a duplicate base transcript", () => {
    const parts = buildTranscriptPartStream({
      runId: "run-1",
      prompt: "当前问题",
      events: [createEvent(1, { type: "result", message: "当前回答", data: { message_id: "msg-1" } })],
      status: "done",
      finalOutput: "当前回答"
    });

    expect(parts.map((part) => part.text)).toEqual(["当前问题", "当前回答", "已完成"]);
  });

  it("keeps historical transcript identity stable while live tail updates incrementally", () => {
    const historicalSegments = [{
      runId: "run-history",
      prompt: "历史问题",
      events: [createEvent(1, { runId: "run-history", type: "result", message: "历史回答", data: { message_id: "msg-history" } })],
      status: "done" as const,
      finalOutput: "历史回答",
      updatedAt: "2026-04-02T00:00:01.000Z"
    }];

    const firstModel = buildStableTranscriptProjection({
      historicalSegments,
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [createEvent(2, { runId: "run-live", type: "thinking", message: "第一段", data: { field: "text", message_id: "msg-live" } })],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        finalOutput: "",
        updatedAt: "2026-04-02T00:00:02.000Z",
        includeSummary: true,
        includeToolCallParts: true
      }
    });

    const secondModel = buildStableTranscriptProjection({
      historicalSegments,
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [
          createEvent(2, { runId: "run-live", type: "thinking", message: "第一段", data: { field: "text", message_id: "msg-live" } }),
          createEvent(3, { runId: "run-live", type: "thinking", message: "第二段", data: { field: "text", message_id: "msg-live" } })
        ],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        finalOutput: "",
        updatedAt: "2026-04-02T00:00:03.000Z",
        includeSummary: true,
        includeToolCallParts: true
      },
      previousModel: firstModel
    });

    expect(secondModel.historicalMessages).toBe(firstModel.historicalMessages);
    expect(secondModel.historicalParts).toBe(firstModel.historicalParts);
    expect(secondModel.liveParts.map((part) => part.text)).toEqual(["当前问题", "第一段第二段"]);
    expect(secondModel.liveProjectionDebug).toMatchObject({
      reusedPreviousStore: true,
      appliedDeltaEventCount: 1
    });
  });

  it("dedupes overlapping historical and live assistant messages with the same logical anchor", () => {
    const overlappingSegment = {
      runId: "run-current",
      prompt: "当前问题",
      events: [createEvent(1, {
        runId: "run-current",
        type: "result",
        message: "当前回答",
        data: { message_id: "msg-current" }
      })],
      status: "done" as const,
      runStatus: "done" as const,
      streamStatus: "done" as const,
      finalOutput: "当前回答",
      updatedAt: "2026-04-02T00:00:01.000Z"
    };

    const model = buildStableTranscriptProjection({
      historicalSegments: [overlappingSegment],
      liveSegment: overlappingSegment
    });

    expect(model.messages).toHaveLength(2);
    expect(model.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(model.parts.filter((part) => part.kind === "text").map((part) => part.text)).toEqual(["当前回答"]);
  });

  it("does not replay the full live event array when only a new delta arrives", () => {
    const historicalSegments = [{
      runId: "run-history",
      prompt: "历史问题",
      events: [createEvent(1, { runId: "run-history", type: "result", message: "历史回答", data: { message_id: "msg-history" } })],
      status: "done" as const,
      finalOutput: "历史回答"
    }];

    const firstModel = buildStableTranscriptProjection({
      historicalSegments,
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [
          createEvent(2, { runId: "run-live", type: "thinking", message: "第一段", data: { field: "text", message_id: "msg-live" } }),
          createEvent(3, { runId: "run-live", type: "thinking", message: "第二段", data: { field: "text", message_id: "msg-live" } })
        ],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: true
      }
    });

    const secondModel = buildStableTranscriptProjection({
      historicalSegments,
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [
          createEvent(2, { runId: "run-live", type: "thinking", message: "第一段", data: { field: "text", message_id: "msg-live" } }),
          createEvent(3, { runId: "run-live", type: "thinking", message: "第二段", data: { field: "text", message_id: "msg-live" } }),
          createEvent(4, { runId: "run-live", type: "thinking", message: "第三段", data: { field: "text", message_id: "msg-live" } })
        ],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: true
      },
      previousModel: firstModel
    });

    expect(secondModel.liveProjectionDebug).toMatchObject({
      reusedPreviousStore: true,
      appliedDeltaEventCount: 1
    });
    expect(secondModel.liveProjectionState?.eventCount).toBe(3);
    expect(secondModel.liveParts.map((part) => part.text)).toEqual(["当前问题", "第一段第二段第三段"]);
  });

  it("falls back to rebuilding the live projection when the live event prefix changes", () => {
    const firstModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [createEvent(1, { runId: "run-live", type: "thinking", message: "第一段", data: { field: "text", message_id: "msg-live" } })],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: true
      }
    });

    const secondModel = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [createEvent(9, { runId: "run-live", type: "thinking", message: "替换后的首段", data: { field: "text", message_id: "msg-live" } })],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: true
      },
      previousModel: firstModel
    });

    expect(secondModel.liveProjectionDebug).toMatchObject({
      reusedPreviousStore: false,
      appliedDeltaEventCount: 1
    });
    expect(secondModel.liveParts.map((part) => part.text)).toEqual(["当前问题", "替换后的首段"]);
  });

  it("builds historical archive batches separately from live tail projection", () => {
    const model = buildStableTranscriptProjection({
      historicalSegments: [{
        runId: "run-history",
        prompt: "历史问题",
        events: [createEvent(1, { runId: "run-history", type: "result", message: "历史回答", data: { message_id: "msg-history" } })],
        status: "done",
        finalOutput: "历史回答"
      }],
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [createEvent(2, { runId: "run-live", type: "thinking", message: "当前回答", data: { field: "text", message_id: "msg-live" } })],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: true
      }
    });

    expect(model.historicalParts.map((part) => part.text)).toEqual(["历史问题", "历史回答"]);
    expect(model.liveParts.map((part) => part.text)).toEqual(["当前问题", "当前回答"]);
  });

  // @ArchitectureID: ELM-FUNC-EXT-PROJECT-TRANSCRIPT
  it("keeps deterministic order when accepted events arrive out of order", () => {
    const model = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [
          createEvent(3, {
            runId: "run-live",
            type: "thinking",
            message: "第三段",
            semantic: {
              channel: "assistant_text",
              emissionKind: "delta",
              identity: "assistant_text:msg-1:part-3",
              itemKind: "text",
              messageId: "msg-1",
              partId: "part-3"
            }
          }),
          createEvent(1, {
            runId: "run-live",
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
            runId: "run-live",
            type: "thinking",
            message: "第二段",
            semantic: {
              channel: "assistant_text",
              emissionKind: "delta",
              identity: "assistant_text:msg-1:part-2",
              itemKind: "text",
              messageId: "msg-1",
              partId: "part-2"
            }
          })
        ],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    expect(model.liveParts.map((part) => part.text)).toEqual(["当前问题", "第一段第二段第三段"]);
  });

  // @ArchitectureID: ELM-FUNC-EXT-PROJECT-TRANSCRIPT
  it("surfaces projection anomalies for terminal reopen conditions", () => {
    const model = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [
          createEvent(1, { runId: "run-live", type: "result", message: "最终回答", data: { message_id: "msg-1" } }),
          createEvent(2, { runId: "run-live", type: "thinking", message: "终态后重放", data: { field: "text", message_id: "msg-1" } })
        ],
        status: "done",
        runStatus: "done",
        streamStatus: "done",
        finalOutput: "最终回答",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    expect(model.anomalies?.some((anomaly) => anomaly.anomalyType === "terminal_reopen")).toBe(true);
    expect(model.projectionTraces).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "projection", step: "incremental_refresh" }),
      expect.objectContaining({ stage: "projection", step: "anomaly", outcome: "anomaly" })
    ]));
  });

  it("captures projection visibility traces for hidden tool fragments without changing visible transcript output", () => {
    const model = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [
          createEvent(1, {
            runId: "run-live",
            type: "tool_call",
            message: "调用工具",
            semantic: {
              channel: "tool",
              emissionKind: "delta",
              identity: "tool:msg-1:part-1",
              itemKind: "tool",
              messageId: "msg-1",
              partId: "part-1"
            }
          }),
          createEvent(2, {
            runId: "run-live",
            type: "result",
            message: "最终回答",
            data: { message_id: "msg-1" }
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

    expect(model.parts.map((part) => part.kind)).toEqual(["prompt", "text"]);
    expect(model.summaryPart?.kind).toBe("summary");
    expect(model.projectionTraces).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "projection", step: "visibility", outcome: "hidden" })
    ]));
  });

  it("keeps one assistant node and suppresses ghost user bubbles for adversarial mixed-order SSE", () => {
    const model = buildStableTranscriptProjection({
      historicalSegments: [],
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [
          createEvent(1, {
            runId: "run-live",
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
            runId: "run-live",
            type: "tool_call",
            message: "调用工具",
            semantic: {
              channel: "tool",
              emissionKind: "delta",
              identity: "tool:msg-1:tool-1",
              itemKind: "tool",
              messageId: "msg-1",
              partId: "tool-1"
            }
          }),
          createEvent(3, {
            runId: "run-live",
            type: "thinking",
            message: "第二段",
            semantic: {
              channel: "assistant_text",
              emissionKind: "delta",
              identity: "assistant_text:msg-1:part-2",
              itemKind: "text",
              messageId: "msg-1",
              partId: "part-2"
            }
          })
        ],
        answers: [{
          id: "answer-empty",
          runId: "run-live",
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

    expect(model.activeAssistantMessageId).toBe("message:run-live:assistant-message:run-live:msg-1:assistant");
    expect(model.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(model.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(model.parts.filter((part) => part.kind === "answer")).toHaveLength(0);
    expect(model.parts.filter((part) => part.kind === "text").map((part) => part.text)).toEqual(["第一段第二段"]);
    expect(model.tailPatch).toMatchObject({
      activeMessageId: "message:run-live:assistant-message:run-live:msg-1:assistant",
      fullText: "第一段第二段"
    });
  });

  it("preserves active assistant identity and sealed history during live tail updates", () => {
    const firstModel = buildStableTranscriptProjection({
      historicalSegments: [{
        runId: "run-history",
        prompt: "历史问题",
        events: [createEvent(1, { runId: "run-history", type: "result", message: "历史回答", data: { message_id: "msg-history" } })],
        status: "done",
        finalOutput: "历史回答"
      }],
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [createEvent(2, { runId: "run-live", type: "thinking", message: "A", data: { field: "text", message_id: "msg-live" } })],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      }
    });

    const secondModel = buildStableTranscriptProjection({
      historicalSegments: [{
        runId: "run-history",
        prompt: "历史问题",
        events: [createEvent(1, { runId: "run-history", type: "result", message: "历史回答", data: { message_id: "msg-history" } })],
        status: "done",
        finalOutput: "历史回答"
      }],
      liveSegment: {
        runId: "run-live",
        prompt: "当前问题",
        events: [
          createEvent(2, { runId: "run-live", type: "thinking", message: "A", data: { field: "text", message_id: "msg-live" } }),
          createEvent(3, { runId: "run-live", type: "thinking", message: "B", data: { field: "text", message_id: "msg-live" } })
        ],
        status: "streaming",
        runStatus: "streaming",
        streamStatus: "streaming",
        includeSummary: true,
        includeToolCallParts: false
      },
      previousModel: firstModel
    });

    expect(secondModel.historicalMessages).toBe(firstModel.historicalMessages);
    expect(secondModel.sealedMessages[0]).toBe(firstModel.sealedMessages[0]);
    expect(secondModel.activeAssistantMessageId).toBe(firstModel.activeAssistantMessageId);
    expect(secondModel.tailPatch?.fullText).toBe("AB");
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
