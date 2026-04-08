import cors from "cors";
import express from "express";
import { ZodError } from "zod";
import { env, type BackendEnv } from "./config.js";
import { AnalysisError, AppError, AuthError, PermissionError, ValidationError } from "./errors.js";
import type { AnalysisProvider } from "./types.js";
import { analyzeRequestSchema, messageFeedbackRequestSchema } from "./schema.js";
import { withTimeout } from "./timeout.js";

export function createApp(provider: AnalysisProvider, appEnv: BackendEnv = env) {
  const app = express();

  app.use(cors({
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
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true, provider: provider.name });
  });

  app.post("/api/analyze", async (request, response, next) => {
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

  /** @ArchitectureID: ELM-APP-BACKEND-RUN-FEEDBACK-SERVICE */
  app.post("/api/message-feedback", async (request, response, next) => {
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
          updatedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
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
          ...(error instanceof ValidationError && error.details ? { details: error.details } : {})
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

  return app;
}
