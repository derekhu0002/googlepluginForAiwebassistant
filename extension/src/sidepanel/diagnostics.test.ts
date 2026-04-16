import { describe, expect, it } from "vitest";
import { DEFAULT_MAIN_AGENT } from "../shared/protocol";
import { initialAssistantState } from "../shared/state";
import type { AssistantState } from "../shared/types";
import { buildRunDiagnosticsSnapshot, createRunDiagnosticsFilename, formatRunDiagnosticsLog } from "./diagnostics";
import { buildStableTranscriptProjection } from "./reasoningTimeline";

function createRun() {
  return {
    runId: "run-diag-1",
    sessionId: "ses-diag-1",
    selectedAgent: DEFAULT_MAIN_AGENT,
    prompt: "why is content missing?",
    username: "alice",
    usernameSource: "dom_text" as const,
    softwareVersion: "v1",
    selectedSr: "SR-1",
    pageTitle: "Demo page",
    pageUrl: "https://example.com/page",
    status: "done" as const,
    startedAt: "2026-04-02T00:00:00.000Z",
    updatedAt: "2026-04-02T00:00:05.000Z",
    finalOutput: "Final answer"
  };
}

function createSidepanelState(): AssistantState {
  const run = createRun();
  return {
    ...initialAssistantState,
    status: "done",
    currentRun: run,
    runEvents: [
      {
        id: "event-tool",
        runId: run.runId,
        type: "tool_call",
        createdAt: "2026-04-02T00:00:01.000Z",
        sequence: 1,
        message: "Inspecting tool output"
      },
      {
        id: "event-thinking",
        runId: run.runId,
        type: "thinking",
        createdAt: "2026-04-02T00:00:02.000Z",
        sequence: 2,
        message: "Reasoning preview",
        data: { message_id: "msg-1", field: "text" }
      },
      {
        id: "event-result",
        runId: run.runId,
        type: "result",
        createdAt: "2026-04-02T00:00:05.000Z",
        sequence: 3,
        message: "Final answer"
      }
    ],
    answers: [],
    stream: {
      runId: run.runId,
      status: "done",
      pendingQuestionId: null
    },
    runEventState: {
      ...initialAssistantState.runEventState,
      transportTraces: [{
        stage: "transport",
        step: "receipt",
        outcome: "info",
        createdAt: "2026-04-02T00:00:01.000Z",
        correlation: {
          runId: run.runId,
          rawEventId: "event-tool",
          canonicalEventKey: null,
          sequence: 1,
          contentKey: "tool",
          contentPreview: "Inspecting tool output"
        }
      }]
    },
    renderTrace: [{
      stage: "render",
      step: "render_path",
      outcome: "info",
      createdAt: "2026-04-02T00:00:06.000Z",
      correlation: {
        runId: run.runId,
        rawEventId: "event-result",
        canonicalEventKey: "msg-1",
        sequence: 3,
        contentKey: "result",
        contentPreview: "Final answer"
      }
    }]
  };
}

describe("run diagnostics exporter", () => {
  it("captures transcript visibility hints for hidden tool parts", () => {
    const state = createSidepanelState();
    const snapshot = buildRunDiagnosticsSnapshot({
      source: {
        scope: "live",
        run: state.currentRun!,
        events: state.runEvents,
        answers: state.answers,
        assistantStatus: state.status,
        streamStatus: state.stream.status,
        pendingQuestionId: state.stream.pendingQuestionId
      },
      sidepanelState: state,
      backgroundState: state,
      transcriptReadModel: buildStableTranscriptProjection({
        historicalSegments: [],
        liveSegment: {
          runId: state.currentRun!.runId,
          prompt: state.currentRun!.prompt,
          events: state.runEvents,
          answers: state.answers,
          finalOutput: state.currentRun!.finalOutput,
          status: state.currentRun!.status,
          runStatus: state.currentRun!.status,
          streamStatus: state.stream.status,
          includeSummary: true,
          includeToolCallParts: false
        }
      }),
      renderTrace: state.renderTrace,
      exportedAt: "2026-04-02T00:00:06.000Z"
    });

    expect(snapshot.derived.presentationState.hasTerminalEvidence).toBe(true);
    expect(snapshot.derived.visibilityHints.withToolsToolPartCount).toBeGreaterThan(0);
    expect(snapshot.derived.visibilityHints.hiddenToolPartCount).toBeGreaterThan(0);
    expect(snapshot.transcript.visible.partCount).toBeLessThan(snapshot.transcript.withTools.partCount);
    expect(snapshot.sessionUi.mainStageTranscriptSource).toBe("transcript.visible");
    expect(snapshot.sessionUi.displayedPartCount).toBe(snapshot.transcript.visible.partCount);
    expect(snapshot.sessionUi.hiddenDiagnosticOnlyPartCount).toBeGreaterThan(0);
    expect(snapshot.sessionUi.diagnosticOnlyParts.some((part) => part.kind === "tool")).toBe(true);
    expect(snapshot.observability.stageCounts.transport).toBeGreaterThan(0);
    expect(snapshot.observability.stageCounts.render).toBeGreaterThan(0);
  });

  it("formats a human-readable diagnostics log", () => {
    const state = createSidepanelState();
    const snapshot = buildRunDiagnosticsSnapshot({
      source: {
        scope: "live",
        run: state.currentRun!,
        events: state.runEvents,
        answers: state.answers,
        assistantStatus: state.status,
        streamStatus: state.stream.status,
        pendingQuestionId: state.stream.pendingQuestionId
      },
      sidepanelState: state,
      backgroundState: null,
      transcriptReadModel: buildStableTranscriptProjection({
        historicalSegments: [],
        liveSegment: {
          runId: state.currentRun!.runId,
          prompt: state.currentRun!.prompt,
          events: state.runEvents,
          answers: state.answers,
          finalOutput: state.currentRun!.finalOutput,
          status: state.currentRun!.status,
          runStatus: state.currentRun!.status,
          streamStatus: state.stream.status,
          includeSummary: true,
          includeToolCallParts: false
        }
      }),
      renderTrace: state.renderTrace,
      exportedAt: "2026-04-02T00:00:06.000Z"
    });

    const content = formatRunDiagnosticsLog(snapshot);

    expect(content).toContain("=== RUN_METADATA ===");
    expect(content).toContain("=== SESSION_UI ===");
    expect(content).toContain("transcript.visible");
    expect(content).toContain("=== TRANSCRIPT_WITH_TOOLS ===");
    expect(content).toContain("=== OBSERVABILITY ===");
    expect(content).toContain("event-tool");
    expect(createRunDiagnosticsFilename("run-diag-1", "2026-04-02T00:00:06.000Z")).toBe("aiwa-diagnostics-run-diag-1-2026-04-02T00-00-06-000Z.log");
  });
});
