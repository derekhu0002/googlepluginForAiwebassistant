import { describe, expect, it } from "vitest";

import { createOpencodeRawEventProjector } from "./opencodeRawEventProjector";

describe("opencode raw event projector", () => {
  it("buffers part deltas until text part type is known and emits final result from session snapshot", () => {
    const projector = createOpencodeRawEventProjector("run-1");

    const deltaEvents = projector.project({
      id: "run-1-raw-1",
      runId: "run-1",
      createdAt: "2026-04-01T00:00:00.000Z",
      sequence: 1,
      source: "opencode",
      eventType: "message.part.delta",
      payload: {
        event: {
          payload: {
            type: "message.part.delta",
            properties: {
              sessionID: "ses-1",
              messageID: "msg-1",
              partID: "part-1",
              delta: "partial result"
            }
          }
        }
      }
    });

    expect(deltaEvents).toEqual([]);

    const updatedEvents = projector.project({
      id: "run-1-raw-2",
      runId: "run-1",
      createdAt: "2026-04-01T00:00:01.000Z",
      sequence: 2,
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
                text: "partial result"
              }
            }
          }
        }
      }
    });

    expect(updatedEvents).toHaveLength(1);
    expect(updatedEvents[0]).toMatchObject({
      type: "thinking",
      message: "partial result",
      data: { field: "text", message_id: "msg-1" },
      semantic: {
        channel: "assistant_text",
        emissionKind: "delta",
        messageId: "msg-1",
        partId: "part-1"
      }
    });

    const resultEvents = projector.project({
      id: "run-1-raw-3",
      runId: "run-1",
      createdAt: "2026-04-01T00:00:02.000Z",
      sequence: 3,
      source: "adapter",
      eventType: "session.messages",
      payload: {
        session_id: "ses-1",
        messages: [
          {
            info: { id: "msg-1", role: "assistant" },
            parts: [{ type: "text", text: "final answer from session" }]
          }
        ]
      }
    });

    expect(resultEvents).toHaveLength(1);
    expect(resultEvents[0]).toMatchObject({
      type: "result",
      message: "final answer from session",
      semantic: {
        channel: "assistant_text",
        emissionKind: "final",
        messageId: "msg-1"
      }
    });
  });

  it("projects raw question events into normalized question cards", () => {
    const projector = createOpencodeRawEventProjector("run-2");

    const events = projector.project({
      id: "run-2-raw-1",
      runId: "run-2",
      createdAt: "2026-04-01T00:00:00.000Z",
      sequence: 1,
      source: "opencode",
      eventType: "question.asked",
      payload: {
        event: {
          payload: {
            type: "question.asked",
            properties: {
              id: "req-1",
              sessionID: "ses-1",
              questions: [
                {
                  header: "请选择优先级",
                  question: "当前请求优先级是什么？",
                  options: [{ label: "高" }],
                  custom: true
                }
              ]
            }
          }
        }
      }
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "question",
      question: {
        questionId: "req-1",
        title: "请选择优先级",
        message: "当前请求优先级是什么？",
        allowFreeText: true,
        options: [{ label: "高", value: "高" }]
      }
    });
  });
});