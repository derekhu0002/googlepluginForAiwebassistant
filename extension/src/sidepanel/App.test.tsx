import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAIN_AGENT } from "../shared/protocol";
import { initialAssistantState } from "../shared/state";
import type { ActiveTabContext, AssistantState, PageRule, RuntimeMessage } from "../shared/types";
import type { NormalizedRunEvent, RunHistoryDetail, RunRecord } from "../shared/protocol";

const {
  mockCreateRunEventStream,
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

  return {
    mockCreateRunEventStream: vi.fn(() => ({ close: mockStreamClose })),
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

const { App, mergeStateUpdate } = await import("./App");

interface ChromeStubOptions {
  contexts: ActiveTabContext[];
  permissionsRequest?: ReturnType<typeof vi.fn>;
  startRunResponse?: { ok: boolean; data?: { runId: string; sessionId?: string; selectedAgent?: "TARA_analyst" | "ThreatIntelliganceCommander"; currentRun: AssistantState["currentRun"] }; error?: { message: string } };
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
      case "RECAPTURE":
        return { ok: true };
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

// @RequirementID: ELM-002
// @ArchitectureID: ELM-FUNC-EXT-CAPTURE-TRANSPORT-CANONICAL-TRACE
// @ArchitectureID: ELM-FUNC-SP-TRACE-STREAM-ACCEPTANCE-FRONTIER
// @ArchitectureID: ELM-FUNC-SP-TRACE-INCREMENTAL-TRANSCRIPT-PROJECTION
// @ArchitectureID: ELM-FUNC-SP-ASSEMBLE-CORRELATED-TRANSCRIPT-DIAGNOSTICS
// @ArchitectureID: ELM-FUNC-SP-ANALYZE-FINAL-TRANSCRIPT-RENDER
// @ArchitectureID: REQ-AIASSIST-UI-CHAT-SEND-DECOUPLE-AND-COMPLETE-RESPONSE-RENDER
// @ArchitectureID: ELM-001
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
    expect(container.querySelector(".host-permission-callout")).toBeNull();
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
    expect(callout?.textContent).toContain("待授权域名：https://example.com/*");

    const calloutButton = callout?.querySelector("button");
    expect(calloutButton?.textContent).toContain("授权当前域名");

    const headerButtons = Array.from(container.querySelectorAll("[data-component='header'] button"));
    expect(headerButtons.some((element) => element.textContent?.includes("授权当前域名"))).toBe(true);

    expect(container.querySelector("details.utility-panel")).toBeNull();
  });

  it("keeps the authorize-current-domain CTA visible in both main stage callout and header", async () => {
    setupChromeStub({
      contexts: [createContext()]
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.querySelector(".host-permission-callout button")?.textContent).toContain("授权当前域名");
    expect(container.querySelector("[data-component='header'] button[aria-label='授权当前域名']")?.textContent).toContain("授权当前域名");
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

    expect(container.textContent).not.toContain("保存规则");

    const rulesButton = container.querySelector("button[aria-label='规则']");
    await act(async () => {
      rulesButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

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
    expect(callout?.textContent).toContain("待授权域名：https://example.com/*");
    expect(callout?.textContent).toContain("extension/.env");
    expect(callout?.textContent).toContain("npm run build --workspace extension");
    expect(callout?.textContent).toContain("chrome://extensions");
    expect(callout?.textContent).not.toContain("授权当前域名");
  });

  it("falls back to hostname when permission origin is unavailable", async () => {
    setupChromeStub({
      contexts: [createContext({
        permissionOrigin: null,
        canRequestPermission: false,
        hostname: "127.0.0.1",
        url: "http://127.0.0.1/demo"
      })]
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const callout = container.querySelector(".host-permission-callout");
    expect(callout).toBeTruthy();
    expect(callout?.textContent).toContain("待授权域名：127.0.0.1");
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

    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "START_RUN", payload: { prompt: initialAssistantState.runPrompt, selectedAgent: DEFAULT_MAIN_AGENT, capturePageData: false } });
    expect(runtimeSendMessage).not.toHaveBeenCalledWith({ type: "RECAPTURE" });
    expect(mockCreateRunEventStream).toHaveBeenCalledWith("run-1", expect.objectContaining({ onEvent: expect.any(Function), onError: expect.any(Function) }));
    expect(container.textContent).not.toContain("You");
    expect(container.textContent).toContain(initialAssistantState.runPrompt);
  });

  it("stores the returned session id when a follow-up run starts", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: { ...initialAssistantState, activeSessionId: "ses-existing" },
      startRunResponse: { ok: true, data: { runId: "run-2", sessionId: "ses-existing", selectedAgent: DEFAULT_MAIN_AGENT, currentRun: { ...createCurrentRun(), runId: "run-2", sessionId: "ses-existing" } } }
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

  it("keeps earlier same-session turns visible after a follow-up run starts", async () => {
    const previousRun = {
      ...createCurrentRun(),
      runId: "run-previous",
      prompt: "前一轮问题",
      status: "done" as const,
      updatedAt: "2026-04-02T00:00:02.000Z",
      finalOutput: "前一轮回答"
    };

    mockRunHistoryState.history = [previousRun];
    mockRunHistoryState.runDetails = {
      "run-previous": {
        run: previousRun,
        events: [createRunEvent(1, { runId: "run-previous", type: "result", message: "前一轮回答" })],
        answers: []
      }
    };

    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        currentRun: {
          ...createCurrentRun(),
          runId: "run-current",
          prompt: "继续追问当前问题",
          status: "streaming",
          updatedAt: "2026-04-02T00:00:04.000Z",
          finalOutput: ""
        },
        runEvents: [createRunEvent(1, { runId: "run-current", type: "thinking", message: "正在补充分析" })],
        stream: {
          runId: "run-current",
          status: "streaming",
          pendingQuestionId: null
        }
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(mockLoadRunDetail).toHaveBeenCalledWith("run-previous");
    expect(container.textContent).toContain("前一轮问题");
    expect(container.textContent).toContain("前一轮回答");
    expect(container.textContent).toContain("继续追问当前问题");
  });

  it("keeps previous same-session transcript visible while history reload catches up to a new run", async () => {
    const previousRun = {
      ...createCurrentRun(),
      runId: "run-previous",
      prompt: "前一轮问题",
      status: "done" as const,
      updatedAt: "2026-04-02T00:00:02.000Z",
      finalOutput: "前一轮回答"
    };

    const { emitRuntimeMessage } = setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        currentRun: {
          ...createCurrentRun(),
          runId: "run-current",
          prompt: "当前问题",
          status: "done",
          updatedAt: "2026-04-02T00:00:04.000Z",
          finalOutput: "当前回答"
        },
        runEvents: [createRunEvent(1, { runId: "run-current", type: "result", message: "当前回答" })],
        stream: {
          runId: "run-current",
          status: "done",
          pendingQuestionId: null
        }
      })
    });

    mockRunHistoryState.history = [previousRun];
    mockRunHistoryState.runDetails = {
      "run-previous": {
        run: previousRun,
        events: [createRunEvent(1, { runId: "run-previous", type: "result", message: "前一轮回答" })],
        answers: []
      }
    };

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("前一轮回答");
    expect(container.textContent).toContain("当前回答");

    mockRunHistoryState.history = [];
    mockRunHistoryState.runDetails = {};

    await act(async () => {
      emitRuntimeMessage({
        type: "STATE_UPDATED",
        payload: createAssistantState({
          currentRun: {
            ...createCurrentRun(),
            runId: "run-next",
            prompt: "继续追问当前问题",
            status: "streaming",
            updatedAt: "2026-04-02T00:00:05.000Z",
            finalOutput: ""
          },
          runEvents: [],
          stream: {
            runId: "run-next",
            status: "connecting",
            pendingQuestionId: null
          }
        })
      });
    });
    await flushUi();

    expect(container.textContent).toContain("前一轮回答");
    expect(container.textContent).toContain("继续追问当前问题");
  });

  it("does not refresh history on every live event and preserves visible transcript until debounced reload", async () => {
    setupChromeStub({
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

    await act(async () => {
      await handlers.onEvent?.(createRunEvent(1, { type: "thinking", message: "第一段", data: { field: "text", message_id: "msg-1" } }));
      await handlers.onEvent?.(createRunEvent(2, { type: "thinking", message: "第二段", data: { field: "text", message_id: "msg-1" } }));
    });
    await flushUi();

    expect(mockRefreshHistory).not.toHaveBeenCalled();
    expect(container.textContent).toContain(initialAssistantState.runPrompt);
    expect(container.textContent).toContain("第一段第二段");

    await flushTimers();

    expect(mockRefreshHistory).toHaveBeenCalledTimes(1);
  });

  it("keeps historical transcript visible while current live tail grows incrementally", async () => {
    const previousRun = {
      ...createCurrentRun(),
      runId: "run-previous",
      prompt: "历史问题",
      status: "done" as const,
      updatedAt: "2026-04-02T00:00:02.000Z",
      finalOutput: "历史回答"
    };

    mockRunHistoryState.history = [previousRun];
    mockRunHistoryState.runDetails = {
      "run-previous": {
        run: previousRun,
        events: [createRunEvent(1, { runId: "run-previous", type: "result", message: "历史回答" })],
        answers: []
      }
    };

    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        currentRun: {
          ...createCurrentRun(),
          runId: "run-current",
          prompt: "当前问题",
          status: "streaming",
          updatedAt: "2026-04-02T00:00:04.000Z",
          finalOutput: ""
        },
        runEvents: [createRunEvent(2, { runId: "run-current", type: "thinking", message: "第一段", data: { field: "text", message_id: "msg-current" } })],
        stream: {
          runId: "run-current",
          status: "streaming",
          pendingQuestionId: null
        }
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("历史回答");
    expect(container.textContent).toContain("第一段");

    await act(async () => {
      const runtimeMessage = {
        type: "STATE_UPDATED",
        payload: createAssistantState({
          currentRun: {
            ...createCurrentRun(),
            runId: "run-current",
            prompt: "当前问题",
            status: "streaming",
            updatedAt: "2026-04-02T00:00:05.000Z",
            finalOutput: ""
          },
          runEvents: [
            createRunEvent(2, { runId: "run-current", type: "thinking", message: "第一段", data: { field: "text", message_id: "msg-current" } }),
            createRunEvent(3, { runId: "run-current", type: "thinking", message: "第二段", data: { field: "text", message_id: "msg-current" } })
          ],
          stream: {
            runId: "run-current",
            status: "streaming",
            pendingQuestionId: null
          }
        })
      } satisfies RuntimeMessage;

      (globalThis.chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.(runtimeMessage);
    });
    await flushUi();

    expect(container.textContent).toContain("历史回答");
    expect(container.textContent).toContain("第一段第二段");
  });

  // @ArchitectureID: ELM-FUNC-EXT-SIDEPANEL-CAPTURE-ENTRY
  // @ArchitectureID: ELM-COMP-EXT-SIDEPANEL
  // @ArchitectureID: ELM-001
  it("keeps a visible page capture entry working", async () => {
    const { runtimeSendMessage } = setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })]
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const captureButton = container.querySelector("button[aria-label='采集页面']");
    expect(captureButton?.textContent).toContain("采集页面");
    await act(async () => {
      captureButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "RECAPTURE" });
  });

  // @ArchitectureID: ELM-FUNC-EXT-SIDEPANEL-CAPTURE-ENTRY
  // @ArchitectureID: ELM-001
  it("shows capture in progress from the visible capture entry", async () => {
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

    const captureButton = container.querySelector("button[aria-label='采集页面']");
    await act(async () => {
      captureButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    const pendingCaptureButton = container.querySelector("button[aria-label='采集中...']") as HTMLButtonElement | null;
    expect(pendingCaptureButton?.textContent).toContain("采集中...");
    expect(pendingCaptureButton?.disabled).toBe(true);

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
    expect(container.textContent).toContain("连接中");

    await act(async () => {
      handlers.onStatusChange?.("reconnecting");
    });
    await flushUi();

    expect(container.textContent).toContain("重新连接中");
    expect(container.textContent).not.toContain("SSE connection failed");

    await act(async () => {
      handlers.onStatusChange?.("streaming");
    });
    await flushUi();

    expect(container.textContent).not.toContain("正在重新连接…");
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

  it("does not duplicate a replayed assistant body event in the current run state", async () => {
    setupChromeStub({
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
    const replayedThinkingEvent = createRunEvent(1, {
      type: "thinking",
      message: "Summarizing SR risks and actions\n\nI need to answer the user in Chinese about the current SR's risk and next steps."
    });
    const assistantDeltaEvent = createRunEvent(2, {
      type: "thinking",
      message: "## 当前风险结论\n\n1. SR 本体缺失。",
      data: { field: "text", message_id: "msg-1" }
    });

    await act(async () => {
      await handlers.onEvent?.(replayedThinkingEvent);
      await handlers.onEvent?.(replayedThinkingEvent);
      await handlers.onEvent?.(assistantDeltaEvent);
    });
    await flushUi();
    await flushAllTimers();

    const assistantMessages = container.querySelectorAll(".transcript-part[data-part-role='assistant'][data-part-kind='text']");
    expect(assistantMessages).toHaveLength(1);
    expect(container.querySelectorAll("[data-part-kind='reasoning']").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelectorAll("[data-part-kind='text']").length).toBeGreaterThanOrEqual(1);
    expect(assistantMessages[0]?.textContent).toContain("当前风险结论");
    expect(mockSaveEvent).toHaveBeenNthCalledWith(1, replayedThinkingEvent);
    expect(mockSaveEvent).toHaveBeenNthCalledWith(2, replayedThinkingEvent);
  });

  it("replaces the in-memory assistant body when the same run sequence is replayed with a fuller snapshot", async () => {
    setupChromeStub({
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
    const assistantDeltaEvent = createRunEvent(2, {
      type: "thinking",
      message: "## 当前风险结论\n\n1. SR 本体缺失。",
      data: { field: "text", message_id: "msg-1" }
    });

    await act(async () => {
      await handlers.onEvent?.(createRunEvent(1, {
        id: "event-short",
        type: "thinking",
        message: "第一段",
        data: { field: "text", message_id: "msg-1" }
      }));
      await handlers.onEvent?.(createRunEvent(1, {
        id: "event-long",
        type: "thinking",
        message: "第一段\n\n第二段",
        data: { field: "text", message_id: "msg-1" }
      }));
      await handlers.onEvent?.(createRunEvent(2, {
        type: "thinking",
        message: "第三段",
        data: { field: "text", message_id: "msg-1" }
      }));
    });
    await flushUi();
    await flushAllTimers();

    const assistantText = Array.from(container.querySelectorAll(".transcript-part[data-part-role='assistant'][data-part-kind='text']"))
      .map((node) => node.textContent ?? "")
      .join("\n");
    expect(assistantText).toContain("第一段");
    expect(assistantText).toContain("第二段");
    expect(assistantText).toContain("第三段");
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

  it("keeps live run events stable after history rerenders", async () => {
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

    expect(container.querySelector(".conversation-inline-status")).toBeNull();
    expect(container.querySelectorAll(".transcript-part[data-part-kind='summary']")).toHaveLength(1);
    expect(container.querySelector(".transcript-part[data-part-kind='summary']")?.textContent).toContain("进行中");
    expect(container.textContent).toContain("event 1");

    mockRunHistoryState.history = [{
      ...createCurrentRun(),
      status: "streaming",
      updatedAt: thinkingEvent.createdAt
    }];

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.querySelector(".conversation-inline-status")).toBeNull();
    expect(container.querySelectorAll(".transcript-part[data-part-kind='summary']")).toHaveLength(1);
    expect(container.querySelector(".transcript-part[data-part-kind='summary']")?.textContent).toContain("进行中");
    expect(container.textContent).toContain("event 1");
    expect(runtimeSendMessage.mock.calls.filter(([message]) => message.type === "GET_STATE")).toHaveLength(1);
  });

  it("renders transcript process parts alongside the final assistant answer", async () => {
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

    expect(container.textContent).not.toContain("You");
    expect(container.textContent).not.toContain("Assistant");
    expect(container.textContent).toContain("最终结论");
    expect(container.textContent).toContain("读取页面上下文");
    expect(container.textContent).toContain("查询历史 SR");
    expect(container.querySelector("[data-part-kind='reasoning']")?.textContent).toContain("读取页面上下文");
    expect(container.querySelector("[data-part-kind='tool']")?.textContent).toContain("查询历史 SR");
  });

  it("shows persisted final output while keeping projected tool content visible", async () => {
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
    expect(container.textContent).toContain("查询历史 SR");
    expect(container.textContent).toContain("读取页面上下文");
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

    expect(container.textContent).not.toContain("助手已完成本轮回答。");
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

    expect(container.textContent).toContain("final answer");
    expect(container.querySelector("button[aria-label='重试']")).not.toBeNull();

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

    expect(container.textContent).toContain("final answer");
    expect(container.querySelector("button[aria-label='重试']")).not.toBeNull();
    expect(runtimeSendMessage.mock.calls.filter(([message]) => message.type === "GET_STATE")).toHaveLength(1);
  });

  it("shows tool-call-only transcript blocks while still hiding raw payloads", async () => {
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

    expect(container.textContent).toContain("正在整理上下文并准备分析。");
    expect(container.textContent).not.toContain("prepare_context");
    expect(container.textContent).not.toContain("secret");
    expect(container.querySelector("pre")).toBeNull();
    expect(container.querySelector("[data-part-kind='tool']")?.textContent).toContain("正在整理上下文并准备分析。");
    expect(container.querySelector("[data-part-kind='text']")).toBeNull();
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
    expect(container.textContent).toContain("我先整理页面关键信息，再给出最终建议。");
  });

  it("shows aggregated orchestration thinking events in the transcript", async () => {
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

    expect(container.textContent).toContain("读取页面上下文");
    expect(container.textContent).toContain("整理可用字段");
  });

  it("shows final answer in history detail with projected reasoning steps", async () => {
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
    expect(container.textContent).not.toContain("You");
    expect(container.textContent).toContain("历史思考 1");
    expect(container.textContent).toContain("历史思考 2");
  });

  it("shows history detail meaningful thinking together with session progress copy", async () => {
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
    expect(container.textContent).toContain("已连接主分析代理");
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

    expect(container.textContent).toContain("Transcript");
    expect(container.querySelector("button[aria-label='会话']")).not.toBeNull();
    expect(container.textContent).toContain("个会话簇");
  });

  it("keeps completed runs focused on the main answer without extra summary blocks", async () => {
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
          updatedAt: "2026-04-02T00:00:03.000Z"
        },
        runEvents: [createRunEvent(1, { type: "result", message: "最终回答" })]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("最终回答");
    expect(container.textContent).not.toContain("结果阅读");
    expect(container.querySelector(".structured-reading-panel")).toBeNull();
  });

  it("shows awaiting-input stage language when a live follow-up question is pending", async () => {
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

    expect(container.textContent).toContain("当前为追问恢复输入");
  });

  it("renders persistent icon bar entries for drawers", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: initialAssistantState
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("会话");
    expect(container.textContent).toContain("上下文");
    expect(container.textContent).toContain("规则");
    expect(container.textContent).toContain("运行");
  });

  it("renders current main agent control and switches future-run preference only", async () => {
    const { runtimeSendMessage } = setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        mainAgentPreference: DEFAULT_MAIN_AGENT,
        currentRun: {
          ...createCurrentRun(),
          selectedAgent: DEFAULT_MAIN_AGENT,
          status: "streaming"
        }
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain(`主 AGENT：${DEFAULT_MAIN_AGENT}`);
    expect(container.textContent).toContain(`后续新 run 将显式使用 ${DEFAULT_MAIN_AGENT}`);

    const trigger = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.includes(`主 AGENT：${DEFAULT_MAIN_AGENT}`));
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    const option = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.includes("ThreatIntelliganceCommander"));
    await act(async () => {
      option?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "SET_MAIN_AGENT", payload: { selectedAgent: "ThreatIntelliganceCommander" } });
    expect(container.textContent).toContain("当前 run 继续使用 TARA_analyst；切换只影响后续新 run。");
  });

  it("shows the main agent menu in an overlay and closes after selection", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        mainAgentPreference: DEFAULT_MAIN_AGENT,
        currentRun: {
          ...createCurrentRun(),
          selectedAgent: DEFAULT_MAIN_AGENT,
          status: "streaming"
        }
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const trigger = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.includes(`主 AGENT：${DEFAULT_MAIN_AGENT}`));
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    const menu = document.body.querySelector(".main-agent-menu");
    expect(menu).toBeTruthy();
    expect(menu?.textContent).toContain("TARA_analyst");
    expect(menu?.textContent).toContain("ThreatIntelliganceCommander");

    const options = Array.from(menu?.querySelectorAll("button") ?? []);
    expect(options).toHaveLength(2);

    await act(async () => {
      options[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(document.body.querySelector(".main-agent-menu")).toBeNull();
  });

  it("keeps drawers collapsed by default", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: initialAssistantState
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.querySelector(".bottom-drawer")).toBeNull();
    expect(container.textContent).not.toContain("会话抽屉");
    expect(container.textContent).not.toContain("规则配置中心");
  });

  it("switches drawers with single-open behavior", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
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

    const sessionsButton = container.querySelector("button[aria-label='会话']");
    const rulesButton = container.querySelector("button[aria-label='规则']");

    await act(async () => {
      sessionsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();
    expect(container.textContent).toContain("会话抽屉");

    await act(async () => {
      rulesButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(container.textContent).toContain("规则配置中心");
    expect(container.textContent).toContain("规则配置中心");
    expect(container.textContent).not.toContain("历史会话、当前续聊与新草稿");
  });

  it("keeps composer draft when opening and closing drawers", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: initialAssistantState
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      textarea.value = "draft preserved";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flushUi();

    const contextButton = container.querySelector("button[aria-label='上下文']");
    await act(async () => {
      contextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    const closeButton = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.includes("关闭"));
    await act(async () => {
      closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("draft preserved");
  });

  it("keeps main stage continuity while run drawer opens and closes", async () => {
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
          status: "waiting_for_answer"
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

    expect(container.textContent).toContain("请选择处理方式");

    const runButton = container.querySelector("button[aria-label='运行']");
    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(container.querySelector(".transcript-part[data-component='summary']")?.textContent).toContain("等待补充");
    expect(container.textContent).toContain("请选择处理方式");

    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(container.textContent).toContain("请选择处理方式");
    expect(container.querySelector(".bottom-drawer")).toBeNull();
  });

  it("stays on a blank draft session after clicking new session even when history exists", async () => {
    const historyRun = {
      ...createCurrentRun(),
      runId: "run-history-1",
      sessionId: "ses-history-1",
      status: "done" as const,
      prompt: "历史问题",
      finalOutput: "历史答案",
      updatedAt: "2026-04-02T00:00:03.000Z"
    };

    mockRunHistoryState.history = [historyRun];
    mockRunHistoryState.runDetails = {
      "run-history-1": {
        run: historyRun,
        events: [createRunEvent(1, { runId: "run-history-1", type: "result", message: "历史答案" })],
        answers: []
      }
    };

    const { runtimeSendMessage } = setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: initialAssistantState
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("历史答案");

    const newSessionButton = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.includes("新会话"));
    await act(async () => {
      newSessionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "CLEAR_RESULT" });
    expect(container.textContent).toContain("开始一段新的会话");
    expect(container.textContent).not.toContain("历史答案");
    expect(container.textContent).toContain("新会话");
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

  it("exports diagnostics for the selected run", async () => {
    const state = createAssistantState({
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
        updatedAt: "2026-04-02T00:00:03.000Z"
      },
      runEvents: [createRunEvent(1, { type: "result", message: "最终回答" })]
    });
    const { runtimeSendMessage } = setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: state
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const exportButton = Array.from(container.querySelectorAll("button")).find((node) => node.textContent?.includes("导出诊断日志"));
    await act(async () => {
      exportButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "GET_STATE" });
    expect(mockBuildRunDiagnosticsSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({
        scope: "live",
        run: expect.objectContaining({ runId: "run-1" })
      }),
      backgroundState: state
    }));
    expect(mockDownloadRunDiagnosticsLog).toHaveBeenCalledWith(expect.objectContaining({ runMetadata: { runId: "run-1" } }));
  });

  it("shows part-local action buttons for terminal assistant content", async () => {
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

    expect(container.querySelector("button[aria-label='复制']")).not.toBeNull();
    expect(container.querySelector("button[aria-label='点赞']")).not.toBeNull();
    expect(container.querySelector("button[aria-label='点踩']")).not.toBeNull();
    expect(container.querySelector("button[aria-label='重试']")).not.toBeNull();
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
      startRunResponse: { ok: true, data: { runId: "run-2", selectedAgent: DEFAULT_MAIN_AGENT, currentRun: { ...createCurrentRun(), runId: "run-2", prompt: "原始用户问题" } } }
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const retryButton = container.querySelector("button[aria-label='重试']");
    await act(async () => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(runtimeSendMessage).toHaveBeenLastCalledWith({
      type: "START_RUN",
      payload: {
        prompt: "原始用户问题",
        selectedAgent: DEFAULT_MAIN_AGENT,
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

    const likeButton = container.querySelector("button[aria-label='点赞']");
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

    const dislikeButton = container.querySelector("button[aria-label='点踩']");
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
    expect(container.querySelector(".conversation-inline-status")).toBeNull();
    expect(container.querySelectorAll(".transcript-part[data-part-kind='summary']")).toHaveLength(1);
    expect(container.querySelector(".transcript-part[data-part-kind='summary']")?.textContent).toContain("进行中");
    expect(container.textContent).not.toContain("待确认");
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

  it("keeps the send button enabled for same-session follow-up when final output exists but status is still streaming", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        activeSessionId: "ses-1",
        status: "streaming",
        stream: {
          runId: "run-1",
          status: "streaming",
          pendingQuestionId: null
        },
        currentRun: {
          ...createCurrentRun(),
          sessionId: "ses-1",
          status: "done",
          updatedAt: "2026-04-02T00:00:03.000Z",
          finalOutput: "上一轮回答已完成"
        },
        runEvents: [
          createRunEvent(1, { type: "result", message: "上一轮回答已完成" })
        ]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const startButton = container.querySelector("button[aria-label='发送消息']") as HTMLButtonElement | null;
    expect(startButton?.disabled).toBe(false);
  });

  it("renders assistant markdown in the same flat part stream while streaming deltas", async () => {
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

    expect(container.querySelectorAll(".transcript-part[data-part-role='assistant']")).toHaveLength(2);
    expect(container.querySelector(".transcript-part[data-part-role='assistant'] .transcript-part-copy.markdown-body")).toBeTruthy();
    expect(container.querySelectorAll(".transcript-part[data-part-role='assistant'] h1").length).toBeGreaterThanOrEqual(1);
    expect(container.textContent).toContain("标题");
  });

  /** @ArchitectureID: ELM-APP-EXT-CONVERSATION-LIVE-HISTORY-UX */
  it("renders transcript parts on a unified vertical stream without chat-shell alignment hooks", async () => {
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
          updatedAt: "2026-04-02T00:00:02.000Z",
          finalOutput: "最终回答"
        },
        runEvents: [createRunEvent(1, { type: "result", message: "最终回答" })]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const roleSequence = Array.from(container.querySelectorAll(".transcript-part[data-section='part']")).map((element) => element.getAttribute("data-part-role"));
    expect(roleSequence).toEqual(["user", "assistant", "assistant"]);
    expect(container.querySelector(".transcript-part[data-part-role='user'] [data-section='content']")).toBeTruthy();
    expect(container.querySelector(".transcript-part[data-part-role='assistant'][data-part-kind='text']")).toBeTruthy();
  });

  it("updates assistant streaming text directly from transcript events without buffered typing", async () => {
    setupChromeStub({
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

    await act(async () => {
      await handlers.onEvent?.(createRunEvent(1, {
        type: "thinking",
        message: "第一段",
        data: { field: "text", message_id: "msg-1" }
      }));
    });
    await flushUi();

    expect(container.textContent).toContain("第一段");
    expect(container.querySelector(".streaming-indicator")).toBeNull();
    expect(container.querySelector(".transcript-part[data-part-kind='summary']")?.textContent).toContain("进行中");
    expect(container.querySelector(".transcript-part[data-part-kind='text']")?.textContent ?? "").not.toContain("生成中");

    await act(async () => {
      await handlers.onEvent?.(createRunEvent(2, {
        type: "thinking",
        message: "第二段",
        data: { field: "text", message_id: "msg-1" }
      }));
    });
    await flushUi();

    expect(container.textContent).toContain("第一段第二段");
  });

  it("keeps tool-only streaming state in transcript body while hiding tool payload details", async () => {
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

    expect(container.querySelector("[data-part-kind='text']")).toBeNull();
    expect(container.querySelector("[data-part-kind='tool']")?.textContent).toContain("正在检索相关信息。");
    expect(container.textContent).not.toContain("token=123");
    expect(container.textContent).not.toContain("grep");
  });

  it("renders transcript summary at the tail instead of role labels or status chips", async () => {
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

    expect(container.textContent).toContain("已完成");
    expect(container.textContent).toContain("本轮回答已就绪");
    expect(container.querySelectorAll(".transcript-part[data-part-kind='summary']")).toHaveLength(1);
    expect(container.textContent).not.toContain("You");
    expect(container.textContent).not.toContain("AI");
    expect(container.textContent).not.toContain("你");
    expect(container.textContent).not.toContain("?");
    expect(container.textContent).not.toContain("!");
    expect(container.textContent).not.toContain("Assistant failed");
  });

  it("keeps pause resume follow-up inside the same transcript stream", async () => {
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

    expect(container.textContent).toContain("请选择处理方式");
    expect(container.textContent).toContain("当前 transcript 已暂停");
    expect(container.querySelectorAll(".transcript-part[data-part-kind='summary']")).toHaveLength(1);

    const submitButton = Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.includes("提交回答"));
    await act(async () => {
      submitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushUi();

    expect(container.querySelector(".conversation-inline-status")).toBeNull();
    expect(container.querySelectorAll(".transcript-part[data-part-kind='summary']")).toHaveLength(1);
    expect(container.querySelector(".transcript-part[data-part-kind='summary']")?.textContent).toContain("进行中");
  });

  it("does not render feed-external status nodes for live history and follow-up transcripts", async () => {
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

    expect(container.querySelector(".conversation-inline-status")).toBeNull();
    expect(container.querySelectorAll(".transcript-part[data-part-kind='summary']").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("等待补充");

    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        currentRun: {
          ...createCurrentRun(),
          status: "streaming",
          updatedAt: "2026-04-02T00:00:03.000Z",
          finalOutput: ""
        },
        runEvents: [createRunEvent(1, { type: "tool_call", message: "查询上下文" })]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.querySelector(".conversation-inline-status")).toBeNull();
    expect(container.querySelectorAll(".transcript-part[data-part-kind='summary']").length).toBeGreaterThan(0);

    mockRunHistoryState.selectedHistoryDetail = {
      run: {
        ...createCurrentRun(),
        status: "done",
        finalOutput: "历史结果",
        updatedAt: "2026-04-02T00:00:03.000Z"
      },
      events: [createRunEvent(1, { type: "result", message: "历史结果" })],
      answers: []
    };

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.querySelector(".conversation-inline-status")).toBeNull();
    expect(container.querySelectorAll(".transcript-part[data-part-kind='summary']").length).toBeGreaterThan(0);
  });

  it("keeps follow-up output in the same flat stream while showing tool insertions", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        status: "streaming",
        stream: {
          runId: "run-1",
          status: "streaming",
          pendingQuestionId: null
        },
        currentRun: {
          ...createCurrentRun(),
          status: "streaming",
          updatedAt: "2026-04-02T00:00:04.000Z",
          finalOutput: ""
        },
        answers: [{
          id: "answer-1",
          runId: "run-1",
          questionId: "q-1",
          answer: "继续执行",
          choiceId: "resume",
          submittedAt: "2026-04-02T00:00:02.500Z"
        }],
        runEvents: [
          createRunEvent(1, { type: "tool_call", message: "查询历史 SR" }),
          createRunEvent(2, { type: "thinking", message: "第一段", data: { field: "text", message_id: "msg-1" } }),
          createRunEvent(3, {
            type: "question",
            message: "请选择处理方式",
            question: {
              questionId: "q-1",
              title: "需要确认",
              message: "请选择处理方式",
              options: [{ id: "resume", label: "继续执行", value: "继续执行" }],
              allowFreeText: false
            }
          }),
          createRunEvent(4, { type: "thinking", message: "第二段", data: { field: "text", message_id: "msg-2" } })
        ]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const streamParts = Array.from(container.querySelectorAll(".transcript-part[data-section='part']"));
    expect(streamParts.map((node) => node.getAttribute("data-part-kind"))).toEqual(["prompt", "tool", "text", "question", "answer", "text", "summary"]);
    expect(container.textContent).toContain("查询历史 SR");
    expect(streamParts[1]?.textContent ?? "").toContain("查询历史 SR");
    expect(streamParts[2]?.textContent ?? "").toContain("第一段");
    expect(streamParts[3]?.textContent ?? "").toContain("请选择处理方式");
    expect(streamParts[5]?.textContent ?? "").toContain("第二段");
  });

  it("keeps newer live assistant body when stale final output exists in active run state", async () => {
    setupChromeStub({
      contexts: [createContext({ permissionGranted: true, message: "当前页面已命中规则，可直接采集。" })],
      getStateResponse: createAssistantState({
        currentRun: {
          ...createCurrentRun(),
          status: "streaming",
          updatedAt: "2026-04-02T00:00:03.000Z",
          finalOutput: "第一段"
        },
        runEvents: [
          createRunEvent(1, { type: "thinking", message: "第一段", data: { field: "text", message_id: "msg-1" } }),
          createRunEvent(2, { type: "thinking", message: "第二段", data: { field: "text", message_id: "msg-1" } })
        ]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    expect(container.textContent).toContain("第一段第二段");
    expect(container.textContent).not.toContain("第一段生成中");
  });

  it("does not render visible avatar role markers or message-card shells in transcript output", async () => {
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
          createRunEvent(2, { type: "error", message: "运行失败" }),
          createRunEvent(3, { type: "result", message: "最终回答" })
        ]
      })
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushUi();

    const transcriptText = container.querySelector(".chat-stream-feed")?.textContent ?? "";
    expect(transcriptText).not.toContain("AI");
    expect(transcriptText).not.toContain("你");
    expect(transcriptText).not.toContain("?");
    expect(transcriptText).not.toContain("!");
    expect(transcriptText).not.toContain("You");
    expect(transcriptText).not.toContain("Assistant");
    expect(container.querySelector(".conversation-avatar")).toBeNull();
    expect(container.querySelector(".turn-user")).toBeNull();
    expect(container.querySelector(".conversation-bubble")).toBeNull();
    expect(container.querySelectorAll(".conversation-avatar")).toHaveLength(0);
    expect(container.querySelectorAll(".transcript-message").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".transcript-part[data-section='part']").length).toBeGreaterThan(0);
  });
});
