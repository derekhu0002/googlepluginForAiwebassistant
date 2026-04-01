import { z } from "zod";
import { extensionConfig } from "./config";
import { createDomainError, ERROR_CODES } from "./errors";
import type { AnalyzeApiResponse, CanonicalCapturedFields } from "./types";

const apiResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    data: z.object({
      markdown: z.string(),
      provider: z.string(),
      durationMs: z.number()
    })
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.enum(ERROR_CODES),
      message: z.string(),
      details: z.unknown().optional()
    })
  })
]);

export async function requestAnalysis(capture: CanonicalCapturedFields): Promise<AnalyzeApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), extensionConfig.requestTimeoutMs);

  try {
    const response = await fetch(`${extensionConfig.apiBaseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(extensionConfig.apiKey ? { "x-api-key": extensionConfig.apiKey } : {})
      },
      body: JSON.stringify({
        capture,
        context: {
          source: "chrome-extension",
          capturedAt: new Date().toISOString()
        }
      }),
      signal: controller.signal
    });

    const json = await response.json();
    return apiResponseSchema.parse(json);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        error: createDomainError("TIMEOUT_ERROR", `Request exceeded ${extensionConfig.requestTimeoutMs}ms`)
      };
    }

    return {
      ok: false,
      error: createDomainError("NETWORK_ERROR", error instanceof Error ? error.message : "Unknown network error")
    };
  } finally {
    clearTimeout(timer);
  }
}
