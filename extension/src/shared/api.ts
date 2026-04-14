import { z } from "zod";
import { extensionConfig } from "./config";
import { createDomainError, ERROR_CODES } from "./errors";
import type { AnswerApiResponse, CapturedFields, FeedbackApiResponse, StartRunApiResponse, UsernameContext } from "./types";
import { MAIN_AGENTS, type MainAgent, type MessageFeedbackRequest, type NormalizedRunEvent, type QuestionAnswerRequest, type RunStartRequest, withCanonicalEventMetadata } from "./protocol";

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
        runId: z.string().min(1),
        selectedAgent: z.enum(MAIN_AGENTS),
        sessionId: z.string().min(1).optional()
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

const feedbackSchema = z.union([
  z.object({
    ok: z.literal(true),
    data: z.object({
      accepted: z.literal(true),
      runId: z.string(),
      messageId: z.string(),
      feedback: z.enum(["like", "dislike"]),
      updatedAt: z.string()
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

const eventSemanticSchema = z.object({
  channel: z.enum(["reasoning", "assistant_text", "tool"]),
  emissionKind: z.enum(["delta", "snapshot", "final"]),
  identity: z.string().min(1),
  itemKind: z.enum(["reasoning", "text", "tool"]),
  messageId: nullableOptional(z.string().min(1)),
  partId: nullableOptional(z.string().min(1))
});

const eventToolSchema = z.object({
  name: nullableOptional(z.string().min(1)),
  status: nullableOptional(z.string().min(1)),
  title: nullableOptional(z.string().min(1)),
  callId: nullableOptional(z.string().min(1))
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
  tool: nullableOptional(eventToolSchema),
  question: nullableOptional(questionPayloadSchema),
  semantic: nullableOptional(eventSemanticSchema)
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

/** @ArchitectureID: REQ-AIASSIST-UI-CHAT-SEND-DECOUPLE-AND-COMPLETE-RESPONSE-RENDER */
export async function startRun(prompt: string, capture: CapturedFields | null, usernameContext: UsernameContext, selectedAgent: MainAgent, sessionId?: string | null): Promise<StartRunApiResponse> {
  const normalizedCapture = capture && Object.keys(capture).length > 0 ? capture : null;
  const payload: RunStartRequest = {
    prompt,
    selectedAgent,
    ...(normalizedCapture ? { capture: normalizedCapture } : {}),
    ...(sessionId ? { sessionId } : {}),
    context: {
      source: "chrome-extension",
      capturedAt: new Date().toISOString(),
      username: usernameContext.username,
      usernameSource: usernameContext.usernameSource,
      ...(normalizedCapture?.pageTitle ? { pageTitle: normalizedCapture.pageTitle } : {}),
      ...(normalizedCapture?.pageUrl ? { pageUrl: normalizedCapture.pageUrl } : {})
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

/** @ArchitectureID: REQ-AIASSIST-UI-CHAT-SEND-DECOUPLE-AND-COMPLETE-RESPONSE-RENDER */
/** @ArchitectureID: ELM-FUNC-EXT-CALL-ADAPTER-API */
export function createRunEventStream(runId: string, handlers: {
  onEvent: (event: NormalizedRunEvent) => void;
  onError: (error: Error) => void;
  onStatusChange?: (status: "connecting" | "streaming" | "reconnecting") => void;
  onTransportLog?: (entry: Record<string, unknown>) => void;
  shouldClose?: (event: NormalizedRunEvent) => boolean;
}): EventSource {
  const streamUrl = new URL(`${extensionConfig.apiBaseUrl}/api/runs/${runId}/events`);
  if (extensionConfig.apiKey) {
    streamUrl.searchParams.set("api_key", extensionConfig.apiKey);
  }

  const eventSource = new EventSource(streamUrl.toString());
  const close = eventSource.close.bind(eventSource);
  let hasConnected = false;
  let hasReceivedEvent = false;
  let closedByClient = false;
  let reconnectCount = 0;

  const logTransport = (entry: Record<string, unknown>) => {
    handlers.onTransportLog?.({
      runId,
      source: "transport",
      ...entry
    });
  };

  const closeStream = () => {
    if (closedByClient) {
      return;
    }
    closedByClient = true;
    close();
  };

  eventSource.close = closeStream;

  handlers.onStatusChange?.("connecting");
  logTransport({ transition: "connecting", reconnectCount, closeReason: null });

  eventSource.addEventListener("open", () => {
    hasConnected = true;
    handlers.onStatusChange?.("streaming");
    logTransport({ transition: reconnectCount > 0 ? "reopen" : "open", reconnectCount, closeReason: null });
  });

  eventSource.addEventListener("message", (event) => {
    try {
      const parsed = withCanonicalEventMetadata(streamEventSchema.parse(JSON.parse((event as MessageEvent<string>).data)));
      hasReceivedEvent = true;
      handlers.onStatusChange?.("streaming");
      const transportedEvent: NormalizedRunEvent = {
        ...parsed,
        transport: {
          rawEventId: parsed.id,
          receivedAt: new Date().toISOString(),
          reconnectCount,
          streamStatus: "streaming"
        }
      };
      logTransport({
        transition: "message",
        reconnectCount,
        rawEventId: transportedEvent.id,
        canonicalEventKey: transportedEvent.canonical?.key,
        semanticIdentity: transportedEvent.semantic?.identity,
        messageId: transportedEvent.semantic?.messageId,
        partId: transportedEvent.semantic?.partId,
        parseSuccess: true
      });
      handlers.onEvent(transportedEvent);
      if (handlers.shouldClose?.(parsed)) {
        closeStream();
      }
    } catch (error) {
      logTransport({
        transition: "message_error",
        reconnectCount,
        parseSuccess: false,
        reason: error instanceof Error ? error.message : "Invalid stream event"
      });
      handlers.onError(error instanceof Error ? error : new Error("Invalid stream event"));
    }
  });

  eventSource.addEventListener("error", () => {
    if (closedByClient) {
      return;
    }

    if (!hasConnected && !hasReceivedEvent) {
      logTransport({ transition: "error", reconnectCount, closeReason: "connection_failed" });
      handlers.onError(new Error("SSE connection failed"));
      return;
    }

    reconnectCount += 1;
    handlers.onStatusChange?.("reconnecting");
    logTransport({ transition: "reconnecting", reconnectCount, closeReason: "eventsource_error" });
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

/** @ArchitectureID: ELM-APP-EXT-SHARED-API-CONTRACT */
export async function submitMessageFeedback(payload: MessageFeedbackRequest): Promise<FeedbackApiResponse> {
  try {
    const response = await fetch(`${extensionConfig.apiBaseUrl}/api/message-feedback`, {
      method: "POST",
      headers: withHeaders(),
      body: JSON.stringify(payload)
    });

    return feedbackSchema.parse(await parseJsonOrFailure(response));
  } catch (error) {
    return {
      ok: false,
      error: createDomainError("NETWORK_ERROR", error instanceof Error ? error.message : "Unknown network error")
    };
  }
}
