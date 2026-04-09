import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialAssistantState } from "../shared/state";

/** @ArchitectureID: REQ-AIASSIST-UI-CHAT-SEND-DECOUPLE-AND-COMPLETE-RESPONSE-RENDER */
describe("background rule-driven capture flow", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8000");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8000");
    vi.stubEnv("VITE_OPTIONAL_HOST_PERMISSIONS", "https://example.com/*,https://*.example.com/*,http://localhost/*");
    vi.stubEnv("VITE_WEB_ACCESSIBLE_RESOURCE_MATCHES", "https://example.com/*,http://localhost/*");
  });

  it("returns explicit error when no rule matches current page", async () => {
    const storageState: Record<string, unknown> = {
      "ai-web-assistant-rules": [
        {
          id: "rule-1",
          name: "Only example",
          hostnamePattern: "example.com",
          pathPattern: "/allowed/*",
          enabled: true,
          fields: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    };

    const listenerRegistry: { handler?: (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean } = {};
    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, url: "https://example.com/other" }]),
        get: vi.fn().mockResolvedValue({ id: 1, url: "https://example.com/other" }),
        sendMessage: vi.fn()
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storageState[key] })),
          set: vi.fn(async (payload: Record<string, unknown>) => Object.assign(storageState, payload))
        }
      },
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request: vi.fn().mockResolvedValue(true)
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        onMessage: { addListener: vi.fn((handler) => { listenerRegistry.handler = handler; }) },
        onInstalled: { addListener: vi.fn() }
      },
      sidePanel: {
        setOptions: vi.fn().mockResolvedValue(undefined),
        open: vi.fn().mockResolvedValue(undefined),
        setPanelBehavior: vi.fn().mockResolvedValue(undefined)
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as typeof chrome);

    await import("./index");

    const response = await new Promise<unknown>((resolve) => {
      listenerRegistry.handler?.({ type: "START_RUN", payload: { prompt: "hello", capturePageData: true } }, {}, resolve);
    }) as { ok: boolean; error: { code: string } };

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("RULE_NOT_MATCHED_ERROR");
  });

  it("injects content script and captures configured fields", async () => {
    const storageState: Record<string, unknown> = {
      "ai-web-assistant-rules": [
        {
          id: "rule-1",
          name: "Example rule",
          hostnamePattern: "example.com",
          pathPattern: "*",
          enabled: true,
          fields: [
            { id: "field-1", key: "pageTitle", label: "页面标题", source: "documentTitle", enabled: true },
            { id: "field-2", key: "pageUrl", label: "页面地址", source: "pageUrl", enabled: true }
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    };

    const listenerRegistry: { handler?: (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean } = {};
    const sendMessage = vi.fn(async (_tabId: number, message: { type: string }) => {
      if (message.type === "PING") {
        if (sendMessage.mock.calls.filter(([, callMessage]) => (callMessage as { type: string }).type === "PING").length === 1) {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        }

        return { ready: true };
      }

      if (message.type === "COLLECT_FIELDS") {
        return { pageTitle: "Demo", pageUrl: "https://example.com/page", software_version: "v1", selected_sr: "SR-1" };
      }

      if (message.type === "GET_USERNAME_CONTEXT") {
        return { username: "alice", usernameSource: "dom_text" };
      }

      return undefined;
    });
    const executeScript = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { runId: "run-1", sessionId: "ses-1" } })
    }));

    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, url: "https://example.com/page" }]),
        get: vi.fn().mockResolvedValue({ id: 1, url: "https://example.com/page" }),
        sendMessage
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storageState[key] })),
          set: vi.fn(async (payload: Record<string, unknown>) => Object.assign(storageState, payload))
        }
      },
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request: vi.fn().mockResolvedValue(true)
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        onMessage: { addListener: vi.fn((handler) => { listenerRegistry.handler = handler; }) },
        onInstalled: { addListener: vi.fn() }
      },
      sidePanel: {
        setOptions: vi.fn().mockResolvedValue(undefined),
        open: vi.fn().mockResolvedValue(undefined),
        setPanelBehavior: vi.fn().mockResolvedValue(undefined)
      },
      scripting: {
        executeScript
      }
    } as unknown as typeof chrome);

    await import("./index");

    const response = await new Promise<unknown>((resolve) => {
      listenerRegistry.handler?.({ type: "START_RUN", payload: { prompt: "hello", capturePageData: true } }, {}, resolve);
    }) as { ok: boolean; data: { runId: string; sessionId?: string } };

    expect(response.ok).toBe(true);
    expect(response.data.runId).toBe("run-1");
    expect(response.data.sessionId).toBe("ses-1");
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 1 }, files: ["content.js"] });
    expect(sendMessage).toHaveBeenNthCalledWith(1, 1, { type: "PING" });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 1, { type: "PING" });
    expect(sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: "COLLECT_FIELDS" }));
  });

  it("starts run without capture when send is decoupled from page collection", async () => {
    const storageState: Record<string, unknown> = {
      "ai-web-assistant-rules": [
        {
          id: "rule-1",
          name: "Example rule",
          hostnamePattern: "example.com",
          pathPattern: "*",
          enabled: true,
          fields: [
            { id: "field-1", key: "pageTitle", label: "页面标题", source: "documentTitle", enabled: true }
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    };

    const listenerRegistry: { handler?: (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean } = {};
    const sendMessage = vi.fn(async (_tabId: number, message: { type: string }) => {
      if (message.type === "PING") {
        return { ready: true };
      }
      if (message.type === "GET_USERNAME_CONTEXT") {
        throw new Error("should not request username from page when capture is skipped");
      }
      if (message.type === "COLLECT_FIELDS") {
        throw new Error("should not capture page fields during send-only run start");
      }
      return undefined;
    });

    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { runId: "run-send-only", sessionId: "ses-active" } })
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, url: "https://example.com/page" }]),
        get: vi.fn().mockResolvedValue({ id: 1, url: "https://example.com/page" }),
        sendMessage
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storageState[key] })),
          set: vi.fn(async (payload: Record<string, unknown>) => Object.assign(storageState, payload))
        }
      },
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request: vi.fn().mockResolvedValue(true)
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        onMessage: { addListener: vi.fn((handler) => { listenerRegistry.handler = handler; }) },
        onInstalled: { addListener: vi.fn() }
      },
      sidePanel: {
        setOptions: vi.fn().mockResolvedValue(undefined),
        open: vi.fn().mockResolvedValue(undefined),
        setPanelBehavior: vi.fn().mockResolvedValue(undefined)
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as typeof chrome);

    await import("./index");

    const response = await new Promise<unknown>((resolve) => {
      listenerRegistry.handler?.({ type: "START_RUN", payload: { prompt: "hello", capturePageData: false } }, {}, resolve);
    }) as { ok: boolean; data: { runId: string; sessionId?: string; capturedFields: Record<string, string> | null; currentRun: { pageTitle: string; sessionId?: string } } };

    expect(response.ok).toBe(true);
    expect(response.data.runId).toBe("run-send-only");
    expect(response.data.sessionId).toBe("ses-active");
    expect(response.data.capturedFields).toBeNull();
    expect(response.data.currentRun.pageTitle).toBe("");
    expect(response.data.currentRun.sessionId).toBe("ses-active");
    expect(sendMessage).not.toHaveBeenCalledWith(1, expect.objectContaining({ type: "COLLECT_FIELDS" }));
    const fetchCall = fetchMock.mock.calls[0];
    expect(fetchCall?.[0]).toBe("http://localhost:8000/api/runs");
    expect(JSON.parse(fetchCall?.[1]?.body as string)).toMatchObject({
      prompt: "hello",
      context: {
        username: "unknown",
        usernameSource: "unresolved_login_state"
      }
    });
  });

  it("reuses START_RUN orchestration when retry metadata is present", async () => {
    const storageState: Record<string, unknown> = {
      "ai-web-assistant-rules": [
        {
          id: "rule-1",
          name: "Example rule",
          hostnamePattern: "example.com",
          pathPattern: "*",
          enabled: true,
          fields: [
            { id: "field-1", key: "pageTitle", label: "页面标题", source: "documentTitle", enabled: true }
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    };

    const listenerRegistry: { handler?: (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean } = {};
    const sendMessage = vi.fn(async (_tabId: number, message: { type: string }) => {
      if (message.type === "PING") {
        return { ready: true };
      }
      if (message.type === "COLLECT_FIELDS") {
        return { pageTitle: "Demo", pageUrl: "https://example.com/page" };
      }
      if (message.type === "GET_USERNAME_CONTEXT") {
        return { username: "alice", usernameSource: "dom_text" };
      }
      return undefined;
    });

    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { runId: "run-2", sessionId: "ses-existing" } })
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, url: "https://example.com/page" }]),
        get: vi.fn().mockResolvedValue({ id: 1, url: "https://example.com/page" }),
        sendMessage
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({
            [key]: key === "ai-web-assistant-state"
              ? { ...initialAssistantState, activeSessionId: "ses-existing" }
              : storageState[key]
          })),
          set: vi.fn(async (payload: Record<string, unknown>) => Object.assign(storageState, payload))
        }
      },
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request: vi.fn().mockResolvedValue(true)
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        onMessage: { addListener: vi.fn((handler) => { listenerRegistry.handler = handler; }) },
        onInstalled: { addListener: vi.fn() }
      },
      sidePanel: {
        setOptions: vi.fn().mockResolvedValue(undefined),
        open: vi.fn().mockResolvedValue(undefined),
        setPanelBehavior: vi.fn().mockResolvedValue(undefined)
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as typeof chrome);

    await import("./index");

    const response = await new Promise<unknown>((resolve) => {
      listenerRegistry.handler?.({
        type: "START_RUN",
        payload: {
          prompt: "原始用户问题",
          capturePageData: true,
          retryFromRunId: "run-1",
          retryFromMessageId: "message-1"
        }
      }, {}, resolve);
    }) as { ok: boolean; data: { currentRun: { prompt: string; runId: string } } };

    expect(response.ok).toBe(true);
    expect(response.data.currentRun.prompt).toBe("原始用户问题");
    expect(response.data.currentRun.runId).toBe("run-2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({ sessionId: "ses-existing" });
  });

  it("clears active session when CLEAR_RESULT is triggered", async () => {
    const storageState: Record<string, unknown> = {
      "ai-web-assistant-state": {
        ...initialAssistantState,
        activeSessionId: "ses-1",
        currentRun: {
          runId: "run-1",
          sessionId: "ses-1",
          prompt: "hello",
          username: "alice",
          usernameSource: "dom_text",
          softwareVersion: "v1",
          selectedSr: "SR-1",
          pageTitle: "Demo",
          pageUrl: "https://example.com/page",
          status: "done",
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          finalOutput: "done"
        },
        stream: {
          runId: "run-1",
          status: "done",
          pendingQuestionId: null
        }
      }
    };

    const listenerRegistry: { handler?: (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean } = {};
    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, url: "https://example.com/page" }]),
        get: vi.fn().mockResolvedValue({ id: 1, url: "https://example.com/page" }),
        sendMessage: vi.fn()
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storageState[key] })),
          set: vi.fn(async (payload: Record<string, unknown>) => Object.assign(storageState, payload))
        }
      },
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request: vi.fn().mockResolvedValue(true)
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        onMessage: { addListener: vi.fn((handler) => { listenerRegistry.handler = handler; }) },
        onInstalled: { addListener: vi.fn() }
      },
      sidePanel: {
        setOptions: vi.fn().mockResolvedValue(undefined),
        open: vi.fn().mockResolvedValue(undefined),
        setPanelBehavior: vi.fn().mockResolvedValue(undefined)
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as typeof chrome);

    await import("./index");

    const response = await new Promise<unknown>((resolve) => {
      listenerRegistry.handler?.({ type: "CLEAR_RESULT" }, {}, resolve);
    }) as { ok: boolean };

    expect(response.ok).toBe(true);
    expect((storageState["ai-web-assistant-state"] as { activeSessionId: string | null }).activeSessionId).toBeNull();
  });

  it("protects GET_USERNAME_CONTEXT with ready handshake and single controlled retry", async () => {
    const storageState: Record<string, unknown> = {
      "ai-web-assistant-rules": [
        {
          id: "rule-1",
          name: "Example rule",
          hostnamePattern: "example.com",
          pathPattern: "*",
          enabled: true,
          fields: [
            { id: "field-1", key: "pageTitle", label: "页面标题", source: "documentTitle", enabled: true }
          ],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    };

    const listenerRegistry: { handler?: (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean } = {};
    let pingAttempts = 0;
    let usernameAttempts = 0;
    const sendMessage = vi.fn(async (_tabId: number, message: { type: string }) => {
      if (message.type === "PING") {
        pingAttempts += 1;
        if (pingAttempts === 1) {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        }

        return { ready: true };
      }

      if (message.type === "COLLECT_FIELDS") {
        return { pageTitle: "Demo", pageUrl: "https://example.com/page" };
      }

      if (message.type === "GET_USERNAME_CONTEXT") {
        usernameAttempts += 1;
        if (usernameAttempts === 1) {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        }

        return { username: "alice", usernameSource: "dom_text" };
      }

      return undefined;
    });
    const executeScript = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { runId: "run-1" } })
    }));

    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, url: "https://example.com/page" }]),
        get: vi.fn().mockResolvedValue({ id: 1, url: "https://example.com/page" }),
        sendMessage
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storageState[key] })),
          set: vi.fn(async (payload: Record<string, unknown>) => Object.assign(storageState, payload))
        }
      },
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request: vi.fn().mockResolvedValue(true)
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        onMessage: { addListener: vi.fn((handler) => { listenerRegistry.handler = handler; }) },
        onInstalled: { addListener: vi.fn() }
      },
      sidePanel: {
        setOptions: vi.fn().mockResolvedValue(undefined),
        open: vi.fn().mockResolvedValue(undefined),
        setPanelBehavior: vi.fn().mockResolvedValue(undefined)
      },
      scripting: {
        executeScript
      }
    } as unknown as typeof chrome);

    await import("./index");

    const response = await new Promise<unknown>((resolve) => {
      listenerRegistry.handler?.({ type: "START_RUN", payload: { prompt: "hello", capturePageData: true } }, {}, resolve);
    }) as { ok: boolean; data: { usernameContext: { username: string } } };

    expect(response.ok).toBe(true);
    expect(response.data.usernameContext.username).toBe("alice");
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(usernameAttempts).toBe(2);
  });

  it("keeps embedded panel toggle working across injection race", async () => {
    const listenerRegistry: { handler?: (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean } = {};
    let pingAttempts = 0;
    const sendMessage = vi.fn(async (_tabId: number, message: { type: string }) => {
      if (message.type === "PING") {
        pingAttempts += 1;
        if (pingAttempts === 1) {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        }

        return { ready: true };
      }

      if (message.type === "TOGGLE_EMBEDDED_PANEL") {
        return { ok: true };
      }

      return undefined;
    });

    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, url: "https://example.com/page" }]),
        get: vi.fn().mockResolvedValue({ id: 1, url: "https://example.com/page" }),
        sendMessage
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn().mockResolvedValue(undefined)
        }
      },
      permissions: {
        contains: vi.fn().mockResolvedValue(false),
        request: vi.fn().mockResolvedValue(false)
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        onMessage: { addListener: vi.fn((handler) => { listenerRegistry.handler = handler; }) },
        onInstalled: { addListener: vi.fn() }
      },
      sidePanel: {
        setOptions: vi.fn().mockRejectedValue(new Error("unsupported")),
        open: vi.fn().mockResolvedValue(undefined),
        setPanelBehavior: vi.fn().mockResolvedValue(undefined)
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as typeof chrome);

    await import("./index");

    const response = await new Promise<unknown>((resolve) => {
      listenerRegistry.handler?.({ type: "OPEN_PANEL" }, { tab: { id: 1 } }, resolve);
    }) as { ok: boolean };

    expect(response.ok).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(1, { type: "TOGGLE_EMBEDDED_PANEL" });
  });

  it("persists synced live run state from the sidepanel", async () => {
    const storageState: Record<string, unknown> = {
      "ai-web-assistant-state": initialAssistantState
    };
    const listenerRegistry: { handler?: (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean } = {};

    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, url: "https://example.com/page" }]),
        get: vi.fn().mockResolvedValue({ id: 1, url: "https://example.com/page" }),
        sendMessage: vi.fn()
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storageState[key] })),
          set: vi.fn(async (payload: Record<string, unknown>) => Object.assign(storageState, payload))
        }
      },
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request: vi.fn().mockResolvedValue(true)
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        onMessage: { addListener: vi.fn((handler) => { listenerRegistry.handler = handler; }) },
        onInstalled: { addListener: vi.fn() }
      },
      sidePanel: {
        setOptions: vi.fn().mockResolvedValue(undefined),
        open: vi.fn().mockResolvedValue(undefined),
        setPanelBehavior: vi.fn().mockResolvedValue(undefined)
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as typeof chrome);

    await import("./index");

    const response = await new Promise<unknown>((resolve) => {
      listenerRegistry.handler?.({
        type: "SYNC_RUN_STATE",
        payload: {
          status: "done",
          activeSessionId: "ses-1",
          capturedFields: null,
          runPrompt: "hello",
          runEvents: [{
            id: "event-1",
            runId: "run-1",
            type: "result",
            createdAt: "2026-04-02T00:00:01.000Z",
            sequence: 1,
            message: "最终回答"
          }],
          currentRun: {
            runId: "run-1",
            sessionId: "ses-1",
            prompt: "hello",
            username: "alice",
            usernameSource: "dom_text",
            softwareVersion: "",
            selectedSr: "",
            pageTitle: "",
            pageUrl: "",
            status: "done",
            startedAt: "2026-04-02T00:00:00.000Z",
            updatedAt: "2026-04-02T00:00:01.000Z",
            finalOutput: "最终回答"
          },
          answers: [],
          error: null,
          errorMessage: "",
          matchedRule: null,
          lastCapturedUrl: null,
          usernameContext: null,
          stream: {
            runId: "run-1",
            status: "done",
            pendingQuestionId: null
          }
        }
      }, {}, resolve);
    }) as { ok: boolean };

    expect(response.ok).toBe(true);
    expect((storageState["ai-web-assistant-state"] as { currentRun: { finalOutput: string }; stream: { status: string } }).currentRun.finalOutput).toBe("最终回答");
    expect((storageState["ai-web-assistant-state"] as { stream: { status: string } }).stream.status).toBe("done");
  });

  it("returns context with controlled permission request and activeTab fallback hint", async () => {
    const storageState: Record<string, unknown> = {
      "ai-web-assistant-rules": [
        {
          id: "rule-1",
          name: "Example rule",
          hostnamePattern: "example.com",
          pathPattern: "*",
          enabled: true,
          fields: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    };

    const listenerRegistry: { handler?: (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean } = {};

    vi.stubGlobal("chrome", {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 1, url: "https://example.com/page" }]),
        get: vi.fn().mockResolvedValue({ id: 1, url: "https://example.com/page" }),
        sendMessage: vi.fn()
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storageState[key] })),
          set: vi.fn(async (payload: Record<string, unknown>) => Object.assign(storageState, payload))
        }
      },
      permissions: {
        contains: vi.fn().mockResolvedValue(false),
        request: vi.fn().mockResolvedValue(true)
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        onMessage: { addListener: vi.fn((handler) => { listenerRegistry.handler = handler; }) },
        onInstalled: { addListener: vi.fn() }
      },
      sidePanel: {
        setOptions: vi.fn().mockResolvedValue(undefined),
        open: vi.fn().mockResolvedValue(undefined),
        setPanelBehavior: vi.fn().mockResolvedValue(undefined)
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as typeof chrome);

    await import("./index");

    const response = await new Promise<unknown>((resolve) => {
      listenerRegistry.handler?.({ type: "GET_ACTIVE_CONTEXT" }, {}, resolve);
    }) as { canRequestPermission: boolean; activeTabFallbackAvailable: boolean; permissionOrigin: string | null };

    expect(response.canRequestPermission).toBe(true);
    expect(response.activeTabFallbackAvailable).toBe(true);
    expect(response.permissionOrigin).toBe("https://example.com/*");
  });
});
