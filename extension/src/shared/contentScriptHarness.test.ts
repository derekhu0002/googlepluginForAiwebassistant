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
});
