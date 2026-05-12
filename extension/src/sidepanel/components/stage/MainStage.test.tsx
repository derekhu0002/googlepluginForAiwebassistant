import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialAssistantState } from "../../../shared/state";

const mockTimelineProps = vi.hoisted(() => vi.fn());

vi.mock("../../reasoningTimelineView", () => ({
  ReasoningTimeline: (props: Record<string, unknown>) => {
    mockTimelineProps(props);
    return (
      <div
        data-testid="timeline"
        data-event-count={Array.isArray(props.events) ? props.events.length : -1}
        data-answer-count={Array.isArray(props.answers) ? props.answers.length : -1}
      >
        timeline
      </div>
    );
  }
}));

const { MainStage } = await import("./MainStage");

/**
 * Guardrail: protects the main stage against live/history transcript mixing,
 * empty-state regressions, and permission-callout collisions with transcript rendering.
 */

function createProps(overrides: Partial<Parameters<typeof MainStage>[0]> = {}): Parameters<typeof MainStage>[0] {
  return {
    activeContext: null,
    canShowPermissionButton: true,
    contextError: "",
    diagnosticsError: "",
    exportingDiagnostics: false,
    isBusy: false,
    livePrompt: "请总结当前风险",
    onExportDiagnostics: vi.fn(),
    liveConversationSegments: [],
    onQuestionSubmit: vi.fn(),
    onRequestPermission: vi.fn(),
    onRetry: vi.fn(),
    onRenderTrace: vi.fn(),
    onStartFreshSession: vi.fn(),
    questionSubmitDisabled: false,
    requestingPermission: false,
    selectedConversationHasContent: true,
    selectedSessionIsCurrent: true,
    selectedSessionItem: null,
    transcriptReadModel: {
      messages: [],
      sealedMessages: [],
      activeMessage: null,
      activeAssistantMessageId: null,
      tailPatch: null,
      processParts: [],
      liveMessages: [],
      finalAnswerPart: null,
      questionPart: null,
      errorPart: null,
      terminalState: false,
      parts: [],
      summaryPart: null,
      summaryState: null,
      historicalMessages: [],
      historicalParts: [],
      liveParts: [],
      historicalSignature: "history:empty",
      liveSignature: null
    },
    selectedThreadError: null,
    selectedThreadFinalOutput: "最终回答",
    selectedThreadRun: {
      runId: "run-1",
      sessionId: "ses-1",
      selectedAgent: "ThreatIntelAnalyst",
      prompt: "请总结当前风险",
      username: "alice",
      usernameSource: "dom_text",
      softwareVersion: "v2026.04.02",
      selectedSr: "SR-001",
      pageTitle: "Example page",
      pageUrl: "https://example.com/page",
      status: "done",
      startedAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:03.000Z",
      finalOutput: "最终回答"
    },
    selectedThreadStatus: "done",
    selectedThreadStreamStatus: "done",
    selectedThreadUpdatedAt: "2026-04-02T00:00:03.000Z",
    shouldShowPermissionCallout: false,
    state: {
      ...initialAssistantState,
      runEvents: [
        {
          id: "event-1",
          runId: "run-1",
          type: "result",
          createdAt: "2026-04-02T00:00:01.000Z",
          sequence: 1,
          message: "最终回答"
        }
      ],
      answers: [
        {
          id: "answer-1",
          runId: "run-1",
          questionId: "q-1",
          answer: "继续",
          choiceId: "resume",
          submittedAt: "2026-04-02T00:00:02.000Z"
        }
      ],
      stream: {
        runId: "run-1",
        status: "done",
        pendingQuestionId: null,
        reconnectCount: 0
      }
    },
    ...overrides
  };
}

describe("MainStage guardrail", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    // @ts-expect-error test-only React act environment flag
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    mockTimelineProps.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("shows the empty state when no transcript content is selected", async () => {
    await act(async () => {
      root.render(<MainStage {...createProps({ selectedConversationHasContent: false })} />);
    });

    expect(container.textContent).toContain("开始一段新的会话");
    expect(container.querySelector('[data-testid="timeline"]')).toBeNull();
  });

  it("only passes live events and answers to the timeline for the current session", async () => {
    await act(async () => {
      root.render(<MainStage {...createProps({ selectedSessionIsCurrent: false })} />);
    });

    let timeline = container.querySelector('[data-testid="timeline"]') as HTMLDivElement;
    expect(timeline.dataset.eventCount).toBe("0");
    expect(timeline.dataset.answerCount).toBe("0");

    await act(async () => {
      root.render(<MainStage {...createProps({ selectedSessionIsCurrent: true })} />);
    });

    timeline = container.querySelector('[data-testid="timeline"]') as HTMLDivElement;
    expect(timeline.dataset.eventCount).toBe("1");
    expect(timeline.dataset.answerCount).toBe("1");
    const lastProps = mockTimelineProps.mock.calls.at(-1)?.[0];
    expect(lastProps).toEqual(expect.objectContaining({
      live: true,
      events: expect.arrayContaining([expect.objectContaining({ id: "event-1" })]),
      answers: expect.arrayContaining([expect.objectContaining({ id: "answer-1" })])
    }));
  });

  it("keeps the permission callout visible without suppressing the transcript", async () => {
    await act(async () => {
      root.render(
        <MainStage
          {...createProps({
            shouldShowPermissionCallout: true,
            activeContext: {
              tabId: 1,
              url: "https://example.com/page",
              hostname: "example.com",
              restricted: false,
              matchedRule: null,
              permissionGranted: false,
              permissionOrigin: "https://example.com/*",
              canRequestPermission: true,
              activeTabFallbackAvailable: true,
              message: "当前页面需要先授权域名访问"
            }
          })}
        />
      );
    });

    expect(container.textContent).toContain("当前页面需要先授权域名访问");
    expect(container.querySelector('[data-testid="timeline"]')).toBeTruthy();
  });
});