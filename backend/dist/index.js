// src/app.ts
import cors from "cors";
import express from "express";
import { ZodError } from "zod";

// src/config.ts
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
loadDotenv();
var envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ALLOWED_ORIGINS: z.string().optional().default(""),
  API_KEY: z.string().optional().default(""),
  ANALYSIS_TIMEOUT_MS: z.coerce.number().int().positive().default(1e4),
  MOCK_PROVIDER_DELAY_MS: z.coerce.number().int().min(0).default(300)
});
var parsedEnv = envSchema.parse(process.env);
var DEFAULT_PRODUCTION_ALLOWED_ORIGINS = ["https://example.com", "https://app.example.com"];
var DEFAULT_DEVELOPMENT_ALLOWED_ORIGINS = ["http://localhost:5173", "chrome-extension://dev-extension-id"];
function parseOrigins(input) {
  return input.split(",").map((item) => item.trim()).filter(Boolean);
}
function isLocalOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
function validateAllowedOrigin(origin, envName) {
  const url = new URL(origin);
  if (url.protocol === "https:" || url.protocol === "chrome-extension:") {
    return url.origin;
  }
  if ((envName === "development" || envName === "test") && isLocalOrigin(origin)) {
    return url.origin;
  }
  throw new Error(`ALLOWED_ORIGINS must be HTTPS/chrome-extension origins, or localhost during development: ${origin}`);
}
var allowedOrigins = (parsedEnv.ALLOWED_ORIGINS ? parseOrigins(parsedEnv.ALLOWED_ORIGINS) : parsedEnv.NODE_ENV === "production" ? DEFAULT_PRODUCTION_ALLOWED_ORIGINS : DEFAULT_DEVELOPMENT_ALLOWED_ORIGINS).map((origin) => validateAllowedOrigin(origin, parsedEnv.NODE_ENV));
var env = {
  ...parsedEnv,
  ALLOWED_ORIGINS: Array.from(new Set(allowedOrigins))
};

// src/errors.ts
var AppError = class extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
};
var AuthError = class extends AppError {
  constructor(message = "Unauthorized request") {
    super(message, "AUTH_ERROR", 401);
  }
};
var PermissionError = class extends AppError {
  constructor(message = "Origin is not allowed") {
    super(message, "PERMISSION_ERROR", 403);
  }
};
var ValidationError = class extends AppError {
  constructor(message = "Invalid analyze payload", details) {
    super(message, "VALIDATION_ERROR", 400);
    this.details = details;
  }
};
var TimeoutError = class extends AppError {
  constructor(message = "Analysis timed out") {
    super(message, "TIMEOUT_ERROR", 504);
  }
};
var AnalysisError = class extends AppError {
  constructor(message = "Analysis provider failed") {
    super(message, "ANALYSIS_ERROR", 502);
  }
};

// src/schema.ts
import { z as z2 } from "zod";
var captureSchema = z2.object({
  pageTitle: z2.string().max(500).default(""),
  pageUrl: z2.string().url().max(2048),
  metaDescription: z2.string().max(2e3).default(""),
  h1: z2.string().max(500).default(""),
  selectedText: z2.string().max(5e3).default("")
}).catchall(z2.string().max(5e3));
var analyzeRequestSchema = z2.object({
  capture: captureSchema,
  context: z2.object({
    source: z2.string().max(100).optional(),
    capturedAt: z2.string().max(100).optional()
  }).optional()
});
var messageFeedbackRequestSchema = z2.object({
  runId: z2.string().min(1).max(200),
  messageId: z2.string().min(1).max(200),
  feedback: z2.enum(["like", "dislike"])
});

// src/timeout.ts
async function withTimeout(promiseFactory, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await promiseFactory(controller.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new TimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// src/app.ts
function createApp(provider, appEnv = env) {
  const app2 = express();
  app2.use(cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (appEnv.ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new PermissionError(`Origin is not in backend allowlist: ${origin}`));
    }
  }));
  app2.use(express.json({ limit: "100kb" }));
  app2.get("/health", (_request, response) => {
    response.json({ ok: true, provider: provider.name });
  });
  app2.post("/api/analyze", async (request, response, next) => {
    try {
      if (appEnv.API_KEY) {
        const incomingApiKey = request.header("x-api-key");
        if (incomingApiKey !== appEnv.API_KEY) {
          throw new AuthError();
        }
      }
      const payload = analyzeRequestSchema.parse(request.body);
      const result = await withTimeout(
        (signal) => provider.analyze(payload, { signal }),
        appEnv.ANALYSIS_TIMEOUT_MS
      );
      response.json({
        ok: true,
        data: result
      });
    } catch (error) {
      next(error);
    }
  });
  app2.post("/api/message-feedback", async (request, response, next) => {
    try {
      if (appEnv.API_KEY) {
        const incomingApiKey = request.header("x-api-key");
        if (incomingApiKey !== appEnv.API_KEY) {
          throw new AuthError();
        }
      }
      const payload = messageFeedbackRequestSchema.parse(request.body);
      response.json({
        ok: true,
        data: {
          accepted: true,
          runId: payload.runId,
          messageId: payload.messageId,
          feedback: payload.feedback,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  });
  app2.use((error, _request, response, _next) => {
    if (error instanceof ZodError) {
      const validationError = new ValidationError("Invalid analyze payload", error.flatten());
      response.status(400).json({
        ok: false,
        error: {
          code: validationError.code,
          message: validationError.message,
          details: validationError.details
        }
      });
      return;
    }
    if (error instanceof AppError) {
      response.status(error.statusCode).json({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...error instanceof ValidationError && error.details ? { details: error.details } : {}
        }
      });
      return;
    }
    const fallback = error instanceof Error ? error.message : "Unknown server error";
    const wrapped = new AnalysisError(fallback);
    response.status(wrapped.statusCode).json({
      ok: false,
      error: {
        code: wrapped.code,
        message: wrapped.message
      }
    });
  });
  return app2;
}

// src/providers/mockAnalysisProvider.ts
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    function onAbort() {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    }
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
var MockAnalysisProvider = class {
  constructor(delayMs) {
    this.delayMs = delayMs;
  }
  name = "mock-analysis-provider";
  async analyze(input, options) {
    const startedAt = Date.now();
    await sleep(this.delayMs, options?.signal);
    const { capture } = input;
    const emphasis = capture.selectedText ? `\u5F53\u524D\u7528\u6237\u9AD8\u4EAE\u6587\u672C\uFF1A> ${capture.selectedText}` : "\u5F53\u524D\u9875\u9762\u6CA1\u6709\u9AD8\u4EAE\u6587\u672C\uFF0C\u5EFA\u8BAE\u7ED3\u5408\u6807\u9898\u4E0E H1 \u505A\u6574\u4F53\u7406\u89E3\u3002";
    return {
      provider: this.name,
      durationMs: Date.now() - startedAt,
      markdown: [
        "# \u9875\u9762\u5206\u6790\u7ED3\u679C",
        "",
        "## \u6458\u8981",
        `- \u9875\u9762\u6807\u9898\uFF1A**${capture.pageTitle || "\u672A\u83B7\u53D6"}**`,
        `- \u9875\u9762\u5730\u5740\uFF1A${capture.pageUrl || "\u672A\u83B7\u53D6"}`,
        `- \u9875\u9762\u4E3B\u6807\u9898\uFF1A${capture.h1 || "\u672A\u83B7\u53D6"}`,
        "",
        "## \u89C2\u5BDF",
        `- Meta Description\uFF1A${capture.metaDescription || "\u7A7A"}`,
        `- ${emphasis}`,
        ...Object.entries(capture).filter(([key]) => !["pageTitle", "pageUrl", "metaDescription", "h1", "selectedText"].includes(key)).map(([key, value]) => `- \u6269\u5C55\u5B57\u6BB5 ${key}\uFF1A${value || "\u7A7A"}`),
        "",
        "## \u5EFA\u8BAE",
        "1. \u4F18\u5148\u6838\u5BF9\u9875\u9762\u6807\u9898\u4E0E H1 \u662F\u5426\u4E00\u81F4\u3002",
        "2. \u82E5\u9AD8\u4EAE\u6587\u672C\u5B58\u5728\uFF0C\u53EF\u4F5C\u4E3A\u540E\u7EED\u771F\u5B9E LLM \u603B\u7ED3\u7684\u91CD\u70B9\u4E0A\u4E0B\u6587\u3002",
        "3. \u5F53\u524D\u4E3A Mock Provider\uFF0C\u540E\u7EED\u53EF\u66FF\u6362\u4E3A\u771F\u5B9E\u6A21\u578B\u63D0\u4F9B\u5546\u3002"
      ].join("\n")
    };
  }
};

// src/providers/index.ts
function createAnalysisProvider() {
  return new MockAnalysisProvider(env.MOCK_PROVIDER_DELAY_MS);
}

// src/index.ts
var app = createApp(createAnalysisProvider());
app.listen(env.PORT, () => {
  console.log(`Mock analysis API listening on port ${env.PORT}`);
});
