import { beforeEach, describe, expect, it, vi } from "vitest";

describe("background rule-driven capture flow", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8787");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8787");
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
      listenerRegistry.handler?.({ type: "CAPTURE_AND_ANALYZE" }, {}, resolve);
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
    const sendMessage = vi.fn().mockResolvedValue({ pageTitle: "Demo", pageUrl: "https://example.com/page" });
    const executeScript = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { markdown: "# ok", provider: "mock", durationMs: 1 } })
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
      listenerRegistry.handler?.({ type: "CAPTURE_AND_ANALYZE" }, {}, resolve);
    }) as { ok: boolean };

    expect(response.ok).toBe(true);
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 1 }, files: ["content.js"] });
    expect(sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: "COLLECT_FIELDS" }));
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
