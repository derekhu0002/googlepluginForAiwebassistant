import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnalysisProvider } from "./index.js";
import { MockAnalysisProvider } from "./mockAnalysisProvider.js";

/**
 * Guardrail: watches backend/src/providers so provider wiring, mock markdown output,
 * and abort propagation stay stable while the backend provider layer evolves.
 */
describe("analysis provider guardrails", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates the configured mock analysis provider by default", () => {
    const provider = createAnalysisProvider();

    expect(provider).toBeInstanceOf(MockAnalysisProvider);
    expect(provider.name).toBe("mock-analysis-provider");
  });

  it("renders capture fields into the markdown analysis result", async () => {
    const provider = new MockAnalysisProvider(0);

    const result = await provider.analyze({
      capture: {
        pageTitle: "Incident SR-1",
        pageUrl: "https://example.com/sr/1",
        metaDescription: "demo",
        h1: "SR Overview",
        selectedText: "critical finding",
        software_version: "v1.2.3"
      },
      context: {
        source: "test"
      }
    });

    expect(result.provider).toBe("mock-analysis-provider");
    expect(result.markdown).toContain("Incident SR-1");
    expect(result.markdown).toContain("https://example.com/sr/1");
    expect(result.markdown).toContain("critical finding");
    expect(result.markdown).toContain("扩展字段 software_version：v1.2.3");
  });

  it("surfaces AbortError when analysis is cancelled", async () => {
    vi.useFakeTimers();
    const provider = new MockAnalysisProvider(1000);
    const controller = new AbortController();

    const pending = provider.analyze(
      {
        capture: {
          pageTitle: "Incident SR-1",
          pageUrl: "https://example.com/sr/1",
          metaDescription: "demo",
          h1: "SR Overview",
          selectedText: "critical finding"
        },
        context: {
          source: "test"
        }
      },
      { signal: controller.signal }
    );
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });

    controller.abort();
    await vi.runAllTimersAsync();

    await rejection;
  });
});