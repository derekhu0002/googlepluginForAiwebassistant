import { describe, expect, it } from "vitest";
import { createEmptyRunEventState } from "../shared/protocol";
import type { NormalizedRunEvent } from "../shared/protocol";
import { acceptIncomingRunEvent, deriveRunFinalOutput } from "./model";

// @ArchitectureID: ELM-FUNC-EXT-CONSUME-RUN-STREAM
describe("sidepanel canonical run-event acceptance", () => {
  function createEvent(sequence: number, overrides: Partial<NormalizedRunEvent> = {}): NormalizedRunEvent {
    return {
      id: `raw-${sequence}`,
      runId: "run-1",
      type: "thinking",
      createdAt: `2026-04-02T00:00:0${Math.min(sequence, 9)}.000Z`,
      sequence,
      message: `event-${sequence}`,
      ...overrides
    };
  }

  // @ArchitectureID: ELM-FUNC-EXT-CONSUME-RUN-STREAM
  it("accepts the first canonical event and records accepted frontier diagnostics", () => {
    const result = acceptIncomingRunEvent([], createEvent(1, {
      semantic: {
        channel: "assistant_text",
        emissionKind: "delta",
        identity: "assistant_text:msg-1:part-1",
        itemKind: "text",
        messageId: "msg-1",
        partId: "part-1"
      }
    }), createEmptyRunEventState());

    expect(result.accepted).toBe(true);
    expect(result.decision).toBe("accepted");
    expect(result.nextEvents).toHaveLength(1);
    expect(result.nextRunEventState.frontier.lastAcceptedCanonicalKey).toBe("assistant_text:msg-1:part-1:seq:1");
    expect(result.diagnostic.decision).toBe("accepted");
    expect(result.event.observability?.traces).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "acceptance", step: "decision", outcome: "accepted" })
    ]));
    expect(result.nextRunEventState.transportTraces).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "acceptance", step: "decision", outcome: "accepted" })
    ]));
  });

  // @ArchitectureID: ELM-FUNC-EXT-CONSUME-RUN-STREAM
  it("accepts later delta events for the same semantic part when sequence advances", () => {
    const initial = acceptIncomingRunEvent([], createEvent(1, {
      id: "raw-a",
      semantic: {
        channel: "assistant_text",
        emissionKind: "delta",
        identity: "assistant_text:msg-1:part-1",
        itemKind: "text",
        messageId: "msg-1",
        partId: "part-1"
      }
    }), createEmptyRunEventState());

    const advancedDelta = acceptIncomingRunEvent(initial.nextEvents, createEvent(2, {
      id: "raw-b",
      semantic: {
        channel: "assistant_text",
        emissionKind: "delta",
        identity: "assistant_text:msg-1:part-1",
        itemKind: "text",
        messageId: "msg-1",
        partId: "part-1"
      }
    }), initial.nextRunEventState);

    expect(advancedDelta.accepted).toBe(true);
    expect(advancedDelta.decision).toBe("accepted");
    expect(advancedDelta.nextEvents).toHaveLength(2);
    expect(advancedDelta.nextEvents.map((event) => event.sequence)).toEqual([1, 2]);
    expect(advancedDelta.diagnostic.canonicalEventKey).toBe("assistant_text:msg-1:part-1:seq:2");
  });

  it("rejects same-sequence delta replays even when raw ids differ", () => {
    const initial = acceptIncomingRunEvent([], createEvent(1, {
      id: "raw-a",
      semantic: {
        channel: "assistant_text",
        emissionKind: "delta",
        identity: "assistant_text:msg-1:part-1",
        itemKind: "text",
        messageId: "msg-1",
        partId: "part-1"
      }
    }), createEmptyRunEventState());

    const duplicate = acceptIncomingRunEvent(initial.nextEvents, createEvent(1, {
      id: "raw-b",
      createdAt: "2026-04-02T00:00:09.000Z",
      message: "event-1 replay",
      semantic: {
        channel: "assistant_text",
        emissionKind: "delta",
        identity: "assistant_text:msg-1:part-1",
        itemKind: "text",
        messageId: "msg-1",
        partId: "part-1"
      }
    }), initial.nextRunEventState);

    expect(duplicate.accepted).toBe(false);
    expect(duplicate.decision).toBe("duplicate");
    expect(duplicate.nextEvents).toHaveLength(1);
    expect(duplicate.diagnostic.canonicalEventKey).toBe("assistant_text:msg-1:part-1:seq:1");
  });

  // @ArchitectureID: ELM-FUNC-EXT-CONSUME-RUN-STREAM
  it("rejects stale replay when the incoming sequence does not advance the contiguous frontier", () => {
    const first = acceptIncomingRunEvent([], createEvent(1), createEmptyRunEventState());
    const second = acceptIncomingRunEvent(first.nextEvents, createEvent(2), first.nextRunEventState);
    const staleReplay = acceptIncomingRunEvent(second.nextEvents, createEvent(1, {
      id: "raw-replay",
      semantic: {
        channel: "assistant_text",
        emissionKind: "delta",
        identity: "assistant_text:msg-replay:part-1",
        itemKind: "text",
        messageId: "msg-replay",
        partId: "part-1"
      }
    }), second.nextRunEventState);

    expect(staleReplay.accepted).toBe(false);
    expect(staleReplay.decision).toBe("stale_replay");
    expect(staleReplay.diagnostic.priorFrontierSequence).toBe(2);
  });

  // @ArchitectureID: ELM-FUNC-EXT-CONSUME-RUN-STREAM
  it("classifies sequence gaps while still accepting monotonic frontier advance", () => {
    const first = acceptIncomingRunEvent([], createEvent(1), createEmptyRunEventState());
    const gap = acceptIncomingRunEvent(first.nextEvents, createEvent(3), first.nextRunEventState);

    expect(gap.accepted).toBe(true);
    expect(gap.decision).toBe("gap");
    expect(gap.diagnostic.classification).toBe("gap");
    expect(gap.nextRunEventState.frontier.lastSequence).toBe(3);
  });

  // @ArchitectureID: ELM-FUNC-EXT-CONSUME-RUN-STREAM
  it("classifies out-of-order arrivals without duplicating accepted events", () => {
    const first = acceptIncomingRunEvent([], createEvent(1), createEmptyRunEventState());
    const gap = acceptIncomingRunEvent(first.nextEvents, createEvent(3), first.nextRunEventState);
    const outOfOrder = acceptIncomingRunEvent(gap.nextEvents, createEvent(2), gap.nextRunEventState);

    expect(outOfOrder.accepted).toBe(true);
    expect(outOfOrder.decision).toBe("out_of_order");
    expect(outOfOrder.diagnostic.classification).toBe("out_of_order");
    expect(outOfOrder.nextEvents.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it("captures frontier before/after and sync-ready acceptance diagnostics for rejected events", () => {
    const first = acceptIncomingRunEvent([], createEvent(1), createEmptyRunEventState());
    const duplicate = acceptIncomingRunEvent(first.nextEvents, createEvent(2, {
      id: "raw-duplicate",
      semantic: {
        channel: "assistant_text",
        emissionKind: "delta",
        identity: "assistant_text:msg-dup:part-1",
        itemKind: "text",
        messageId: "msg-dup",
        partId: "part-1"
      }
    }), first.nextRunEventState);

    expect(duplicate.accepted).toBe(true);
    const replay = acceptIncomingRunEvent(duplicate.nextEvents, createEvent(3, {
      id: "raw-duplicate-replay",
      sequence: 2,
      createdAt: "2026-04-02T00:00:09.000Z",
      semantic: {
        channel: "assistant_text",
        emissionKind: "delta",
        identity: "assistant_text:msg-dup:part-1",
        itemKind: "text",
        messageId: "msg-dup",
        partId: "part-1"
      }
    }), duplicate.nextRunEventState);

    expect(replay.accepted).toBe(false);
    expect(replay.diagnostic.priorFrontier).toMatchObject({ lastSequence: 2 });
    expect(replay.diagnostic.resultingFrontier).toMatchObject({ lastSequence: 2 });
    expect(replay.nextRunEventState.diagnostics.at(-1)).toMatchObject({
      decision: "duplicate",
      priorFrontier: expect.objectContaining({ lastSequence: 2 }),
      resultingFrontier: expect.objectContaining({ lastSequence: 2 })
    });
  });

  it("derives streaming final output from accepted assistant text events instead of stale persisted text", () => {
    const nextEvents = [
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
      })
    ];

    expect(deriveRunFinalOutput("第一段", nextEvents[1], nextEvents, "streaming")).toBe("第一段第二段");
  });

  it("keeps the longer assistant text when delayed same-run text arrives after a result event", () => {
    const nextEvents = [
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
      createEvent(2, { type: "result", message: "第一段" }),
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
    ];

    expect(deriveRunFinalOutput("第一段", nextEvents[2], nextEvents, "done")).toBe("第一段第二段");
  });
});
