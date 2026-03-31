import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = global.fetch;

describe("requestAnalysis", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("forwards optional api key header", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8787");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8787");
    vi.stubEnv("VITE_API_KEY", "secret-key");

    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        data: {
          markdown: "# ok",
          provider: "mock",
          durationMs: 1
        }
      })
    });
    global.fetch = fetchMock as typeof fetch;

    const { requestAnalysis } = await import("./api");
    const result = await requestAnalysis({
      pageTitle: "Example",
      pageUrl: "https://example.com",
      metaDescription: "desc",
      h1: "Heading",
      selectedText: "picked"
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8787/api/analyze",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "secret-key"
        })
      })
    );
  });

  it("maps timeout failure into timeout error", async () => {
    vi.stubEnv("VITE_EXTENSION_ENV", "development");
    vi.stubEnv("VITE_ALLOWED_API_ORIGINS", "http://localhost:8787");
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8787");
    vi.stubEnv("VITE_REQUEST_TIMEOUT_MS", "5");

    global.fetch = vi.fn((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    })) as typeof fetch;

    const { requestAnalysis } = await import("./api");
    const result = await requestAnalysis({
      pageTitle: "Example",
      pageUrl: "https://example.com",
      metaDescription: "desc",
      h1: "Heading",
      selectedText: "picked"
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "TIMEOUT_ERROR",
        message: "Request exceeded 5ms"
      }
    });
  });
});
