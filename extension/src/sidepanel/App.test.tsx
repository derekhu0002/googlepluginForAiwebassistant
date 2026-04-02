import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialAssistantState } from "../shared/state";
import type { ActiveTabContext, AssistantState, PageRule, RuntimeMessage } from "../shared/types";
import type { NormalizedRunEvent } from "../shared/protocol";

const {
  mockCreateRunEventStream,
  mockSubmitQuestionAnswer,
  mockRefreshHistory,
  mockSaveRun,
  mockSaveEvent,
  mockSaveAnswer,
  mockSelectRun,
  mockRunHistoryState,
  mockStreamClose
} = vi.hoisted(() => ({
  mockCreateRunEventStream: vi.fn(() => ({ close: mockStreamClose })),
  mockSubmitQuestionAnswer: vi.fn(),
  mockRefreshHistory: vi.fn(async () => undefined),
  mockSaveRun: vi.fn(async () => undefined),
  mockSaveEvent: vi.fn(async () => undefined),
  mockSaveAnswer: vi.fn(async () => undefined),
  mockSelectRun: vi.fn(async () => undefined),
  mockStreamClose: vi.fn(),
  mockRunHistoryState: {
    history: [] as never[],
    selectedHistoryDetail: null as null
  }
}));

vi.mock("../shared/api", () => ({
  createRunEventStream: mockCreateRunEventStream,
  submitQuestionAnswer: mockSubmitQuestionAnswer
}));

vi.mock("./useRunHistory", () => ({
  useRunHistory: () => ({
    history: mockRunHistoryState.history,
    selectedHistoryDetail: mockRunHistoryState.selectedHistoryDetail,
    saveRun: mockSaveRun,
    saveEvent: mockSaveEvent,
    saveAnswer: mockSaveAnswer,
    selectRun: mockSelectRun,
    refresh: mockRefreshHistory,
    setSelectedHistoryDetail: vi.fn()
  })
}));

const { App, mergeStateUpdate } = await import("./App");

interface ChromeStubOptions {
  contexts: ActiveTabContext[];
  permissionsRequest?: ReturnType<typeof vi.fn>;
  startRunResponse?: { ok: boolean; data?: { runId: string; currentRun: AssistantState["currentRun"] }; error?: { message: string } };
  rules?: PageRule[];
}

function createContext(overrides: Partial<ActiveTabContext> = {}): ActiveTabContext {
  return {
    tabId: 1,
    url: "https://example.com/page",
    hostname: "example.com",
    restricted: false,
    matchedRule: { id: "rule-1", name: "Example rule" },
    permissionGranted: false,
    permissionOrigin: "https://example.com/*",
    canRequestPermission: true,
    activeTabFallbackAvailable: true,
    message: "当前页面已命中规则，但仍需授予该域名权限。",
    ...overrides
  };
}

function createCurrentRun() {
  return {
    runId: "run-1",
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

function createRunEvent(sequence: number, overrides: Partial<NormalizedRunEvent> = {}): NormalizedRunEvent {
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

function createAssistantState(overrides: Partial<AssistantState> = {}): AssistantState {
  return {
    ...initialAssistantState,
    currentRun: createCurrentRun(),
    status: "streaming",
    stream: {
      runId: "run-1",
      status: "streaming",
      pendingQuestionId: null
    },
    ...overrides
  };
}

function setupChromeStub(options: ChromeStubOptions) {
  const contextQueue = [...options.contexts];
  const runtimeSendMessage = vi.fn(async (message: RuntimeMessage) => {
    switch (message.type) {
      case "GET_STATE":
        return initialAssistantState;
      case "GET_RULES":
        return options.rules ?? [];
      case "GET_ACTIVE_CONTEXT":
        return contextQueue.shift() ?? options.contexts[options.contexts.length - 1] ?? null;
      case "START_RUN":
        return options.startRunResponse ?? { ok: true, data: { runId: "run-1", currentRun: createCurrentRun() } };
      default:
        return undefined;
    }
  });

  const onMessage = {
    addListener: vi.fn(),
    removeListener: vi.fn()
  };

  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: runtimeSendMessage,
      onMessage
    },
    permissions: {
      request: options.permissionsRequest ?? vi.fn().mockResolvedValue(true),
      contains: vi.fn().mockResolvedValue(true)
    }
  } as unknown as typeof chrome);

  return {
    runtimeSendMessage,
    permissionsRequest: (globalThis.chrome.permissions.request as ReturnType<typeof vi.fn>)
  };
}

async function flushUi() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("side panel host permission request flow", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
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

  it("requests host permission directly in side panel and refreshes granted state", async () => {
    const { runtimeSendMessage, permissionsRequest } = setupChromeStub({
      contexts: [
        createContext(),
        createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })
      ]
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const button = Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.includes("授权当前域名"));
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(permissionsRequest).toHaveBeenCalledWith({ origins: ["https://example.com/*"] });
    expect(runtimeSendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "REQUEST_HOST_PERMISSION" }));
    expect(container.textContent).toContain("域名已授权");
  });

  it("shows explicit error when user rejects the permission prompt", async () => {
    const { permissionsRequest } = setupChromeStub({
      contexts: [createContext()],
      permissionsRequest: vi.fn().mockResolvedValue(false)
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const button = Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.includes("授权当前域名"));
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(permissionsRequest).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("你已拒绝当前域名授权");
  });

  it("shows explicit error when permission API throws", async () => {
    setupChromeStub({
      contexts: [createContext()],
      permissionsRequest: vi.fn().mockRejectedValue(new Error("Permission prompt must be triggered by user gesture"))
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const button = Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.includes("授权当前域名"));
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(container.textContent).toContain("触发当前域名授权失败：Permission prompt must be triggered by user gesture");
  });

  it("keeps the existing start-run flow working after the permission change", async () => {
    const { runtimeSendMessage } = setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })]
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const startButton = Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.includes("采集并开始 SSE Run"));
    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "START_RUN", payload: { prompt: initialAssistantState.runPrompt } });
    expect(mockCreateRunEventStream).toHaveBeenCalledWith("run-1", expect.objectContaining({ onEvent: expect.any(Function), onError: expect.any(Function) }));
  });

  it("shows reconnecting status without surfacing a terminal error and returns to streaming after reopen", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })]
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const startButton = Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.includes("采集并开始 SSE Run"));
    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    const lastCall = (mockCreateRunEventStream.mock.calls as unknown[][]).at(-1);
    if (!lastCall) {
      throw new Error("expected createRunEventStream to be called");
    }
    const handlers = lastCall[1] as unknown as { onStatusChange?: (status: "connecting" | "streaming" | "reconnecting") => void; onError: (error: Error) => void };
    expect(container.textContent).toContain("流连接：connecting");

    await act(async () => {
      handlers.onStatusChange?.("reconnecting");
    });
    await flushUi();

    expect(container.textContent).toContain("流连接：reconnecting");
    expect(container.textContent).not.toContain("SSE connection failed");

    await act(async () => {
      handlers.onStatusChange?.("streaming");
    });
    await flushUi();

    expect(container.textContent).toContain("流连接：streaming");
  });

  it("keeps local run events when STATE_UPDATED carries empty events for the active run", () => {
    const current = createAssistantState({
      runEvents: [createRunEvent(1), createRunEvent(2)]
    });
    const payload = createAssistantState({
      runEvents: [],
      currentRun: {
        ...createCurrentRun(),
        updatedAt: "2026-04-02T00:00:01.000Z"
      }
    });

    const merged = mergeStateUpdate(current, payload, [], null);

    expect(merged.runEvents).toHaveLength(2);
    expect(merged.runEvents.map((event) => event.id)).toEqual(["event-1", "event-2"]);
    expect(merged.stream.status).toBe("streaming");
    expect(merged.currentRun?.runId).toBe("run-1");
  });

  it("still syncs background state for a different run", () => {
    const current = createAssistantState({
      runEvents: [createRunEvent(1)],
      capturedFields: { software_version: "v1" }
    });
    const payload = createAssistantState({
      runEvents: [],
      currentRun: {
        ...createCurrentRun(),
        runId: "run-2",
        status: "done",
        updatedAt: "2026-04-02T00:00:05.000Z",
        finalOutput: "done"
      },
      stream: {
        runId: "run-2",
        status: "done",
        pendingQuestionId: null
      },
      status: "done",
      capturedFields: { software_version: "v2", selected_sr: "SR-2" }
    });

    const merged = mergeStateUpdate(current, payload, [], null);

    expect(merged.runEvents).toEqual([]);
    expect(merged.currentRun?.runId).toBe("run-2");
    expect(merged.status).toBe("done");
    expect(merged.stream.status).toBe("done");
    expect(merged.capturedFields).toEqual({ software_version: "v2", selected_sr: "SR-2" });
  });

  it("keeps the final result state when a stale active-run update arrives after completion", () => {
    const resultEvent = createRunEvent(3, {
      type: "result",
      message: "final answer"
    });
    const current = createAssistantState({
      runEvents: [createRunEvent(1), resultEvent],
      status: "done",
      currentRun: {
        ...createCurrentRun(),
        status: "done",
        updatedAt: "2026-04-02T00:00:03.000Z",
        finalOutput: "final answer"
      },
      stream: {
        runId: "run-1",
        status: "done",
        pendingQuestionId: null
      }
    });
    const payload = createAssistantState({
      runEvents: [],
      currentRun: {
        ...createCurrentRun(),
        status: "streaming",
        updatedAt: "2026-04-02T00:00:01.000Z",
        finalOutput: ""
      },
      status: "streaming",
      stream: {
        runId: "run-1",
        status: "streaming",
        pendingQuestionId: null
      }
    });

    const merged = mergeStateUpdate(current, payload, [], null);

    expect(merged.status).toBe("done");
    expect(merged.stream.status).toBe("done");
    expect(merged.currentRun?.status).toBe("done");
    expect(merged.currentRun?.finalOutput).toBe("final answer");
    expect(merged.runEvents.at(-1)?.type).toBe("result");
  });
});
