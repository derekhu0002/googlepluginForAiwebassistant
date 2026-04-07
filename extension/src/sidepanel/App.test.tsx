import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialAssistantState } from "../shared/state";
import type { ActiveTabContext, AssistantState, PageRule, RuntimeMessage } from "../shared/types";
import type { NormalizedRunEvent, RunRecord } from "../shared/protocol";

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

describe("side panel host permission request flow", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.useFakeTimers();
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
    expect(container.textContent).toContain("You");
    expect(container.textContent).toContain(initialAssistantState.runPrompt);
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

  it("keeps hidden live run events from surfacing after history rerenders", async () => {
    const { runtimeSendMessage } = setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: initialAssistantState
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
    expect(container.textContent).toContain("展开推理过程");
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
    expect(container.textContent).toContain("展开推理过程");
    expect(container.textContent).not.toContain("读取页面上下文");
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

    const startButton = Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.includes("采集并开始 SSE Run"));
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

    const startButton = Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.includes("采集并开始 SSE Run"));
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
    expect(container.textContent).toContain("展开推理过程");
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
    expect(container.textContent).not.toContain("查看过程");
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
    expect(container.textContent).toContain("展开推理过程");
  });

  it("keeps reasoning collapsed by default but lets users expand live reasoning", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        runEvents: [createRunEvent(1, { type: "thinking", message: "我先整理页面关键信息，再给出最终建议。" })]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("展开推理过程");
    expect(container.textContent).not.toContain("我先整理页面关键信息，再给出最终建议。");

    const toggleButton = Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.includes("展开推理过程"));
    await act(async () => {
      toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(container.textContent).toContain("收起推理过程");
    expect(container.textContent).toContain("我先整理页面关键信息，再给出最终建议。");
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

    const toggleButton = Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.includes("展开推理过程"));
    await act(async () => {
      toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(container.textContent).toContain("我先对比历史差异，再汇总结论。");
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
