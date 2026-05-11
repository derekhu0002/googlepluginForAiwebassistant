import { beforeEach, describe, expect, it, vi } from "vitest";

type RuntimeHandler = (message: unknown, sender: unknown, sendResponse: (value: unknown) => void) => boolean;

function createChromeStub() {
  const registry: { handler?: RuntimeHandler } = {};

  vi.stubGlobal("chrome", {
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: {
        addListener: vi.fn((handler: RuntimeHandler) => {
          registry.handler = handler;
        })
      }
    }
  } as unknown as typeof chrome);

  return registry;
}

async function loadContentScript() {
  await import("./index");
  document.dispatchEvent(new Event("DOMContentLoaded"));
}

function dispatchMessage(handler: RuntimeHandler | undefined, message: unknown) {
  return new Promise<unknown>((resolve) => {
    handler?.(message, {}, resolve);
  });
}

/**
 * Guardrail: watches extension/src/content so page field capture, username extraction,
 * and embedded sidepanel toggling do not regress when the content script changes.
 */
describe("content script guardrails", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  it("creates the floating launcher and captures configured page fields", async () => {
    const registry = createChromeStub();
    document.title = "SR Dashboard";
    document.body.innerHTML = "<main><h1>Overview</h1></main>";

    await loadContentScript();

    const button = document.getElementById("ai-web-assistant-floating-button");
    expect(button?.textContent).toBe("AI");

    const response = await dispatchMessage(registry.handler, {
      type: "COLLECT_FIELDS",
      payload: {
        fields: [
          { key: "pageTitle", source: "documentTitle", enabled: true },
          { key: "pageUrl", source: "pageUrl", enabled: true },
          { key: "headline", source: "selectorText", selector: "h1", enabled: true },
          { key: "ignored", source: "selectorText", selector: "h2", enabled: false }
        ]
      }
    });

    expect(response).toEqual({
      pageTitle: "SR Dashboard",
      pageUrl: "http://localhost:3000/",
      headline: "Overview"
    });
  });

  it("extracts username context from DOM data attributes before fallback sources", async () => {
    const registry = createChromeStub();
    document.body.innerHTML = "<div data-username='alice'>Ignored text</div>";

    await loadContentScript();

    const response = await dispatchMessage(registry.handler, { type: "GET_USERNAME_CONTEXT" });
    expect(response).toEqual({
      username: "alice",
      usernameSource: "dom_data_attribute"
    });
  });

  it("toggles the embedded sidepanel iframe on repeated requests", async () => {
    const registry = createChromeStub();
    document.body.innerHTML = "<main>ready</main>";

    await loadContentScript();

    const opened = await dispatchMessage(registry.handler, { type: "TOGGLE_EMBEDDED_PANEL" });
    expect(opened).toEqual({ ok: true });
    expect(document.getElementById("ai-web-assistant-embedded-panel")).not.toBeNull();
    const iframe = document.querySelector("#ai-web-assistant-embedded-panel iframe") as HTMLIFrameElement | null;
    expect(iframe?.src).toContain("sidepanel.html?mode=embedded");

    const closed = await dispatchMessage(registry.handler, { type: "TOGGLE_EMBEDDED_PANEL" });
    expect(closed).toEqual({ ok: true });
    expect(document.getElementById("ai-web-assistant-embedded-panel")).toBeNull();
  });
});