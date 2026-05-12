import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAIN_AGENT } from "../shared/protocol";
import { initialAssistantState } from "../shared/state";
import type { ActiveTabContext, AssistantState, PageRule, RuntimeMessage } from "../shared/types";
import type { NormalizedRunEvent, RawRunEventEnvelope, RunHistoryDetail, RunRecord } from "../shared/protocol";

const {
  mockCreateRunEventStream,
  mockCreateRawRunEventStream,
  mockSubmitQuestionAnswer,
  mockSubmitMessageFeedback,
  mockRefreshHistory,
  mockSaveRun,
  mockSaveEvent,
  mockSaveAnswer,
  mockLoadRunDetail,
  mockSelectRun,
  mockClearSelectedRun,
  mockRunHistoryState,
  mockBuildRunDiagnosticsSnapshot,
  mockDownloadRunDiagnosticsLog,
  mockStreamClose
} = vi.hoisted(() => {
  const mockRunHistoryState = {
    history: [] as RunRecord[],
    selectedHistoryDetail: null as AssistantState["selectedHistoryDetail"],
    runDetails: {} as Record<string, RunHistoryDetail | null>
  };

  const mockStreamClose = vi.fn();
  const mockCreateRunEventStream = vi.fn((runId: string, handlers: {
    onEvent: (event: NormalizedRunEvent) => Promise<void> | void;
    onError: (error: Error) => void;
    onStatusChange?: (status: "connecting" | "streaming" | "reconnecting") => void;
    onTransportLog?: (entry: Record<string, unknown>) => void;
    shouldClose?: (event: NormalizedRunEvent) => boolean;
  }) => ({ close: mockStreamClose }));

  const mockCreateRawRunEventStream = vi.fn((runId: string, handlers: {
    onEvent: (event: RawRunEventEnvelope) => Promise<void> | void;
    onError: (error: Error) => void;
    onStatusChange?: (status: "connecting" | "streaming" | "reconnecting") => void;
  }) => {
    mockCreateRunEventStream(runId, {
      onEvent: async (event: NormalizedRunEvent) => {
        await handlers.onEvent?.({
          id: event.id,
          runId: event.runId,
          createdAt: event.createdAt,
          sequence: event.sequence,
          source: "adapter",
          eventType: "normalized_event",
          payload: {
            event
          }
        });
      },
      onError: handlers.onError,
      onStatusChange: handlers.onStatusChange
    });

    return { close: mockStreamClose };
  });

  return {
    mockCreateRunEventStream,
    mockCreateRawRunEventStream,
    mockSubmitQuestionAnswer: vi.fn(),
    mockSubmitMessageFeedback: vi.fn(),
    mockRefreshHistory: vi.fn(async () => undefined),
    mockSaveRun: vi.fn(async () => undefined),
    mockSaveEvent: vi.fn(async () => undefined),
    mockSaveAnswer: vi.fn(async () => undefined),
    mockLoadRunDetail: vi.fn(async (runId: string) => mockRunHistoryState.runDetails[runId] ?? null),
    mockSelectRun: vi.fn(async () => undefined),
    mockClearSelectedRun: vi.fn(async () => undefined),
    mockBuildRunDiagnosticsSnapshot: vi.fn(() => ({ runMetadata: { runId: "run-1" } })),
    mockDownloadRunDiagnosticsLog: vi.fn(),
    mockStreamClose,
    mockRunHistoryState
  };
});

const mockExtensionConfig = vi.hoisted(() => ({
  extensionEnv: "production",
  apiBaseUrl: "https://api.example.com",
  apiKey: "",
  requestTimeoutMs: 10000,
  allowedApiOrigins: ["https://api.example.com"],
  optionalHostPermissions: ["https://example.com/*"],
  webAccessibleResourceMatches: ["https://example.com/*"],
  apiHostPermissions: ["https://api.example.com/*"]
}));

vi.mock("../shared/config", () => ({
  extensionConfig: mockExtensionConfig
}));

vi.mock("../shared/api", () => ({
  createRunEventStream: mockCreateRunEventStream,
  createRawRunEventStream: mockCreateRawRunEventStream,
  submitQuestionAnswer: mockSubmitQuestionAnswer,
  submitMessageFeedback: mockSubmitMessageFeedback
}));

vi.mock("./useRunHistory", () => ({
  useRunHistory: () => ({
    history: mockRunHistoryState.history,
    selectedHistoryDetail: mockRunHistoryState.selectedHistoryDetail,
    saveRun: mockSaveRun,
    saveEvent: mockSaveEvent,
    saveAnswer: mockSaveAnswer,
    loadRunDetail: mockLoadRunDetail,
    selectRun: mockSelectRun,
    clearSelectedRun: mockClearSelectedRun,
    refresh: mockRefreshHistory,
    setSelectedHistoryDetail: vi.fn()
  })
}));

vi.mock("./diagnostics", () => ({
  buildRunDiagnosticsSnapshot: mockBuildRunDiagnosticsSnapshot,
  downloadRunDiagnosticsLog: mockDownloadRunDiagnosticsLog
}));

vi.mock("./debugLogStore", () => ({
  appendSidepanelDebugLog: vi.fn(),
  clearSidepanelDebugLogs: vi.fn(),
  isSidepanelDiagnosticsEnabled: () => false
}));

const { App } = await import("./App");

/**
 * Guardrail: protects the controller-owned start-run boundary through the App host,
 * watching prompt handoff, raw-stream attachment, and failed-start behavior.
 */

interface ChromeStubOptions {
  contexts: ActiveTabContext[];
  startRunResponse?: { ok: boolean; data?: { runId: string; sessionId?: string; selectedAgent?: string; currentRun: AssistantState["currentRun"] }; error?: { message: string } };
  rules?: PageRule[];
  getStateResponse?: AssistantState;
}

function createContext(overrides: Partial<ActiveTabContext> = {}): ActiveTabContext {
  return {
    tabId: 1,
    url: "https://example.com/page",
    hostname: "example.com",
    restricted: false,
    matchedRule: { id: "rule-1", name: "Example rule" },
    permissionGranted: true,
    permissionOrigin: "https://example.com/*",
    canRequestPermission: true,
    activeTabFallbackAvailable: true,
    message: "当前页面已命中规则，可直接采集。",
    ...overrides
  };
}

function createCurrentRun() {
  return {
    runId: "run-1",
    sessionId: "ses-1",
    selectedAgent: DEFAULT_MAIN_AGENT,
    prompt: "hello",
    username: "alice",
    usernameSource: "dom_text" as const,
    softwareVersion: "v1",
    selectedSr: "SR-1",
    pageTitle: "Demo",
    pageUrl: "https://example.com/page",
    status: "streaming" as const,
    startedAt: "2026-04-02T00:00:00.000Z",
    updatedAt: "2026-04-02T00:00:00.000Z",
    finalOutput: ""
  };
}

function setupChromeStub(options: ChromeStubOptions) {
  const contextQueue = [...options.contexts];
  const listeners = new Set<(message: RuntimeMessage) => void>();
  let currentState = options.getStateResponse ?? initialAssistantState;
  const runtimeSendMessage = vi.fn(async (message: RuntimeMessage) => {
    switch (message.type) {
      case "GET_STATE":
        return currentState;
      case "GET_RULES":
        return options.rules ?? [];
      case "GET_ACTIVE_CONTEXT":
        return contextQueue.shift() ?? options.contexts[options.contexts.length - 1] ?? null;
      case "START_RUN":
        return options.startRunResponse ?? { ok: true, data: { runId: "run-1", selectedAgent: DEFAULT_MAIN_AGENT, currentRun: createCurrentRun() } };
      case "SYNC_RUN_STATE":
        currentState = {
          ...currentState,
          ...message.payload
        };
        return { ok: true };
      case "SET_MAIN_AGENT":
        currentState = {
          ...currentState,
          mainAgentPreference: message.payload.selectedAgent
        };
        return { ok: true, data: { selectedAgent: message.payload.selectedAgent } };
      case "CLEAR_RESULT":
        currentState = initialAssistantState;
        return { ok: true };
      default:
        return undefined;
    }
  });

  const onMessage = {
    addListener: vi.fn((listener: (message: RuntimeMessage) => void) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((listener: (message: RuntimeMessage) => void) => {
      listeners.delete(listener);
    })
  };

  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: runtimeSendMessage,
      onMessage
    },
    permissions: {
      request: vi.fn().mockResolvedValue(true),
      contains: vi.fn().mockResolvedValue(true)
    }
  } as unknown as typeof chrome);

  return {
    runtimeSendMessage
  };
}

async function flushUi() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useSidepanelController guardrail", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockRunHistoryState.history = [];
    mockRunHistoryState.selectedHistoryDetail = null;
    mockRunHistoryState.runDetails = {};
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.innerHTML = "";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    vi.unstubAllGlobals();
  });

  it("hands the typed prompt to START_RUN and attaches the raw stream", async () => {
    const { runtimeSendMessage } = setupChromeStub({
      contexts: [createContext()]
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const sendButton = container.querySelector(".send-button") as HTMLButtonElement;

    await act(async () => {
      textarea.value = "请总结当前页面风险";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushUi();

    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(runtimeSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "START_RUN",
      payload: expect.objectContaining({
        prompt: "请总结当前页面风险",
        selectedAgent: DEFAULT_MAIN_AGENT
      })
    }));
    expect(mockCreateRawRunEventStream).toHaveBeenCalledWith("run-1", expect.objectContaining({
      onEvent: expect.any(Function),
      onError: expect.any(Function),
      onStatusChange: expect.any(Function)
    }));
  });

  it("surfaces a start-run error without opening the raw stream", async () => {
    setupChromeStub({
      contexts: [createContext()],
      startRunResponse: {
        ok: false,
        error: { message: "启动 run 失败" }
      }
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const sendButton = container.querySelector(".send-button") as HTMLButtonElement;

    await act(async () => {
      textarea.value = "请总结当前页面风险";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushUi();

    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(mockCreateRawRunEventStream).not.toHaveBeenCalled();
    expect(mockSaveRun).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Run run-1");
  });
});
