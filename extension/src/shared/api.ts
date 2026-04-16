import { z } from "zod";
import { extensionConfig } from "./config";
import { createDomainError, ERROR_CODES } from "./errors";
import type { AnswerApiResponse, CapturedFields, FeedbackApiResponse, StartRunApiResponse, UsernameContext } from "./types";
import {
  MAIN_AGENTS,
  appendTranscriptTrace,
  deriveTranscriptTraceCorrelation,
  type MainAgent,
  type MessageFeedbackRequest,
  type NormalizedRunEvent,
  type QuestionAnswerRequest,
  type RunStartRequest,
  type TranscriptTraceRecord,
  withCanonicalEventMetadata
} from "./protocol";

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
/** @ArchitectureID: ELM-FUNC-EXT-PACKAGE-CAPTURE-RUNSTART */
/** @ArchitectureID: ELM-COMP-EXT-SHARED */
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
/** @ArchitectureID: ELM-FUNC-EXT-CAPTURE-TRANSPORT-CANONICAL-TRACE */
/** @SoftwareUnitID: SU-EXT-SHARED-RUN-STREAM-CONTRACT */
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

  const buildTrace = (
    stage: TranscriptTraceRecord["stage"],
    step: string,
    outcome: TranscriptTraceRecord["outcome"],
    event: Pick<NormalizedRunEvent, "runId" | "id" | "sequence" | "message" | "question" | "tool" | "semantic" | "canonical">,
    details?: Record<string, unknown>
  ): TranscriptTraceRecord => ({
    stage,
    step,
    outcome,
    createdAt: new Date().toISOString(),
    correlation: deriveTranscriptTraceCorrelation(event),
    details
  });

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
  logTransport({
    transition: "connecting",
    reconnectCount,
    closeReason: null,
    trace: {
      stage: "transport",
      step: "connect",
      outcome: "info",
      createdAt: new Date().toISOString(),
      correlation: {
        runId,
        rawEventId: null,
        canonicalEventKey: null,
        sequence: null,
        contentKey: null,
        contentPreview: ""
      },
      details: { reconnectCount, state: "connecting" }
    } satisfies TranscriptTraceRecord
  });

  eventSource.addEventListener("open", () => {
    hasConnected = true;
    handlers.onStatusChange?.("streaming");
    logTransport({
      transition: reconnectCount > 0 ? "reopen" : "open",
      reconnectCount,
      closeReason: null,
      trace: {
        stage: "transport",
        step: reconnectCount > 0 ? "reopen" : "open",
        outcome: "success",
        createdAt: new Date().toISOString(),
        correlation: {
          runId,
          rawEventId: null,
          canonicalEventKey: null,
          sequence: null,
          contentKey: null,
          contentPreview: ""
        },
        details: { reconnectCount }
      } satisfies TranscriptTraceRecord
    });
  });

  eventSource.addEventListener("message", (event) => {
    const messageEvent = event as MessageEvent<string>;
    const receivedAt = new Date().toISOString();
    const rawData = messageEvent.data;
    const transportReceiptTrace = {
      stage: "transport",
      step: "receipt",
      outcome: "info",
      createdAt: receivedAt,
      correlation: {
        runId,
        rawEventId: null,
        canonicalEventKey: null,
        sequence: null,
        contentKey: rawData.trim() ? `${rawData.trim().slice(0, 160).length}:${rawData.trim().slice(0, 160)}` : null,
        contentPreview: rawData.trim().slice(0, 160)
      },
      details: {
        reconnectCount,
        rawByteLength: rawData.length
      }
    } satisfies TranscriptTraceRecord;
    try {
      const parsedJson = JSON.parse(rawData);
      const parsedTransportEvent = streamEventSchema.parse(parsedJson);
      const parsedTraceBase = withCanonicalEventMetadata(parsedTransportEvent);
      const parseSuccessTrace = buildTrace("transport", "parse", "success", parsedTraceBase, {
        reconnectCount,
        receivedAt
      });
      const canonicalTrace = buildTrace("transport", "canonicalize", "success", parsedTraceBase, {
        reconnectCount,
        identitySource: parsedTraceBase.canonical?.identitySource,
        orderKey: parsedTraceBase.canonical?.orderKey
      });
      const normalizedBase = appendTranscriptTrace(
        appendTranscriptTrace(
          appendTranscriptTrace(parsedTraceBase, transportReceiptTrace),
          parseSuccessTrace
        ),
        canonicalTrace
      );
      const normalizedTrace = buildTrace("transport", "normalize", "success", normalizedBase, {
        reconnectCount,
        semanticIdentity: normalizedBase.semantic?.identity ?? null
      });
      const parsed = appendTranscriptTrace(normalizedBase, normalizedTrace);
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
        parseSuccess: true,
        trace: transportReceiptTrace
      });
      handlers.onEvent(transportedEvent);
      if (handlers.shouldClose?.(parsed)) {
        closeStream();
      }
    } catch (error) {
      let failureReason = error instanceof Error ? error.message : "Invalid stream event";
      let failureStep = "parse";
      if (error instanceof z.ZodError) {
        failureStep = "normalize";
      }
      logTransport({
        transition: "message_error",
        reconnectCount,
        parseSuccess: false,
        reason: failureReason,
        failureStep,
        trace: {
          stage: "transport",
          step: failureStep,
          outcome: "failure",
          createdAt: new Date().toISOString(),
          correlation: transportReceiptTrace.correlation,
          details: {
            reconnectCount,
            reason: failureReason
          }
        } satisfies TranscriptTraceRecord
      });
      handlers.onError(error instanceof Error ? error : new Error("Invalid stream event"));
    }
  });

  eventSource.addEventListener("error", () => {
    if (closedByClient) {
      return;
    }

    if (!hasConnected && !hasReceivedEvent) {
      logTransport({
        transition: "error",
        reconnectCount,
        closeReason: "connection_failed",
        trace: {
          stage: "transport",
          step: "connection_error",
          outcome: "failure",
          createdAt: new Date().toISOString(),
          correlation: {
            runId,
            rawEventId: null,
            canonicalEventKey: null,
            sequence: null,
            contentKey: null,
            contentPreview: ""
          },
          details: { reconnectCount, closeReason: "connection_failed" }
        } satisfies TranscriptTraceRecord
      });
      handlers.onError(new Error("SSE connection failed"));
      return;
    }

    reconnectCount += 1;
    handlers.onStatusChange?.("reconnecting");
    logTransport({
      transition: "reconnecting",
      reconnectCount,
      closeReason: "eventsource_error",
      trace: {
        stage: "transport",
        step: "reconnecting",
        outcome: "info",
        createdAt: new Date().toISOString(),
        correlation: {
          runId,
          rawEventId: null,
          canonicalEventKey: null,
          sequence: null,
          contentKey: null,
          contentPreview: ""
        },
        details: { reconnectCount, closeReason: "eventsource_error" }
      } satisfies TranscriptTraceRecord
    });
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
