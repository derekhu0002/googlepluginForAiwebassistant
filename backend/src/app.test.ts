import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { env } from "./config.js";
import type { AnalysisProvider, AnalyzeRequest, AnalyzeResult } from "./types.js";

class ImmediateProvider implements AnalysisProvider {
  readonly name = "test-provider";

  async analyze(input: AnalyzeRequest): Promise<AnalyzeResult> {
    return {
      provider: this.name,
      durationMs: 1,
      markdown: `# ${input.capture.pageTitle}`
    };
  }
}

describe("POST /api/analyze", () => {
  it("returns markdown for valid payload", async () => {
    const app = createApp(new ImmediateProvider());
    const response = await request(app)
      .post("/api/analyze")
      .send({
        capture: {
          pageTitle: "Example",
          pageUrl: "https://example.com",
          metaDescription: "desc",
          h1: "Heading",
          selectedText: "picked"
        },
        context: {
          source: "test"
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.data.markdown).toContain("Example");
  });

  it("rejects invalid payload", async () => {
    const app = createApp(new ImmediateProvider());
    const response = await request(app)
      .post("/api/analyze")
      .send({
        capture: {
          pageTitle: "Example",
          pageUrl: "not-a-url",
          metaDescription: "desc",
          h1: "Heading",
          selectedText: "picked"
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("requires x-api-key when backend api key is enabled", async () => {
    const app = createApp(new ImmediateProvider(), {
      ...env,
      API_KEY: "secret-key",
      ALLOWED_ORIGINS: ["https://example.com"]
    });

    const response = await request(app)
      .post("/api/analyze")
      .set("Origin", "https://example.com")
      .send({
        capture: {
          pageTitle: "Example",
          pageUrl: "https://example.com",
          metaDescription: "desc",
          h1: "Heading",
          selectedText: "picked"
        },
        context: {
          source: "test"
        }
      });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_ERROR");
  });

  it("allows requests with matching x-api-key", async () => {
    const app = createApp(new ImmediateProvider(), {
      ...env,
      API_KEY: "secret-key",
      ALLOWED_ORIGINS: ["https://example.com"]
    });

    const response = await request(app)
      .post("/api/analyze")
      .set("Origin", "https://example.com")
      .set("x-api-key", "secret-key")
      .send({
        capture: {
          pageTitle: "Example",
          pageUrl: "https://example.com",
          metaDescription: "desc",
          h1: "Heading",
          selectedText: "picked"
        },
        context: {
          source: "test"
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("rejects non-whitelisted origin", async () => {
    const app = createApp(new ImmediateProvider(), {
      ...env,
      ALLOWED_ORIGINS: ["https://example.com"]
    });

    const response = await request(app)
      .post("/api/analyze")
      .set("Origin", "https://not-allowed.example")
      .send({
        capture: {
          pageTitle: "Example",
          pageUrl: "https://example.com",
          metaDescription: "desc",
          h1: "Heading",
          selectedText: "picked"
        },
        context: {
          source: "test"
        }
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_ERROR");
  });
});
