import { beforeEach, describe, expect, it } from "vitest";
import { createIndexedDbHistoryStore } from "./history";
import { DEFAULT_MAIN_AGENT } from "./protocol";
import type { RunRecord } from "./protocol";

/** @ArchitectureID: ELM-FUNC-EXT-CALL-ADAPTER-API */
describe("indexedDB history store", () => {
  const store = createIndexedDbHistoryStore();

  beforeEach(async () => {
    if (typeof indexedDB === "undefined") {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("ai-web-assistant-history");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  });

  it("persists run, events and answers", async () => {
    const run: RunRecord = {
      runId: "run-1",
      selectedAgent: DEFAULT_MAIN_AGENT,
      prompt: "prompt",
      username: "alice",
      usernameSource: "dom_text",
      softwareVersion: "v1.2.3",
      selectedSr: "SR-001",
      pageTitle: "Title",
      pageUrl: "https://example.com",
      status: "streaming",
      startedAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
      finalOutput: ""
    };

    await store.saveRun(run);
    await store.saveEvent({
      id: "event-1",
      runId: "run-1",
      type: "thinking",
      createdAt: "2026-04-01T00:00:01.000Z",
      sequence: 1,
      message: "Thinking"
    });
    await store.saveAnswer({
      id: "answer-1",
      runId: "run-1",
      questionId: "question-1",
      answer: "yes",
      submittedAt: "2026-04-01T00:00:02.000Z"
    });

    const runs = await store.listRuns();
    const detail = await store.getRunDetail("run-1");

    expect(runs).toHaveLength(1);
    expect(detail?.events).toHaveLength(1);
    expect(detail?.answers[0]?.answer).toBe("yes");
  });

  /** @ArchitectureID: ELM-FUNC-EXT-CALL-ADAPTER-API */
  it("keeps sequence-advancing delta events while suppressing same-sequence replays", async () => {
    const run: RunRecord = {
      runId: "run-dup",
      selectedAgent: DEFAULT_MAIN_AGENT,
      prompt: "prompt",
      username: "alice",
      usernameSource: "dom_text",
      softwareVersion: "v1.2.3",
      selectedSr: "SR-001",
      pageTitle: "Title",
      pageUrl: "https://example.com",
      status: "streaming",
      startedAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
      finalOutput: ""
    };

    await store.saveRun(run);
    await store.saveEvent({
      id: "raw-1",
      runId: "run-dup",
      type: "thinking",
      createdAt: "2026-04-01T00:00:01.000Z",
      sequence: 1,
      message: "Hello",
      semantic: {
        channel: "assistant_text",
        emissionKind: "delta",
        identity: "assistant_text:msg-1:part-1",
        itemKind: "text",
        messageId: "msg-1",
        partId: "part-1"
      }
    });
    await store.saveEvent({
      id: "raw-2",
      runId: "run-dup",
      type: "thinking",
      createdAt: "2026-04-01T00:00:02.000Z",
      sequence: 2,
      message: "Hello world",
      semantic: {
        channel: "assistant_text",
        emissionKind: "delta",
        identity: "assistant_text:msg-1:part-1",
        itemKind: "text",
        messageId: "msg-1",
        partId: "part-1"
      }
    });
    await store.saveEvent({
      id: "raw-2-replay",
      runId: "run-dup",
      type: "thinking",
      createdAt: "2026-04-01T00:00:03.000Z",
      sequence: 2,
      message: "Hello world replay",
      semantic: {
        channel: "assistant_text",
        emissionKind: "delta",
        identity: "assistant_text:msg-1:part-1",
        itemKind: "text",
        messageId: "msg-1",
        partId: "part-1"
      }
    });

    const detail = await store.getRunDetail("run-dup");
    expect(detail?.events).toHaveLength(2);
    expect(detail?.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(detail?.events[0]?.message).toBe("Hello");
    expect(detail?.events[1]?.message).toBe("Hello world replay");
  });
});
