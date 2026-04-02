import { describe, expect, it } from "vitest";
import type { NormalizedRunEvent } from "../shared/protocol";
import { getActiveQuestionEvent, getNextPendingQuestionId } from "./questionState";

function createEvent(overrides: Partial<NormalizedRunEvent>): NormalizedRunEvent {
  return {
    id: "event-1",
    runId: "run-1",
    type: "thinking",
    createdAt: "2026-04-02T00:00:00.000Z",
    sequence: 1,
    message: "message",
    ...overrides
  };
}

describe("question stream state", () => {
  it("hides historical question cards after the pending question is cleared", () => {
    const historicalQuestion = createEvent({
      id: "event-question-1",
      type: "question",
      question: {
        questionId: "question-1",
        title: "请选择优先级",
        message: "继续前请回答",
        options: [],
        allowFreeText: true
      }
    });

    expect(getActiveQuestionEvent([historicalQuestion], "question-1")?.question?.questionId).toBe("question-1");
    expect(getActiveQuestionEvent([historicalQuestion], null)).toBeNull();
  });

  it("tracks the latest pending question and clears it on completion events", () => {
    const questionEvent = createEvent({
      id: "event-question-2",
      type: "question",
      question: {
        questionId: "question-2",
        title: "请选择优先级",
        message: "继续前请回答",
        options: [],
        allowFreeText: true
      }
    });

    expect(getNextPendingQuestionId(null, questionEvent)).toBe("question-2");
    expect(getNextPendingQuestionId("question-2", createEvent({ id: "event-result", type: "result" }))).toBeNull();
    expect(getNextPendingQuestionId("question-2", createEvent({ id: "event-error", type: "error" }))).toBeNull();
  });
});
