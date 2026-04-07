import type { NormalizedRunEvent } from "../shared/protocol";

/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-SHELL */
export function getActiveQuestionEvent(runEvents: NormalizedRunEvent[], pendingQuestionId: string | null): NormalizedRunEvent | null {
  if (!pendingQuestionId) {
    return null;
  }

  return [...runEvents].reverse().find((event) => event.type === "question" && event.question?.questionId === pendingQuestionId) ?? null;
}

/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-SHELL */
export function getNextPendingQuestionId(currentPendingQuestionId: string | null, event: NormalizedRunEvent): string | null {
  if (event.type === "question" && event.question?.questionId) {
    return event.question.questionId;
  }

  if (event.type === "result" || event.type === "error") {
    return null;
  }

  return currentPendingQuestionId;
}
