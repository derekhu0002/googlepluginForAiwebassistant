import type {
  NormalizedRunEvent,
  QuestionOption,
  QuestionPayload,
  RawRunEventEnvelope
} from "../shared/protocol";

interface BufferedPartDelta {
  delta: string;
  messageId?: string;
}

interface ProjectorState {
  sequence: number;
  waitingQuestionId: string | null;
  questionRequests: Record<string, Record<string, unknown>>;
  partTypes: Record<string, string>;
  bufferedPartDeltas: Record<string, BufferedPartDelta>;
  assistantMessageId: string | null;
  lastOutputText: string;
  resultEmitted: boolean;
}

export interface OpencodeRawEventProjector {
  project: (event: RawRunEventEnvelope) => NormalizedRunEvent[];
}

function createInitialState(): ProjectorState {
  return {
    sequence: 0,
    waitingQuestionId: null,
    questionRequests: {},
    partTypes: {},
    bufferedPartDeltas: {},
    assistantMessageId: null,
    lastOutputText: "",
    resultEmitted: false
  };
}

function responseTextData(messageId?: string | null) {
  return messageId ? { field: "text", message_id: messageId } : { field: "text" };
}

function assistantTextIdentity(messageId?: string | null, partId?: string | null) {
  return ["assistant_text", messageId || "unknown-message", partId || "message-body"].join(":");
}

function reasoningIdentity(messageId?: string | null, partId?: string | null) {
  return ["reasoning", messageId || "unknown-message", partId || "message-reasoning"].join(":");
}

function toolIdentity(messageId?: string | null, partId?: string | null, callId?: string | null, toolName?: string | null) {
  return ["tool", messageId || "unknown-message", partId || callId || toolName || "tool-state"].join(":");
}

function assistantTextSemantic(messageId: string | undefined | null, emissionKind: "delta" | "snapshot" | "final", partId?: string | null) {
  return {
    channel: "assistant_text" as const,
    emissionKind,
    identity: assistantTextIdentity(messageId, partId),
    itemKind: "text" as const,
    messageId: messageId || undefined,
    partId: partId || undefined
  };
}

function reasoningSemantic(messageId: string | undefined | null, emissionKind: "delta" | "snapshot" | "final", partId?: string | null) {
  return {
    channel: "reasoning" as const,
    emissionKind,
    identity: reasoningIdentity(messageId, partId),
    itemKind: "reasoning" as const,
    messageId: messageId || undefined,
    partId: partId || undefined
  };
}

function toolSemantic(messageId: string | undefined | null, emissionKind: "delta" | "snapshot" | "final", options: { partId?: string | null; callId?: string | null; toolName?: string | null } = {}) {
  return {
    channel: "tool" as const,
    emissionKind,
    identity: toolIdentity(messageId, options.partId, options.callId, options.toolName),
    itemKind: "tool" as const,
    messageId: messageId || undefined,
    partId: options.partId || undefined
  };
}

function simplifyToolCallMessage(toolName: string, status: string, title: unknown = null) {
  const parts = [
    typeof title === "string" && title.trim() ? title.trim() : "",
    toolName.trim() ? `tool=${toolName.trim()}` : "",
    status.trim() ? `status=${status.trim()}` : ""
  ].filter(Boolean);

  return parts.join(" | ") || "收到工具状态更新。";
}

function normalizeQuestionRequest(requestPayload: Record<string, unknown>): QuestionPayload {
  const questions = Array.isArray(requestPayload.questions) ? requestPayload.questions : [];
  const firstQuestion = (questions[0] ?? {}) as Record<string, unknown>;
  const rawOptions = Array.isArray(firstQuestion.options) ? firstQuestion.options : [];
  const options: QuestionOption[] = rawOptions.map((option, index) => {
    const rawOption = (option ?? {}) as Record<string, unknown>;
    const label = typeof rawOption.label === "string" && rawOption.label.trim() ? rawOption.label : `选项 ${index + 1}`;
    return {
      id: `${typeof requestPayload.id === "string" ? requestPayload.id : "question"}-option-${index}`,
      label,
      value: label
    };
  });

  return {
    questionId: typeof requestPayload.id === "string" && requestPayload.id.trim() ? requestPayload.id : `question-${Date.now()}`,
    title: typeof firstQuestion.header === "string" && firstQuestion.header.trim() ? firstQuestion.header : "需要用户回答",
    message: typeof firstQuestion.question === "string" && firstQuestion.question.trim() ? firstQuestion.question : "请继续回答以便完成推理。",
    options,
    allowFreeText: firstQuestion.custom !== false,
    placeholder: "请输入答案"
  };
}

function partIdFromProperties(properties: Record<string, unknown>, part?: Record<string, unknown>) {
  const direct = typeof properties.partID === "string" ? properties.partID : typeof properties.partId === "string" ? properties.partId : undefined;
  if (direct?.trim()) {
    return direct.trim();
  }
  const nestedPart = part ?? (typeof properties.part === "object" && properties.part ? properties.part as Record<string, unknown> : undefined);
  if (!nestedPart) {
    return undefined;
  }
  const nested = typeof nestedPart.id === "string"
    ? nestedPart.id
    : typeof nestedPart.partID === "string"
      ? nestedPart.partID
      : typeof nestedPart.partId === "string"
        ? nestedPart.partId
        : undefined;
  return nested?.trim() || undefined;
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function truncateDisplayText(value: string, limit = 240) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return "";
  }

  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function toDisplayText(value: unknown): string {
  if (typeof value === "string") {
    return truncateDisplayText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return truncateDisplayText(value.map((item) => toDisplayText(item)).filter(Boolean).join(" | "));
  }

  const record = asRecord(value);
  const candidates = [record.message, record.text, record.delta, record.error, record.title, record.description]
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean);
  if (candidates.length) {
    return truncateDisplayText(candidates.join(" | "));
  }

  const status = asRecord(record.status);
  if (typeof status.type === "string" && status.type.trim()) {
    return `status=${status.type.trim()}`;
  }

  const info = asRecord(record.info);
  const infoParts = [
    typeof info.role === "string" && info.role.trim() ? `role=${info.role.trim()}` : "",
    typeof info.id === "string" && info.id.trim() ? `id=${info.id.trim()}` : ""
  ].filter(Boolean);
  if (infoParts.length) {
    return infoParts.join(" | ");
  }

  const serialized = JSON.stringify(value);
  return truncateDisplayText(serialized ?? "");
}

export function createOpencodeRawEventProjector(runId: string): OpencodeRawEventProjector {
  const state = createInitialState();

  const nextEvent = (
    raw: RawRunEventEnvelope,
    type: NormalizedRunEvent["type"],
    message: string,
    options: Omit<NormalizedRunEvent, "id" | "runId" | "type" | "createdAt" | "sequence" | "message"> = {}
  ): NormalizedRunEvent => {
    state.sequence += 1;
    return {
      id: `${runId}-${state.sequence}`,
      runId,
      type,
      createdAt: raw.createdAt,
      sequence: state.sequence,
      message,
      ...options
    };
  };

  const createRawVisibleEvent = (
    raw: RawRunEventEnvelope,
    eventType: string,
    message: string,
    options: Omit<NormalizedRunEvent, "id" | "runId" | "type" | "createdAt" | "sequence" | "message"> = {}
  ) => nextEvent(raw, "tool_call", message, {
    title: options.title ?? eventType,
    data: {
      upstreamEventType: eventType,
      upstreamSource: raw.source,
      rawSequence: raw.sequence,
      ...(typeof options.data === "object" && options.data !== null ? options.data as Record<string, unknown> : {})
    },
    logData: {
      raw
    },
    ...options
  });

  const emitAssistantText = (raw: RawRunEventEnvelope, message: string, messageId?: string, partId?: string, emissionKind: "delta" | "snapshot" | "final" = "delta") => {
    if (!message.trim()) {
      return [] as NormalizedRunEvent[];
    }
    return [nextEvent(raw, "thinking", message, {
      data: responseTextData(messageId),
      semantic: assistantTextSemantic(messageId, emissionKind, partId)
    })];
  };

  const flushBufferedDelta = (raw: RawRunEventEnvelope, partId: string, messageId?: string) => {
    const buffered = state.bufferedPartDeltas[partId];
    delete state.bufferedPartDeltas[partId];
    return [] as NormalizedRunEvent[];
  };

  const buildResultFromMessages = (raw: RawRunEventEnvelope, messages: Record<string, unknown>[]) => {
    if (state.resultEmitted) {
      return [] as NormalizedRunEvent[];
    }
    const assistants = messages.filter((item) => asRecord(item.info).role === "assistant");
    const finalItem = assistants.at(-1);
    if (!finalItem) {
      const fallback = state.lastOutputText.trim() || "opencode serve 已完成但未返回可展示文本。";
      state.resultEmitted = true;
      return [nextEvent(raw, "result", fallback, {
        data: responseTextData(state.assistantMessageId),
        semantic: assistantTextSemantic(state.assistantMessageId, "final")
      })];
    }
    const info = asRecord(finalItem.info);
    const messageId = typeof info.id === "string" ? info.id : state.assistantMessageId;
    const parts = Array.isArray(finalItem.parts) ? finalItem.parts : [];
    const textParts = parts
      .map((part) => asRecord(part))
      .filter((part) => part.type === "text" && typeof part.text === "string" && part.text.trim())
      .map((part) => String(part.text));
    const message = textParts.join("\n").trim() || state.lastOutputText.trim() || "opencode serve 已完成但未返回可展示文本。";
    state.resultEmitted = true;
    return [nextEvent(raw, "result", message, {
      data: responseTextData(messageId),
      semantic: assistantTextSemantic(messageId, "final")
    })];
  };

  const projectOpencodeEvent = (raw: RawRunEventEnvelope) => {
    const globalEvent = asRecord(raw.payload.event);
    const payload = asRecord(globalEvent.payload);
    const properties = asRecord(payload.properties);
    const eventType = typeof payload.type === "string" ? payload.type : raw.eventType;

    if (eventType === "session.status") {
      const status = asRecord(properties.status);
      const statusType = typeof status.type === "string" ? status.type : "unknown";
      const details = statusType === "retry" && status.attempt !== undefined ? `（attempt=${String(status.attempt)}）` : "";
      return [createRawVisibleEvent(raw, eventType, `opencode session 状态更新：${statusType}${details}`, {
        title: `上游事件 ${eventType}`,
        data: { status }
      })];
    }

    if (eventType === "session.idle") {
      return [createRawVisibleEvent(raw, eventType, "opencode session 已进入 idle，准备同步最终消息。", {
        title: "会话空闲",
        data: properties
      })];
    }

    if (eventType === "message.part.delta") {
      const delta = typeof properties.delta === "string" ? properties.delta : "";
      if (!delta) {
        return [createRawVisibleEvent(raw, eventType, "收到空的消息增量。", {
          title: "消息增量",
          data: properties
        })];
      }
      const partId = partIdFromProperties(properties);
      const messageId = typeof properties.messageID === "string" ? properties.messageID : undefined;
      const field = typeof properties.field === "string" ? properties.field : undefined;
      const partType = partId ? state.partTypes[partId] : undefined;
      if (partType === "text") {
        return emitAssistantText(raw, delta, messageId, partId, "delta");
      }
      if (partType === "reasoning") {
        return [nextEvent(raw, "thinking", delta, {
          semantic: reasoningSemantic(messageId, "delta", partId)
        })];
      }
      if (partId) {
        state.bufferedPartDeltas[partId] = { delta, messageId };
      }

      if (!partType && field === "text") {
        return [] as NormalizedRunEvent[];
      }

      return [createRawVisibleEvent(raw, eventType, delta, {
        title: "消息增量",
        data: {
          ...properties,
          pendingPartType: true
        }
      })];
    }

    if (eventType === "message.part.updated") {
      const part = asRecord(properties.part);
      const partType = typeof part.type === "string" ? part.type : undefined;
      const partId = partIdFromProperties(properties, part);
      const messageId = typeof properties.messageID === "string" ? properties.messageID : undefined;
      if (partId && partType) {
        state.partTypes[partId] = partType;
      }
      if (partType === "tool") {
        const toolState = asRecord(part.state);
        const toolName = typeof part.tool === "string" ? part.tool : "unknown";
        const toolStatus = typeof toolState.status === "string" ? toolState.status : "running";
        const callId = typeof part.callID === "string"
          ? part.callID
          : typeof part.callId === "string"
            ? part.callId
            : typeof part.id === "string"
              ? part.id
              : undefined;
        return [nextEvent(raw, "tool_call", simplifyToolCallMessage(toolName, toolStatus, toolState.title ?? part.title), {
          data: { stage: toolStatus },
          logData: { tool: part.tool, state: toolState, part },
          tool: {
            name: toolName || undefined,
            status: toolStatus || undefined,
            title: typeof toolState.title === "string" ? toolState.title : typeof part.title === "string" ? part.title : undefined,
            callId
          },
          semantic: toolSemantic(messageId, "snapshot", { partId, callId, toolName })
        })];
      }
      if (partType === "reasoning") {
        if (partId) {
          flushBufferedDelta(raw, partId, messageId);
        }
        return [nextEvent(raw, "thinking", typeof part.text === "string" && part.text.trim() ? part.text : "模型正在推理。", {
          semantic: reasoningSemantic(messageId, "snapshot", partId)
        })];
      }
      if (partType === "text" && typeof part.text === "string" && part.text.trim()) {
        state.lastOutputText = part.text;
        if (partId) {
          flushBufferedDelta(raw, partId, messageId);
        }
        return emitAssistantText(raw, part.text, messageId, partId, "snapshot");
      }
      return [createRawVisibleEvent(raw, eventType, toDisplayText(part) || `收到 ${partType || "unknown"} part 更新。`, {
        title: `消息片段更新${partType ? ` ${partType}` : ""}`,
        data: {
          ...properties,
          part
        }
      })];
    }

    if (eventType === "message.updated") {
      const info = asRecord(properties.info);
      if (info.role === "assistant") {
        state.assistantMessageId = typeof info.id === "string" ? info.id : state.assistantMessageId;
        if (typeof info.error === "string" && info.error.trim()) {
          return [nextEvent(raw, "error", `opencode session 返回错误：${info.error}`, {
            data: { info }
          })];
        }

        return [] as NormalizedRunEvent[];
      }

      return [createRawVisibleEvent(raw, eventType, toDisplayText(info) || "assistant 消息已更新。", {
        title: "消息更新",
        data: { info }
      })];
    }

    if (eventType === "question.asked") {
      const requestId = typeof properties.id === "string" ? properties.id : undefined;
      if (requestId) {
        state.questionRequests[requestId] = properties;
        state.waitingQuestionId = requestId;
      }
      const normalized = normalizeQuestionRequest(properties);
      return [nextEvent(raw, "question", normalized.message, {
        question: normalized,
        data: { session_id: properties.sessionID }
      })];
    }

    if (eventType === "question.replied") {
      state.waitingQuestionId = null;
      return [createRawVisibleEvent(raw, eventType, "问题已回答，继续等待 opencode 输出。", {
        title: "已提交回答",
        data: properties
      })];
    }

    if (eventType === "session.error") {
      return [nextEvent(raw, "error", `opencode session 错误：${typeof properties.error === "string" && properties.error.trim() ? properties.error : "unknown"}`, {
        data: properties
      })];
    }

    return [createRawVisibleEvent(raw, eventType, toDisplayText(properties) || `收到上游事件 ${eventType}。`, {
      title: `原始事件 ${eventType}`,
      data: properties
    })];
  };

  return {
    project(raw: RawRunEventEnvelope) {
      if (raw.source === "adapter" && raw.eventType === "normalized_event") {
        const event = asRecord(raw.payload.event) as unknown as NormalizedRunEvent;
        if (event && typeof event.id === "string" && typeof event.runId === "string") {
          state.sequence = Math.max(state.sequence, Number.isFinite(event.sequence) ? event.sequence : state.sequence);
          return [event];
        }
      }

      if (raw.source === "adapter" && raw.eventType === "adapter.error") {
        const message = typeof raw.payload.message === "string" ? raw.payload.message : "Unknown adapter error";
        return [nextEvent(raw, "error", message, {
          data: raw.payload
        })];
      }

      if (raw.source === "adapter" && raw.eventType === "session.messages") {
        const messages = Array.isArray(raw.payload.messages)
          ? raw.payload.messages.map((item) => asRecord(item))
          : [];
        return buildResultFromMessages(raw, messages);
      }

      if (raw.source === "opencode") {
        return projectOpencodeEvent(raw);
      }

      return [] as NormalizedRunEvent[];
    }
  };
}