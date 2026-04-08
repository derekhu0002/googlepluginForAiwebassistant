import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialAssistantState } from "../shared/state";
import type { ActiveTabContext, AssistantState, PageRule, RuntimeMessage } from "../shared/types";
import type { NormalizedRunEvent, RunRecord } from "../shared/protocol";

const {
  mockCreateRunEventStream,
  mockSubmitQuestionAnswer,
  mockSubmitMessageFeedback,
  mockRefreshHistory,
  mockSaveRun,
  mockSaveEvent,
  mockSaveAnswer,
  mockSelectRun,
  mockClearSelectedRun,
  mockRunHistoryState,
  mockStreamClose
} = vi.hoisted(() => ({
  mockCreateRunEventStream: vi.fn(() => ({ close: mockStreamClose })),
  mockSubmitQuestionAnswer: vi.fn(),
  mockSubmitMessageFeedback: vi.fn(),
  mockRefreshHistory: vi.fn(async () => undefined),
  mockSaveRun: vi.fn(async () => undefined),
  mockSaveEvent: vi.fn(async () => undefined),
  mockSaveAnswer: vi.fn(async () => undefined),
  mockSelectRun: vi.fn(async () => undefined),
  mockClearSelectedRun: vi.fn(async () => undefined),
  mockStreamClose: vi.fn(),
  mockRunHistoryState: {
    history: [] as RunRecord[],
    selectedHistoryDetail: null as AssistantState["selectedHistoryDetail"]
  }
}));

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
    selectRun: mockSelectRun,
    clearSelectedRun: mockClearSelectedRun,
    refresh: mockRefreshHistory,
    setSelectedHistoryDetail: vi.fn()
  })
}));

const { App, mergeStateUpdate } = await import("./App");

interface ChromeStubOptions {
  contexts: ActiveTabContext[];
  permissionsRequest?: ReturnType<typeof vi.fn>;
  startRunResponse?: { ok: boolean; data?: { runId: string; sessionId?: string; currentRun: AssistantState["currentRun"] }; error?: { message: string } };
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
    sessionId: "ses-1",
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
  const listeners = new Set<(message: RuntimeMessage) => void>();
  const runtimeSendMessage = vi.fn(async (message: RuntimeMessage) => {
    switch (message.type) {
      case "GET_STATE":
        return options.getStateResponse ?? initialAssistantState;
      case "GET_RULES":
        return options.rules ?? [];
      case "GET_ACTIVE_CONTEXT":
        return contextQueue.shift() ?? options.contexts[options.contexts.length - 1] ?? null;
      case "START_RUN":
        return options.startRunResponse ?? { ok: true, data: { runId: "run-1", currentRun: createCurrentRun() } };
      case "RECAPTURE":
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
      request: options.permissionsRequest ?? vi.fn().mockResolvedValue(true),
      contains: vi.fn().mockResolvedValue(true)
    }
  } as unknown as typeof chrome);

  return {
    runtimeSendMessage,
    permissionsRequest: (globalThis.chrome.permissions.request as ReturnType<typeof vi.fn>),
    emitRuntimeMessage(message: RuntimeMessage) {
      for (const listener of listeners) {
        listener(message);
      }
    }
  };
}

async function flushUi() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function flushTimers() {
  await act(async () => {
    vi.runOnlyPendingTimers();
    await Promise.resolve();
  });
}

async function flushAllTimers() {
  await act(async () => {
    vi.runAllTimers();
    await Promise.resolve();
  });
}

/** @ArchitectureID: REQ-AIASSIST-UI-CHAT-SEND-DECOUPLE-AND-COMPLETE-RESPONSE-RENDER */
describe("side panel host permission request flow", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useFakeTimers();
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });
    mockRunHistoryState.history = [];
    mockRunHistoryState.selectedHistoryDetail = null;
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
    vi.useRealTimers();
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

  it("surfaces the host permission action before the collapsed context panel when permission is missing", async () => {
    setupChromeStub({
      contexts: [createContext()]
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const callout = container.querySelector(".host-permission-callout");
    expect(callout).toBeTruthy();
    expect(callout?.textContent).toContain("当前页面需要先授权域名访问");

    const calloutButton = callout?.querySelector("button");
    expect(calloutButton?.textContent).toContain("授权当前域名");

    const details = container.querySelector("details.utility-panel") as HTMLDetailsElement | null;
    expect(details?.open).toBe(false);

    const detailsButton = details?.querySelector("button");
    expect(detailsButton).toBeNull();
  });

  it("keeps rules configuration center collapsed by default and expands on explicit user action", async () => {
    setupChromeStub({
      contexts: [createContext()],
      rules: [{
        id: "rule-1",
        name: "Example rule",
        hostnamePattern: "example.com",
        pathPattern: "*",
        enabled: true,
        fields: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }]
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const details = container.querySelector("details.rules-config-panel") as HTMLDetailsElement | null;
    expect(details?.open).toBe(false);
    expect(container.textContent).not.toContain("保存规则");

    const summary = details?.querySelector("summary");
    await act(async () => {
      summary?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(details?.open).toBe(true);
    expect(container.textContent).toContain("保存规则");
  });

  it("keeps the permission callout visible with rebuild guidance when the current build cannot request this host", async () => {
    setupChromeStub({
      contexts: [createContext({
        canRequestPermission: false,
        message: "当前页面域名不在受控授权清单内。请先在扩展配置中登记该域名，再由用户在 Side Panel 中申请当前域名权限。"
      })]
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const callout = container.querySelector(".host-permission-callout");
    expect(callout).toBeTruthy();
    expect(callout?.textContent).toContain("当前页面需要先授权域名访问");
    expect(callout?.textContent).toContain("extension/.env");
    expect(callout?.textContent).toContain("npm run build --workspace extension");
    expect(callout?.textContent).toContain("chrome://extensions");
    expect(callout?.textContent).not.toContain("授权当前域名");
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

  it("allows sending without triggering page capture", async () => {
    const { runtimeSendMessage } = setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })]
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const startButton = container.querySelector("button[aria-label='发送消息']");
    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "START_RUN", payload: { prompt: initialAssistantState.runPrompt, capturePageData: false } });
    expect(runtimeSendMessage).not.toHaveBeenCalledWith({ type: "RECAPTURE" });
    expect(mockCreateRunEventStream).toHaveBeenCalledWith("run-1", expect.objectContaining({ onEvent: expect.any(Function), onError: expect.any(Function) }));
    expect(container.textContent).toContain("You");
    expect(container.textContent).toContain(initialAssistantState.runPrompt);
  });

  it("stores the returned session id when a follow-up run starts", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: { ...initialAssistantState, activeSessionId: "ses-existing" },
      startRunResponse: { ok: true, data: { runId: "run-2", sessionId: "ses-existing", currentRun: { ...createCurrentRun(), runId: "run-2", sessionId: "ses-existing" } } }
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const startButton = container.querySelector("button[aria-label='发送消息']");
    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(container.textContent).toContain("Run：run-2");
  });

  it("keeps independent page capture entry working", async () => {
    const { runtimeSendMessage } = setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })]
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const captureButton = Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.includes("采集页面"));
    await act(async () => {
      captureButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "RECAPTURE" });
  });

  it("shows capture in progress from the independent capture entry", async () => {
    let resolveRecapture: (() => void) | null = null;
    const { runtimeSendMessage } = setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })]
    });
    runtimeSendMessage.mockImplementation(async (message: RuntimeMessage) => {
      switch (message.type) {
        case "GET_STATE":
          return initialAssistantState;
        case "GET_RULES":
          return [];
        case "GET_ACTIVE_CONTEXT":
          return createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" });
        case "RECAPTURE":
          return await new Promise((resolve) => {
            resolveRecapture = () => resolve({ ok: true });
          });
        default:
          return undefined;
      }
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const captureButton = Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.includes("采集页面"));
    await act(async () => {
      captureButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(container.textContent).toContain("采集中...");

    await act(async () => {
      resolveRecapture?.();
    });
    await flushUi();
  });

  it("shows reconnecting status without surfacing a terminal error and returns to streaming after reopen", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })]
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const startButton = container.querySelector("button[aria-label='发送消息']");
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

  it("keeps hidden live run events from surfacing after history rerenders", async () => {
    const { runtimeSendMessage } = setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: initialAssistantState
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const startButton = container.querySelector("button[aria-label='发送消息']");
    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    const lastStreamCall = mockCreateRunEventStream.mock.calls[mockCreateRunEventStream.mock.calls.length - 1] as unknown[] | undefined;
    const handlers = (lastStreamCall?.[1] ?? {}) as { onEvent?: (event: NormalizedRunEvent) => Promise<void> };
    const thinkingEvent = createRunEvent(1);

    await act(async () => {
      await handlers.onEvent?.(thinkingEvent);
    });
    await flushUi();

    await flushAllTimers();

    expect(container.textContent).toContain("正在生成回答");
    expect(container.textContent).not.toContain("event 1");

    mockRunHistoryState.history = [{
      ...createCurrentRun(),
      status: "streaming",
      updatedAt: thinkingEvent.createdAt
    }];

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("正在生成回答");
    expect(container.textContent).not.toContain("event 1");
    expect(runtimeSendMessage.mock.calls.filter(([message]) => message.type === "GET_STATE")).toHaveLength(1);
  });

  it("renders the final assistant answer while hiding orchestration process logs", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        currentRun: {
          ...createCurrentRun(),
          status: "done",
          updatedAt: "2026-04-02T00:00:03.000Z",
          finalOutput: "最终结论"
        },
        status: "done",
        stream: {
          runId: "run-1",
          status: "done",
          pendingQuestionId: null
        },
        runEvents: [
          createRunEvent(1, { type: "thinking", message: "读取页面上下文" }),
          createRunEvent(2, { type: "tool_call", message: "查询历史 SR" }),
          createRunEvent(3, { type: "result", message: "最终结论" })
        ]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("对话");
    expect(container.textContent).toContain("You");
    expect(container.textContent).toContain("Assistant");
    expect(container.textContent).toContain("最终结论");
    expect(container.textContent).not.toContain("读取页面上下文");
    expect(container.textContent).not.toContain("查询历史 SR");
    expect(container.textContent).not.toContain("展开推理过程");
  });

  it("shows persisted final output even when run events only contain hidden process items", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        currentRun: {
          ...createCurrentRun(),
          status: "done",
          updatedAt: "2026-04-02T00:00:03.000Z",
          finalOutput: "来自持久化状态的回复"
        },
        status: "done",
        stream: {
          runId: "run-1",
          status: "done",
          pendingQuestionId: null
        },
        runEvents: [
          createRunEvent(1, { type: "thinking", message: "读取页面上下文" }),
          createRunEvent(2, { type: "tool_call", message: "查询历史 SR" })
        ]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("来自持久化状态的回复");
    expect(container.textContent).not.toContain("展开推理过程");
    expect(container.textContent).not.toContain("读取页面上下文");
  });

  it("renders complete assistant text when same run emits delayed response after result", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        currentRun: {
          ...createCurrentRun(),
          status: "done",
          updatedAt: "2026-04-02T00:00:04.000Z",
          finalOutput: "第一段第二段"
        },
        status: "done",
        stream: {
          runId: "run-1",
          status: "done",
          pendingQuestionId: null
        },
        runEvents: [
          createRunEvent(1, { type: "thinking", message: "第一段", data: { field: "text", message_id: "msg-1" } }),
          createRunEvent(2, { type: "result", message: "第一段" }),
          createRunEvent(3, { type: "thinking", message: "第二段", data: { field: "text", message_id: "msg-1" } })
        ]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("第一段第二段");
    expect(container.textContent).not.toContain("第一段Assistant第一段");
  });

  it("does not show completion copy when background sends done without terminal evidence", async () => {
    const { emitRuntimeMessage } = setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        runEvents: [createRunEvent(1, { type: "thinking", message: "读取页面上下文" })],
        currentRun: {
          ...createCurrentRun(),
          status: "streaming",
          updatedAt: "2026-04-02T00:00:01.000Z"
        }
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    await act(async () => {
      emitRuntimeMessage({
        type: "STATE_UPDATED",
        payload: createAssistantState({
          runEvents: [],
          status: "done",
          currentRun: {
            ...createCurrentRun(),
            status: "done",
            updatedAt: "2026-04-02T00:00:02.000Z",
            finalOutput: ""
          },
          stream: {
            runId: "run-1",
            status: "done",
            pendingQuestionId: null
          }
        })
      });
    });
    await flushUi();

    expect(container.textContent).toContain("助手正在继续生成回答，完成后会显示最终结果。");
    expect(container.textContent).not.toContain("助手已完成本轮回答。");
    expect(container.textContent).toContain("持续输出中");
  });

  it("does not accept same-run done status without terminal evidence", () => {
    const current = createAssistantState({
      runEvents: [createRunEvent(1)],
      status: "streaming",
      currentRun: {
        ...createCurrentRun(),
        status: "streaming",
        updatedAt: "2026-04-02T00:00:01.000Z",
        finalOutput: ""
      },
      stream: {
        runId: "run-1",
        status: "streaming",
        pendingQuestionId: null
      }
    });
    const payload = createAssistantState({
      runEvents: [],
      status: "done",
      currentRun: {
        ...createCurrentRun(),
        status: "done",
        updatedAt: "2026-04-02T00:00:02.000Z",
        finalOutput: ""
      },
      stream: {
        runId: "run-1",
        status: "streaming",
        pendingQuestionId: null
      }
    });

    const merged = mergeStateUpdate(current, payload, [], null);

    expect(merged.status).toBe("streaming");
    expect(merged.currentRun?.status).toBe("streaming");
    expect(merged.stream.status).toBe("streaming");
  });

  it("does not regress done UI state after result when later history rerenders occur", async () => {
    const { runtimeSendMessage, emitRuntimeMessage } = setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: initialAssistantState
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const startButton = container.querySelector("button[aria-label='发送消息']");
    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    const lastStreamCall = mockCreateRunEventStream.mock.calls[mockCreateRunEventStream.mock.calls.length - 1] as unknown[] | undefined;
    const handlers = (lastStreamCall?.[1] ?? {}) as { onEvent?: (event: NormalizedRunEvent) => Promise<void> };
    const resultEvent = createRunEvent(2, {
      type: "result",
      message: "final answer"
    });

    await act(async () => {
      await handlers.onEvent?.(resultEvent);
    });
    await flushUi();
    await flushAllTimers();

    expect(container.textContent).toContain("状态：");
    expect(container.textContent).toContain("done");
    expect(container.textContent).toContain("final answer");

    mockRunHistoryState.history = [{
      ...createCurrentRun(),
      status: "done",
      updatedAt: resultEvent.createdAt,
      finalOutput: "final answer"
    }];

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    await act(async () => {
      emitRuntimeMessage({
        type: "STATE_UPDATED",
        payload: createAssistantState({
          runEvents: [],
          status: "streaming",
          currentRun: {
            ...createCurrentRun(),
            status: "streaming",
            updatedAt: "2026-04-02T00:00:01.000Z",
            finalOutput: ""
          },
          stream: {
            runId: "run-1",
            status: "streaming",
            pendingQuestionId: null
          }
        })
      });
    });
    await flushUi();

    expect(container.textContent).toContain("done");
    expect(container.textContent).toContain("final answer");
    expect(runtimeSendMessage.mock.calls.filter(([message]) => message.type === "GET_STATE")).toHaveLength(1);
  });

  it("shows generic streaming copy while keeping tool-call payloads hidden", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        runEvents: [createRunEvent(1, {
          type: "tool_call",
          title: "处理中",
          message: "正在整理上下文并准备分析。",
          data: { stage: "prepare_context", payload: { secret: true } }
        })]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("正在生成回答");
    expect(container.textContent).not.toContain("正在整理上下文并准备分析");
    expect(container.textContent).not.toContain("prepare_context");
    expect(container.textContent).not.toContain("secret");
    expect(container.querySelector("pre")).toBeNull();
  });

  it("shows user-meaningful thinking inline while streaming", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })]
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const startButton = container.querySelector("button[aria-label='发送消息']");
    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    const lastStreamCall = mockCreateRunEventStream.mock.calls[mockCreateRunEventStream.mock.calls.length - 1] as unknown[] | undefined;
    const handlers = (lastStreamCall?.[1] ?? {}) as { onEvent?: (event: NormalizedRunEvent) => Promise<void> };
    const thinkingEvent = createRunEvent(1, { type: "thinking", message: "我先整理页面关键信息，再给出最终建议。" });

    await act(async () => {
      await handlers.onEvent?.(thinkingEvent);
    });
    await flushUi();
    await flushAllTimers();

    expect(container.textContent).not.toContain("Called");
    expect(container.textContent).not.toContain("我先整理页面关键信息，再给出最终建议。");
  });

  it("hides aggregated orchestration thinking events", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        runEvents: [
          createRunEvent(1, { type: "thinking", message: "读取页面上下文" }),
          createRunEvent(2, { type: "thinking", message: "整理可用字段" })
        ]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("正在生成回答");
    expect(container.textContent).not.toContain("读取页面上下文");
    expect(container.textContent).not.toContain("整理可用字段");
    expect(container.textContent).not.toContain("展开推理过程");
  });

  it("shows final answer in history detail without orchestration steps", async () => {
    mockRunHistoryState.selectedHistoryDetail = {
      run: {
        ...createCurrentRun(),
        status: "done",
        finalOutput: "历史结果",
        updatedAt: "2026-04-02T00:00:03.000Z"
      },
      events: [
        createRunEvent(1, { type: "thinking", message: "历史思考 1" }),
        createRunEvent(2, { type: "thinking", message: "历史思考 2" }),
        createRunEvent(3, { type: "result", message: "历史结果" })
      ],
      answers: []
    };

    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })]
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("历史结果");
    expect(container.textContent).toContain("You");
    expect(container.textContent).not.toContain("历史思考 1");
    expect(container.textContent).not.toContain("历史思考 2");
    expect(container.textContent).not.toContain("展开推理过程");
  });

  it("shows history detail meaningful thinking but hides session noise", async () => {
    mockRunHistoryState.selectedHistoryDetail = {
      run: {
        ...createCurrentRun(),
        status: "done",
        finalOutput: "历史结论",
        updatedAt: "2026-04-02T00:00:04.000Z"
      },
      events: [
        createRunEvent(1, { type: "thinking", message: "已连接主分析代理..." }),
        createRunEvent(2, { type: "thinking", message: "我先对比历史差异，再汇总结论。" }),
        createRunEvent(3, { type: "result", message: "历史结论" })
      ],
      answers: []
    };

    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })]
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("历史结论");
    expect(container.textContent).not.toContain("已连接主分析代理");
    expect(container.textContent).not.toContain("我先对比历史差异，再汇总结论。");
  });

  it("shows the final answer after question events complete", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        status: "done",
        stream: {
          runId: "run-1",
          status: "done",
          pendingQuestionId: null
        },
        currentRun: {
          ...createCurrentRun(),
          status: "done",
          updatedAt: "2026-04-02T00:00:03.000Z",
          finalOutput: "已完成"
        },
        runEvents: [
          createRunEvent(1, {
            type: "question",
            message: "请选择处理方式",
            question: {
              questionId: "q-1",
              title: "需要确认",
              message: "请选择处理方式",
              options: [],
              allowFreeText: true
            }
          }),
          createRunEvent(2, { type: "result", message: "已完成" })
        ]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("已完成");
    expect(container.textContent).toContain("请选择处理方式");
  });

  it("renders chat-first shell cues in both live and history sections", async () => {
    mockRunHistoryState.history = [{
      ...createCurrentRun(),
      runId: "run-history-1",
      status: "done",
      updatedAt: "2026-04-02T00:00:03.000Z",
      finalOutput: "历史答案"
    }];
    mockRunHistoryState.selectedHistoryDetail = {
      run: mockRunHistoryState.history[0],
      events: [createRunEvent(1, { runId: "run-history-1", type: "result", message: "历史答案" })],
      answers: []
    };

    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        currentRun: {
          ...createCurrentRun(),
          status: "streaming"
        },
        runEvents: [createRunEvent(1, { type: "thinking", message: "读取页面上下文" })]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("对话");
    expect(container.textContent).toContain("发送消息");
    expect(container.textContent).toContain("底部输入区始终可用");
    expect(container.textContent).toContain("历史详情沿用同一对话流呈现。");
    expect(container.textContent).toContain("持续输出中");
  });

  it("renders light IDE header toolbar and composer placeholder chips", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: initialAssistantState
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("Light IDE");
    expect(container.textContent).toContain("Live / History");
    expect(container.textContent).toContain("附件");
    expect(container.textContent).toContain("页面上下文");
    expect(container.textContent).toContain("选中内容");
  });

  it("renders send affordance as bottom-right paper-plane button", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: initialAssistantState
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const sendButton = container.querySelector("button.send-button[aria-label='发送消息']");
    expect(sendButton).toBeTruthy();
    expect(sendButton?.querySelector("svg.send-icon")).toBeTruthy();
  });

  it("shows hover action buttons for assistant messages", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        status: "done",
        stream: {
          runId: "run-1",
          status: "done",
          pendingQuestionId: null
        },
        currentRun: {
          ...createCurrentRun(),
          status: "done",
          finalOutput: "最终回答",
          updatedAt: "2026-04-02T00:00:02.000Z"
        },
        runEvents: [createRunEvent(1, { type: "result", message: "最终回答" })]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(Array.from(container.querySelectorAll("button")).some((node) => node.textContent === "复制")).toBe(true);
    expect(Array.from(container.querySelectorAll("button")).some((node) => node.textContent === "点赞")).toBe(true);
    expect(Array.from(container.querySelectorAll("button")).some((node) => node.textContent === "点踩")).toBe(true);
    expect(Array.from(container.querySelectorAll("button")).some((node) => node.textContent === "重试")).toBe(true);
  });

  it("retries by starting a new run with the original user question", async () => {
    const { runtimeSendMessage } = setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        status: "done",
        stream: {
          runId: "run-1",
          status: "done",
          pendingQuestionId: null
        },
        currentRun: {
          ...createCurrentRun(),
          prompt: "原始用户问题",
          status: "done",
          finalOutput: "最终回答",
          updatedAt: "2026-04-02T00:00:02.000Z"
        },
        runEvents: [createRunEvent(1, { type: "result", message: "最终回答" })]
      }),
      startRunResponse: { ok: true, data: { runId: "run-2", currentRun: { ...createCurrentRun(), runId: "run-2", prompt: "原始用户问题" } } }
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const retryButton = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === "重试");
    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(runtimeSendMessage).toHaveBeenCalledWith({
      type: "START_RUN",
      payload: {
        prompt: "原始用户问题",
        capturePageData: false,
        retryFromRunId: "run-1",
        retryFromMessageId: "event-1"
      }
    });
    expect(mockCreateRunEventStream).toHaveBeenCalledWith("run-2", expect.objectContaining({ onEvent: expect.any(Function) }));
  });

  it("submits feedback and shows submitted state in the UI", async () => {
    mockSubmitMessageFeedback.mockResolvedValue({
      ok: true,
      data: {
        accepted: true,
        runId: "run-1",
        messageId: "event-1",
        feedback: "like",
        updatedAt: "2026-04-08T00:00:00.000Z"
      }
    });

    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        status: "done",
        stream: {
          runId: "run-1",
          status: "done",
          pendingQuestionId: null
        },
        currentRun: {
          ...createCurrentRun(),
          status: "done",
          finalOutput: "最终回答",
          updatedAt: "2026-04-02T00:00:02.000Z"
        },
        runEvents: [createRunEvent(1, { type: "result", message: "最终回答" })]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const likeButton = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === "点赞");
    await act(async () => {
      likeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(mockSubmitMessageFeedback).toHaveBeenCalledWith({
      runId: "run-1",
      messageId: "event-1",
      feedback: "like"
    });
    expect(container.textContent).toContain("已提交点赞");
  });

  it("shows feedback failure state in the UI", async () => {
    mockSubmitMessageFeedback.mockResolvedValue({
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        message: "feedback failed"
      }
    });

    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        status: "done",
        stream: {
          runId: "run-1",
          status: "done",
          pendingQuestionId: null
        },
        currentRun: {
          ...createCurrentRun(),
          status: "done",
          finalOutput: "最终回答",
          updatedAt: "2026-04-02T00:00:02.000Z"
        },
        runEvents: [createRunEvent(1, { type: "result", message: "最终回答" })]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const dislikeButton = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === "点踩");
    await act(async () => {
      dislikeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(container.textContent).toContain("feedback failed");
  });

  it("clears the waiting question state immediately after answer submission", async () => {
    mockSubmitQuestionAnswer.mockResolvedValue({ ok: true });

    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        status: "waiting_for_answer",
        stream: {
          runId: "run-1",
          status: "waiting_for_answer",
          pendingQuestionId: "q-1"
        },
        currentRun: {
          ...createCurrentRun(),
          status: "waiting_for_answer",
          updatedAt: "2026-04-02T00:00:02.000Z"
        },
        runEvents: [
          createRunEvent(1, {
            type: "question",
            message: "请选择处理方式",
            question: {
              questionId: "q-1",
              title: "需要确认",
              message: "请选择处理方式",
              options: [{ id: "resume", label: "继续执行", value: "继续执行" }],
              allowFreeText: false
            }
          })
        ]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.querySelector(".question-card")).toBeTruthy();

    const submitButton = Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.includes("提交回答"));
    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(mockSubmitQuestionAnswer).toHaveBeenCalledWith("run-1", {
      questionId: "q-1",
      answer: "继续执行",
      choiceId: "resume"
    });
    expect(mockSaveAnswer).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      questionId: "q-1",
      answer: "继续执行",
      choiceId: "resume"
    }));
    expect(container.textContent).toContain("正在生成回答");
    expect(container.textContent).not.toContain("待确认");
    expect(container.textContent).toContain("状态：");
    expect(container.textContent).toContain("streaming");
    expect(container.textContent).toContain("流连接：streaming");
    expect(container.querySelector(".question-card")).toBeNull();
  });

  it("re-enables the send button after an assistant response completes", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })]
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const startButton = container.querySelector("button[aria-label='发送消息']") as HTMLButtonElement | null;
    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(startButton?.disabled).toBe(true);

    const lastStreamCall = mockCreateRunEventStream.mock.calls[mockCreateRunEventStream.mock.calls.length - 1] as unknown[] | undefined;
    const handlers = (lastStreamCall?.[1] ?? {}) as { onEvent?: (event: NormalizedRunEvent) => Promise<void>; onStatusChange?: (status: "connecting" | "streaming" | "reconnecting") => void };

    await act(async () => {
      await handlers.onEvent?.(createRunEvent(1, { type: "result", message: "最终回答" }));
    });
    await flushUi();

    await act(async () => {
      handlers.onStatusChange?.("streaming");
    });
    await flushUi();

    expect(startButton?.disabled).toBe(false);
    expect(container.textContent).toContain("最终回答");
  });

  it("keeps the send button enabled while waiting for a follow-up answer", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        status: "waiting_for_answer",
        stream: {
          runId: "run-1",
          status: "waiting_for_answer",
          pendingQuestionId: "q-1"
        },
        currentRun: {
          ...createCurrentRun(),
          status: "waiting_for_answer",
          updatedAt: "2026-04-02T00:00:02.000Z"
        },
        runEvents: [
          createRunEvent(1, {
            type: "question",
            message: "请选择处理方式",
            question: {
              questionId: "q-1",
              title: "需要确认",
              message: "请选择处理方式",
              options: [{ id: "resume", label: "继续执行", value: "继续执行" }],
              allowFreeText: false
            }
          })
        ]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const startButton = container.querySelector("button[aria-label='发送补充说明']") as HTMLButtonElement | null;
    expect(startButton?.disabled).toBe(false);
  });

  it("renders assistant markdown in the same bubble while streaming deltas", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        runEvents: [createRunEvent(1, { type: "thinking", message: "# 标题", data: { field: "text", message_id: "msg-1" } })]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();
    await flushAllTimers();

    expect(container.querySelectorAll(".turn-assistant")).toHaveLength(1);
    expect(container.querySelectorAll(".turn-assistant h1")).toHaveLength(1);
    expect(container.textContent).toContain("标题");
  });

  it("renders generic streaming copy without raw tool details", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        runEvents: [createRunEvent(1, {
          type: "tool_call",
          title: "处理中",
          message: "正在检索相关信息。",
          data: { stage: "running" },
          logData: { tool: "grep", args: ["token=123"] }
        })]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("正在生成回答");
    expect(container.textContent).not.toContain("正在检索相关信息");
    expect(container.textContent).not.toContain("token=123");
    expect(container.textContent).not.toContain("grep");
  });
});
