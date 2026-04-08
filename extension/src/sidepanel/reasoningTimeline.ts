import type { AnswerRecord, NormalizedEventType, NormalizedRunEvent, QuestionPayload, RunRecord } from "../shared/protocol";

const DEFAULT_EVENT_TITLES: Record<NormalizedEventType, string> = {
  thinking: "分析中",
  tool_call: "处理中",
  question: "需要确认",
  result: "分析结果",
  error: "运行失败"
};

const AGGREGATED_EVENT_TYPES = new Set<NormalizedEventType>(["thinking", "tool_call"]);
const SMALL_EVENT_MESSAGE_LIMIT = 140;
const ORCHESTRATION_NOISE_PATTERNS = [
  /^已创建\s+opencode\s+session/iu,
  /^已连接主分析代理/iu,
  /opencode\s+session\s+状态更新/iu,
  /^opencode\s+session/iu,
  /^正在处理当前分析步骤/iu,
  /^当前步骤已完成，正在进入下一步/iu,
  /^正在整理上下文并准备分析/iu,
  /^正在检索相关信息/iu,
  /^读取页面上下文/iu,
  /^整理可用字段/iu,
  /^查询历史/iu,
  /^调用工具/iu,
  /^逐步展示文本/iu,
  /^connected\s+main\s+agent/iu,
  /^session\s+created/iu,
  /^session\s+status/iu,
  /\bbusy\b/iu,
  /\bstep\b/iu
];
const REASONING_SIGNAL_PATTERNS = [
  /[。！？!?；;]/u,
  /因为|所以|因此|先|再|然后|基于|为了|需要|判断|推断|分析|结论|建议|我会|我先|看起来|可能|可以|接下来/iu
];
const PROCESS_PREFIX_PATTERN = /^(正在|已|当前|读取|整理|查询|检索|调用|连接|创建|收集|准备|同步|进入|更新|完成)/u;

export type TimelineCardStatus = "active" | "complete" | "waiting" | "attention";
export type ConversationTurnKind = "assistant" | "question" | "error";

export interface TimelineEventEntry {
  id: string;
  type: NormalizedEventType;
  createdAt: string;
  message: string;
  title: string;
  data?: Record<string, unknown>;
  logData?: Record<string, unknown>;
  question?: QuestionPayload;
}

export interface TimelineCardModel {
  id: string;
  runId: string;
  type: NormalizedEventType;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  entries: TimelineEventEntry[];
  isAggregated: boolean;
  question?: QuestionPayload;
}

export interface ConversationTurnModel {
  id: string;
  runId: string;
  kind: ConversationTurnKind;
  primaryType: NormalizedEventType;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  processItems: TimelineCardModel[];
  processSummary: string;
  question?: QuestionPayload;
}

export interface ReasoningSectionModel {
  items: TimelineCardModel[];
  summary: string;
}

export type ChatStreamItemKind =
  | "user_prompt"
  | "user_answer"
  | "assistant_progress"
  | "assistant_question"
  | "assistant_result"
  | "assistant_error";

export interface ChatStreamItemModel {
  id: string;
  runId: string;
  kind: ChatStreamItemKind;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  primaryType: NormalizedEventType | "user_prompt" | "user_answer";
  processItems: TimelineCardModel[];
  processSummary: string;
  question?: QuestionPayload;
  answer?: AnswerRecord;
  pendingQuestion?: boolean;
}

export function getEventTitle(event: Pick<NormalizedRunEvent, "type" | "title" | "question">) {
  if (event.question?.title) {
    return event.question.title;
  }

  if (event.title && event.title !== event.type) {
    return event.title;
  }

  return DEFAULT_EVENT_TITLES[event.type];
}

function normalizeMessage(message: string) {
  return message.trim();
}

function isCompactEvent(event: NormalizedRunEvent) {
  return AGGREGATED_EVENT_TYPES.has(event.type) && normalizeMessage(event.message).length <= SMALL_EVENT_MESSAGE_LIMIT;
}

function canAggregate(current: TimelineCardModel | null, event: NormalizedRunEvent) {
  if (!current || !isCompactEvent(event) || !current.entries.length || current.type !== event.type) {
    return false;
  }

  const lastEntry = current.entries[current.entries.length - 1];
  return isCompactEvent({ ...event, message: lastEntry.message }) && current.runId === event.runId;
}

function createTimelineEntry(event: NormalizedRunEvent): TimelineEventEntry {
  return {
    id: event.id,
    type: event.type,
    createdAt: event.createdAt,
    message: normalizeMessage(event.question?.message ?? event.message),
    title: getEventTitle(event),
    data: event.data,
    logData: event.logData,
    question: event.question
  };
}

function summarizeEntries(entries: TimelineEventEntry[]) {
  const uniqueMessages: string[] = [];

  for (const entry of entries) {
    if (!entry.message) {
      continue;
    }

    if (uniqueMessages[uniqueMessages.length - 1] !== entry.message) {
      uniqueMessages.push(entry.message);
    }
  }

  return uniqueMessages.join("\n");
}

function joinUniqueParagraphs(parts: string[]) {
  const uniqueParts: string[] = [];

  for (const part of parts.map((item) => item.trim()).filter(Boolean)) {
    if (uniqueParts[uniqueParts.length - 1] !== part) {
      uniqueParts.push(part);
    }
  }

  return uniqueParts.join("\n\n");
}

function hasReasoningSignals(message: string) {
  return REASONING_SIGNAL_PATTERNS.some((pattern) => pattern.test(message));
}

function isMeaningfulThinkingMessage(message: string) {
  const normalized = normalizeMessage(message).replace(/\s+/gu, " ");

  if (!normalized) {
    return false;
  }

  if (ORCHESTRATION_NOISE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (/^(called\s+|已?调用[:：]?)/iu.test(normalized)) {
    return false;
  }

  if (normalized.length <= 18 && !hasReasoningSignals(normalized)) {
    return false;
  }

  if (PROCESS_PREFIX_PATTERN.test(normalized) && !hasReasoningSignals(normalized)) {
    return false;
  }

  return true;
}

function getVisibleThinkingSummary(item: TimelineCardModel) {
  return joinUniqueParagraphs(item.entries.map((entry) => entry.message).filter(isMeaningfulThinkingMessage));
}

function createAssistantTurn(item: TimelineCardModel, summary: string): ConversationTurnModel {
  return {
    id: item.id,
    runId: item.runId,
    kind: "assistant",
    primaryType: item.type,
    title: "Assistant",
    summary,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    processItems: [],
    processSummary: ""
  };
}

function describeReasoningItem(item: TimelineCardModel) {
  if (item.type === "tool_call") {
    return item.title || DEFAULT_EVENT_TITLES[item.type];
  }

  if (item.type === "thinking") {
    return getVisibleThinkingSummary(item) || item.title || DEFAULT_EVENT_TITLES[item.type];
  }

  return item.summary || item.title || DEFAULT_EVENT_TITLES[item.type];
}

function createReasoningSummary(items: TimelineCardModel[]) {
  const parts = items
    .map((item) => describeReasoningItem(item).trim())
    .filter(Boolean);

  if (!parts.length) {
    return "已记录推理过程";
  }

  return `已记录 ${parts.length} 条推理过程`;
}

function createProgressSummary(items: TimelineCardModel[]) {
  const visibleThinkingCount = items.filter((item) => item.type === "thinking" && getVisibleThinkingSummary(item)).length;
  if (visibleThinkingCount > 0) {
    return visibleThinkingCount === 1 ? "已记录 1 条推理过程" : `已记录 ${visibleThinkingCount} 条推理过程`;
  }

  return "正在生成回答…";
}

function createQuestionSummary(item: TimelineCardModel) {
  return item.question?.message?.trim() || item.summary || item.title || DEFAULT_EVENT_TITLES.question;
}

function sortAnswers(answers: AnswerRecord[]) {
  return [...answers].sort((left, right) => new Date(left.submittedAt).getTime() - new Date(right.submittedAt).getTime());
}

export interface BuildChatStreamItemsOptions {
  runId?: string | null;
  prompt?: string | null;
  events: NormalizedRunEvent[];
  answers?: AnswerRecord[];
  finalOutput?: string | null;
  errorMessage?: string | null;
  status?: RunRecord["status"];
  updatedAt?: string | null;
  pendingQuestionId?: string | null;
}

type TimelineRunStatus = RunRecord["status"];
type TimelineStreamStatus = "idle" | "connecting" | "streaming" | "reconnecting" | "waiting_for_answer" | "done" | "error";

function trimTerminalText(value?: string | null) {
  return value?.trim() || "";
}

export function hasTerminalResultEvidence(options: {
  events: NormalizedRunEvent[];
  finalOutput?: string | null;
}) {
  return options.events.some((event) => event.type === "result") || Boolean(trimTerminalText(options.finalOutput));
}

export function hasTerminalErrorEvidence(options: {
  events: NormalizedRunEvent[];
  errorMessage?: string | null;
}) {
  return options.events.some((event) => event.type === "error") || Boolean(trimTerminalText(options.errorMessage));
}

function resolveTerminalStatus<TStatus extends TimelineRunStatus | TimelineStreamStatus | undefined>(
  status: TStatus,
  options: {
    hasResultEvidence: boolean;
    hasErrorEvidence: boolean;
  }
): TStatus | "streaming" {
  if (status === "done") {
    return options.hasResultEvidence ? status : "streaming";
  }

  if (status === "error") {
    return options.hasErrorEvidence ? status : "streaming";
  }

  return status;
}

export function resolveTimelinePresentationState(options: {
  events: NormalizedRunEvent[];
  runStatus?: TimelineRunStatus;
  streamStatus?: TimelineStreamStatus;
  finalOutput?: string | null;
  errorMessage?: string | null;
}) {
  const hasResultEvidence = hasTerminalResultEvidence(options);
  const hasErrorEvidence = hasTerminalErrorEvidence(options);

  return {
    hasResultEvidence,
    hasErrorEvidence,
    hasTerminalEvidence: hasResultEvidence || hasErrorEvidence,
    runStatus: resolveTerminalStatus(options.runStatus, { hasResultEvidence, hasErrorEvidence }),
    streamStatus: resolveTerminalStatus(options.streamStatus, { hasResultEvidence, hasErrorEvidence })
  };
}

/** @ArchitectureID: ELM-APP-EXT-RUN-CONVERSATION-MAPPER */
export function buildChatStreamItems(options: BuildChatStreamItemsOptions): ChatStreamItemModel[] {
  const streamItems: ChatStreamItemModel[] = [];
  const reasoningItems = buildReasoningTimelineItems(options.events);
  const answersByQuestionId = new Map<string, AnswerRecord[]>();
  const prompt = options.prompt?.trim() || "";
  const finalOutput = options.finalOutput?.trim() || "";
  const errorMessage = options.errorMessage?.trim() || "";
  const fallbackTimestamp = options.updatedAt ?? reasoningItems[reasoningItems.length - 1]?.updatedAt ?? "1970-01-01T00:00:00.000Z";
  const presentationState = resolveTimelinePresentationState({
    events: options.events,
    runStatus: options.status,
    finalOutput,
    errorMessage
  });
  let hasResultItem = false;
  let hasErrorItem = false;
  let pendingProcessItems: TimelineCardModel[] = [];

  for (const answer of sortAnswers(options.answers ?? [])) {
    const bucket = answersByQuestionId.get(answer.questionId) ?? [];
    bucket.push(answer);
    answersByQuestionId.set(answer.questionId, bucket);
  }

  if (prompt) {
    streamItems.push({
      id: `user-prompt-${options.runId ?? "standalone"}`,
      runId: options.runId ?? "standalone-run",
      kind: "user_prompt",
      title: "You",
      summary: prompt,
      createdAt: reasoningItems[0]?.createdAt ?? fallbackTimestamp,
      updatedAt: reasoningItems[0]?.createdAt ?? fallbackTimestamp,
      primaryType: "user_prompt",
      processItems: [],
      processSummary: ""
    });
  }

  for (const item of reasoningItems) {
    if (item.type === "thinking" || item.type === "tool_call") {
      pendingProcessItems.push(item);
      continue;
    }

    if (item.type === "question") {
      streamItems.push({
        id: item.id,
        runId: item.runId,
        kind: "assistant_question",
        title: item.title || "Assistant",
        summary: createQuestionSummary(item),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        primaryType: "question",
        processItems: pendingProcessItems,
        processSummary: createReasoningSummary(pendingProcessItems),
        question: item.question,
        pendingQuestion: item.question?.questionId === options.pendingQuestionId
      });
      pendingProcessItems = [];

      for (const answer of answersByQuestionId.get(item.question?.questionId ?? "") ?? []) {
        streamItems.push({
          id: answer.id,
          runId: item.runId,
          kind: "user_answer",
          title: "You",
          summary: answer.answer,
          createdAt: answer.submittedAt,
          updatedAt: answer.submittedAt,
          primaryType: "user_answer",
          processItems: [],
          processSummary: "",
          answer
        });
      }
      continue;
    }

    if (item.type === "result") {
      hasResultItem = true;
      streamItems.push({
        id: item.id,
        runId: item.runId,
        kind: "assistant_result",
        title: "Assistant",
        summary: item.summary || finalOutput,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        primaryType: "result",
        processItems: pendingProcessItems,
        processSummary: createReasoningSummary(pendingProcessItems)
      });
      pendingProcessItems = [];
      continue;
    }

    hasErrorItem = true;
    streamItems.push({
      id: item.id,
      runId: item.runId,
      kind: "assistant_error",
      title: "Assistant",
      summary: item.summary || errorMessage,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      primaryType: "error",
      processItems: pendingProcessItems,
      processSummary: createReasoningSummary(pendingProcessItems)
    });
    pendingProcessItems = [];
  }

  if (pendingProcessItems.length) {
    streamItems.push({
      id: `assistant-progress-${options.runId ?? "standalone"}-${pendingProcessItems[pendingProcessItems.length - 1]?.id ?? "tail"}`,
      runId: options.runId ?? pendingProcessItems[0]?.runId ?? "standalone-run",
      kind: "assistant_progress",
      title: "Assistant",
      summary: createProgressSummary(pendingProcessItems),
      createdAt: pendingProcessItems[0]?.createdAt ?? options.updatedAt ?? new Date().toISOString(),
      updatedAt: pendingProcessItems[pendingProcessItems.length - 1]?.updatedAt ?? options.updatedAt ?? new Date().toISOString(),
      primaryType: pendingProcessItems[pendingProcessItems.length - 1]?.type ?? "thinking",
      processItems: pendingProcessItems,
      processSummary: createReasoningSummary(pendingProcessItems)
    });
    pendingProcessItems = [];
  }

  if (!hasResultItem && finalOutput) {
    streamItems.push({
      id: `synthetic-result-${options.runId ?? "standalone"}`,
      runId: options.runId ?? "standalone-run",
      kind: "assistant_result",
      title: "Assistant",
      summary: finalOutput,
      createdAt: fallbackTimestamp,
      updatedAt: fallbackTimestamp,
      primaryType: "result",
      processItems: [],
      processSummary: ""
    });
  }

  if (!hasErrorItem && presentationState.runStatus === "error" && errorMessage) {
    streamItems.push({
      id: `synthetic-error-${options.runId ?? "standalone"}`,
      runId: options.runId ?? "standalone-run",
      kind: "assistant_error",
      title: "Assistant",
      summary: errorMessage,
      createdAt: fallbackTimestamp,
      updatedAt: fallbackTimestamp,
      primaryType: "error",
      processItems: [],
      processSummary: ""
    });
  }

  const lastItem = streamItems[streamItems.length - 1] ?? null;
  if (!hasResultItem && !hasErrorItem && (presentationState.runStatus === "streaming" || presentationState.runStatus === "waiting_for_answer")) {
    const alreadyHasPendingQuestion = lastItem?.kind === "assistant_question" && lastItem.pendingQuestion;
    if (!alreadyHasPendingQuestion) {
      const statusSummary = presentationState.runStatus === "waiting_for_answer"
        ? "助手正在等待你的补充信息。"
        : "正在生成回答…";
      streamItems.push({
        id: `synthetic-progress-${options.runId ?? "standalone"}`,
        runId: options.runId ?? lastItem?.runId ?? "standalone-run",
        kind: "assistant_progress",
        title: "Assistant",
        summary: statusSummary,
        createdAt: lastItem?.updatedAt ?? fallbackTimestamp,
        updatedAt: lastItem?.updatedAt ?? fallbackTimestamp,
        primaryType: "thinking",
        processItems: [],
        processSummary: ""
      });
    }
  }

  return streamItems;
}

/** @ArchitectureID: ELM-APP-EXT-RUN-CONVERSATION-MAPPER */
export function buildReasoningTimelineItems(events: NormalizedRunEvent[]): TimelineCardModel[] {
  const items: TimelineCardModel[] = [];

  for (const event of events) {
    const entry = createTimelineEntry(event);
    const current = items[items.length - 1] ?? null;

    if (canAggregate(current, event)) {
      current.entries.push(entry);
      current.updatedAt = entry.createdAt;
      current.summary = summarizeEntries(current.entries);
      current.title = entry.title;
      continue;
    }

    items.push({
      id: event.id,
      runId: event.runId,
      type: event.type,
      title: entry.title,
      summary: entry.message,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
      entries: [entry],
      isAggregated: false,
      question: event.question
    });
  }

  for (const item of items) {
    item.isAggregated = item.entries.length > 1;
  }

  return items;
}

/** @ArchitectureID: ELM-APP-EXT-RUN-CONVERSATION-MAPPER */
export function buildConversationTurns(events: NormalizedRunEvent[]): ConversationTurnModel[] {
  const items = buildReasoningTimelineItems(events);
  const turns: ConversationTurnModel[] = [];
  let currentAssistantTurn: ConversationTurnModel | null = null;
  let currentAssistantTurnVisible = false;

  for (const item of items) {
    if (item.type === "tool_call") {
      if (!currentAssistantTurn) {
        currentAssistantTurn = createAssistantTurn(item, "");
        currentAssistantTurnVisible = false;
      } else {
        currentAssistantTurn.updatedAt = item.updatedAt;
      }
      continue;
    }

    if (item.type === "thinking") {
      const visibleSummary = getVisibleThinkingSummary(item);

      if (!visibleSummary) {
        if (!currentAssistantTurn) {
          currentAssistantTurn = createAssistantTurn(item, "");
          currentAssistantTurnVisible = false;
        } else {
          currentAssistantTurn.updatedAt = item.updatedAt;
        }
        continue;
      }

      if (!currentAssistantTurn) {
        currentAssistantTurn = createAssistantTurn(item, visibleSummary);
        turns.push(currentAssistantTurn);
        currentAssistantTurnVisible = true;
      } else {
        currentAssistantTurn.primaryType = "thinking";
        currentAssistantTurn.summary = joinUniqueParagraphs([currentAssistantTurn.summary, visibleSummary]);
        currentAssistantTurn.updatedAt = item.updatedAt;
        if (!currentAssistantTurnVisible) {
          turns.push(currentAssistantTurn);
          currentAssistantTurnVisible = true;
        }
      }

      continue;
    }

    if (item.type === "result") {
      turns.push(createAssistantTurn(item, item.summary));
      currentAssistantTurn = null;
      currentAssistantTurnVisible = false;
      continue;
    }

    if (item.type === "question") {
      turns.push({
        id: item.id,
        runId: item.runId,
        kind: "question",
        primaryType: "question",
        title: item.title,
        summary: item.summary,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        processItems: [],
        processSummary: "",
        question: item.question
      });
      currentAssistantTurn = null;
      currentAssistantTurnVisible = false;
      continue;
    }

    turns.push({
      id: item.id,
      runId: item.runId,
      kind: "error",
      primaryType: "error",
      title: item.title,
      summary: item.summary,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      processItems: [],
      processSummary: ""
    });
    currentAssistantTurn = null;
    currentAssistantTurnVisible = false;
  }

  if (currentAssistantTurn && !currentAssistantTurnVisible) {
    turns.push(currentAssistantTurn);
  }

  return turns.map((turn) => ({
    ...turn,
    summary: turn.summary || turn.processSummary || ""
  }));
}

/** @ArchitectureID: ELM-APP-EXT-RUN-CONVERSATION-MAPPER */
export function buildReasoningSection(events: NormalizedRunEvent[]): ReasoningSectionModel {
  const items = buildReasoningTimelineItems(events).filter((item) => item.type === "thinking" || item.type === "tool_call");

  return {
    items,
    summary: createReasoningSummary(items)
  };
}

export function getTimelineCardStatus(options: {
  type: NormalizedEventType;
  isLast: boolean;
  live: boolean;
   streamStatus?: TimelineStreamStatus;
   runStatus?: TimelineRunStatus;
}) {
  const { type, isLast, live, streamStatus, runStatus } = options;
  const isWaitingForAnswer = streamStatus === "waiting_for_answer" || runStatus === "waiting_for_answer";

  if (type === "error" || runStatus === "error") {
    return type === "error" || isLast ? "attention" : "complete";
  }

  if (type === "question") {
    return isLast && isWaitingForAnswer ? "waiting" : "complete";
  }

  if (type === "result" || runStatus === "done" || streamStatus === "done") {
    return "complete";
  }

  if (live && isLast && (streamStatus === "connecting" || streamStatus === "streaming" || streamStatus === "reconnecting")) {
    return "active";
  }

  return "complete";
}

export function getTimelineStatusCopy(options: {
  events: NormalizedRunEvent[];
  runStatus?: TimelineRunStatus;
  finalOutput?: string | null;
  errorMessage?: string | null;
}) {
  const { runStatus } = resolveTimelinePresentationState(options);

  switch (runStatus) {
    case "done":
      return "助手已完成本轮回答。";
    case "error":
      return "本轮对话已中断，请查看失败提示。";
    case "waiting_for_answer":
      return "助手正在等待你的补充信息。";
    default:
      return "助手正在继续生成回答，完成后会显示最终结果。";
  }
}
