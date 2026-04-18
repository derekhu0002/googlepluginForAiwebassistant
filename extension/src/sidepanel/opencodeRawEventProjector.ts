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
  const normalizedTool = toolName.toLowerCase();
  const normalizedStatus = status.toLowerCase();
  if (normalizedTool.includes("search") || normalizedTool.includes("grep") || normalizedTool.includes("glob")) {
    return "正在检索相关信息。";
  }
  if (normalizedTool.includes("read")) {
    return "正在读取所需内容。";
  }
  if (normalizedTool.includes("write") || normalizedTool.includes("edit") || normalizedTool.includes("patch")) {
    return "正在整理并更新内容。";
  }
  if (normalizedTool.includes("bash") || normalizedTool.includes("command")) {
    return "正在执行必要步骤。";
  }
  if (["completed", "done", "success"].includes(normalizedStatus)) {
    return "当前步骤已完成，正在进入下一步。";
  }
  if (typeof title === "string" && title.trim()) {
    return "正在处理当前分析步骤。";
  }
  return "正在处理当前分析步骤。";
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
    if (!buffered?.delta) {
      return [] as NormalizedRunEvent[];
    }
    const resolvedMessageId = messageId || buffered.messageId;
    const partType = state.partTypes[partId];
    if (partType === "text") {
      return emitAssistantText(raw, buffered.delta, resolvedMessageId, partId, "delta");
    }
    if (partType === "reasoning") {
      return [nextEvent(raw, "thinking", buffered.delta, {
        semantic: reasoningSemantic(resolvedMessageId, "delta", partId)
      })];
    }
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
      return [nextEvent(raw, "tool_call", `opencode session 状态更新：${statusType}${details}`, {
        title: "会话状态",
        data: { status }
      })];
    }

    if (eventType === "message.part.delta") {
      const delta = typeof properties.delta === "string" ? properties.delta : "";
      if (!delta) {
        return [] as NormalizedRunEvent[];
      }
      const partId = partIdFromProperties(properties);
      const messageId = typeof properties.messageID === "string" ? properties.messageID : undefined;
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
      return [] as NormalizedRunEvent[];
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
        const flushed = partId ? flushBufferedDelta(raw, partId, messageId) : [];
        if (flushed.length) {
          return flushed;
        }
        return [nextEvent(raw, "thinking", typeof part.text === "string" && part.text.trim() ? part.text : "模型正在推理。", {
          semantic: reasoningSemantic(messageId, "snapshot", partId)
        })];
      }
      if (partType === "text" && typeof part.text === "string" && part.text.trim()) {
        state.lastOutputText = part.text;
        const flushed = partId ? flushBufferedDelta(raw, partId, messageId) : [];
        if (flushed.length) {
          return flushed;
        }
        return emitAssistantText(raw, part.text, messageId, partId, "snapshot");
      }
      return [] as NormalizedRunEvent[];
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
      }
      return [] as NormalizedRunEvent[];
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
      return [nextEvent(raw, "tool_call", "问题已回答，继续等待 opencode 输出。", {
        title: "已提交回答",
        data: properties
      })];
    }

    if (eventType === "session.error") {
      return [nextEvent(raw, "error", `opencode session 错误：${typeof properties.error === "string" && properties.error.trim() ? properties.error : "unknown"}`, {
        data: properties
      })];
    }

    return [] as NormalizedRunEvent[];
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