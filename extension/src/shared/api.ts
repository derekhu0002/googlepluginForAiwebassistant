import { z } from "zod";
import { extensionConfig } from "./config";
import { createDomainError, ERROR_CODES } from "./errors";
import type { AnswerApiResponse, CapturedFields, StartRunApiResponse, UsernameContext } from "./types";
import type { NormalizedRunEvent, QuestionAnswerRequest, RunStartRequest } from "./protocol";

const failureSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional()
  })
});

const startRunSchema = z.union([
  z.object({
    ok: z.literal(true),
    data: z.object({
      runId: z.string().min(1)
    })
  }),
  failureSchema
]);

const answerSchema = z.union([
  z.object({
    ok: z.literal(true),
    data: z.object({
      accepted: z.literal(true),
      runId: z.string(),
      questionId: z.string()
    })
  }),
  failureSchema
]);

const nullableOptional = <TSchema extends z.ZodTypeAny>(schema: TSchema) => z.preprocess(
  (value) => value === null ? undefined : value,
  schema.optional()
);

const questionPayloadSchema = z.object({
  questionId: z.string(),
  title: z.string(),
  message: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string(), value: z.string() })),
  allowFreeText: z.boolean(),
  placeholder: z.string().optional()
});

const streamEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  type: z.enum(["thinking", "tool_call", "question", "result", "error"]),
  createdAt: z.string(),
  sequence: z.number(),
  message: z.string(),
  title: z.string().optional(),
  data: nullableOptional(z.record(z.string(), z.unknown())),
  logData: nullableOptional(z.record(z.string(), z.unknown())),
  question: nullableOptional(questionPayloadSchema)
});

function withHeaders() {
  return {
    "Content-Type": "application/json",
    ...(extensionConfig.apiKey ? { "x-api-key": extensionConfig.apiKey } : {})
  };
}

async function parseJsonOrFailure(response: Response) {
  const json = await response.json();
  return json;
}

export async function startRun(prompt: string, capture: CapturedFields, usernameContext: UsernameContext): Promise<StartRunApiResponse> {
  const payload: RunStartRequest = {
    prompt,
    capture,
    context: {
      source: "chrome-extension",
      capturedAt: new Date().toISOString(),
      username: usernameContext.username,
      usernameSource: usernameContext.usernameSource,
      pageTitle: capture.pageTitle,
      pageUrl: capture.pageUrl
    }
  };

  try {
    const response = await fetch(`${extensionConfig.apiBaseUrl}/api/runs`, {
      method: "POST",
      headers: withHeaders(),
      body: JSON.stringify(payload)
    });
    return startRunSchema.parse(await parseJsonOrFailure(response));
  } catch (error) {
    return {
      ok: false,
      error: createDomainError("NETWORK_ERROR", error instanceof Error ? error.message : "Unknown network error")
    };
  }
}

export function createRunEventStream(runId: string, handlers: {
  onEvent: (event: NormalizedRunEvent) => void;
  onError: (error: Error) => void;
  onStatusChange?: (status: "connecting" | "streaming" | "reconnecting") => void;
}): EventSource {
  const streamUrl = new URL(`${extensionConfig.apiBaseUrl}/api/runs/${runId}/events`);
  if (extensionConfig.apiKey) {
    streamUrl.searchParams.set("api_key", extensionConfig.apiKey);
  }

  const eventSource = new EventSource(streamUrl.toString());
  const close = eventSource.close.bind(eventSource);
  let hasConnected = false;
  let hasReceivedEvent = false;
  let terminalEventReceived = false;
  let closedByClient = false;

  const closeStream = () => {
    if (closedByClient) {
      return;
    }
    closedByClient = true;
    close();
  };

  eventSource.close = closeStream;

  handlers.onStatusChange?.("connecting");

  eventSource.addEventListener("open", () => {
    hasConnected = true;
    handlers.onStatusChange?.("streaming");
  });

  eventSource.addEventListener("message", (event) => {
    try {
      const parsed = streamEventSchema.parse(JSON.parse((event as MessageEvent<string>).data));
      hasReceivedEvent = true;
      handlers.onStatusChange?.("streaming");
      if (parsed.type === "result" || parsed.type === "error") {
        terminalEventReceived = true;
      }
      handlers.onEvent(parsed);
      if (terminalEventReceived) {
        closeStream();
      }
    } catch (error) {
      handlers.onError(error instanceof Error ? error : new Error("Invalid stream event"));
    }
  });

  eventSource.addEventListener("error", () => {
    if (terminalEventReceived || closedByClient) {
      return;
    }

    if (!hasConnected && !hasReceivedEvent) {
      handlers.onError(new Error("SSE connection failed"));
      return;
    }

    handlers.onStatusChange?.("reconnecting");
  });

  return eventSource;
}

export async function submitQuestionAnswer(runId: string, payload: QuestionAnswerRequest): Promise<AnswerApiResponse> {
  try {
    const response = await fetch(`${extensionConfig.apiBaseUrl}/api/runs/${runId}/answers`, {
      method: "POST",
      headers: withHeaders(),
      body: JSON.stringify(payload)
    });

    return answerSchema.parse(await parseJsonOrFailure(response));
  } catch (error) {
    return {
      ok: false,
      error: createDomainError("NETWORK_ERROR", error instanceof Error ? error.message : "Unknown network error")
    };
  }
}
