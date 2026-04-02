import { beforeEach, describe, expect, it, vi } from "vitest";

describe("content script fallback behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
  });

  it("injects floating button on allowed pages", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    const addListener = vi.fn();
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage,
        onMessage: { addListener }
      }
    } as unknown as typeof chrome);

    await import("../content/index");

    if (!document.getElementById("ai-web-assistant-floating-button")) {
      document.dispatchEvent(new Event("DOMContentLoaded"));
    }

    expect(document.getElementById("ai-web-assistant-floating-button")).not.toBeNull();
    expect(addListener).toHaveBeenCalled();
  });

  it("collects fields from runtime supplied rules", async () => {
    const listeners: Array<(message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean> = [];
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ ok: true }),
        onMessage: { addListener: vi.fn((handler) => listeners.push(handler)) }
      }
    } as unknown as typeof chrome);

    document.title = "Runtime Title";
    document.body.innerHTML = "<h1>Heading</h1>";

    Object.defineProperty(window, "location", {
      value: new URL("https://example.com/runtime"),
      configurable: true
    });

    await import("../content/index");

    const response = await new Promise<unknown>((resolve) => {
      listeners[0]?.({
        type: "COLLECT_FIELDS",
        payload: {
          fields: [
            { id: "1", key: "pageTitle", label: "页面标题", source: "documentTitle", enabled: true },
            { id: "2", key: "h1", label: "主标题", source: "selectorText", selector: "h1", enabled: true }
          ]
        }
      }, {}, resolve);
    });

    expect(response).toEqual({
      pageTitle: "Runtime Title",
      h1: "Heading"
    });
  });

  it("responds to readiness ping", async () => {
    const listeners: Array<(message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean> = [];
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ ok: true }),
        onMessage: { addListener: vi.fn((handler) => listeners.push(handler)) }
      }
    } as unknown as typeof chrome);

    await import("../content/index");

    const response = await new Promise<unknown>((resolve) => {
      listeners[0]?.({ type: "PING" }, {}, resolve);
    });

    expect(response).toEqual({ ready: true });
  });

  it("extracts username context from page", async () => {
    const listeners: Array<(message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean> = [];
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ ok: true }),
        onMessage: { addListener: vi.fn((handler) => listeners.push(handler)) }
      }
    } as unknown as typeof chrome);

    document.body.innerHTML = '<div data-username="casey"></div>';

    await import("../content/index");

    const response = await new Promise<unknown>((resolve) => {
      listeners[0]?.({ type: "GET_USERNAME_CONTEXT" }, {}, resolve);
    });

    expect(response).toEqual({ username: "casey", usernameSource: "dom_data_attribute" });
  });
});
