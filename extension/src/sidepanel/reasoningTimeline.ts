import type { NormalizedEventType, NormalizedRunEvent, QuestionPayload } from "../shared/protocol";

const DEFAULT_EVENT_TITLES: Record<NormalizedEventType, string> = {
  thinking: "分析中",
  tool_call: "处理中",
  question: "需要确认",
  result: "分析结果",
  error: "运行失败"
};

const AGGREGATED_EVENT_TYPES = new Set<NormalizedEventType>(["thinking", "tool_call"]);
const SMALL_EVENT_MESSAGE_LIMIT = 140;

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

function summarizeProcessItems(items: TimelineCardModel[]) {
  if (!items.length) {
    return "";
  }

  const highlights = items
    .map((item) => item.summary.split("\n").find((line) => line.trim()) ?? item.title)
    .map((item) => item.trim())
    .filter(Boolean);
  const uniqueHighlights = Array.from(new Set(highlights));

  if (uniqueHighlights.length <= 2) {
    return uniqueHighlights.join(" · ");
  }

  return `${uniqueHighlights.slice(0, 2).join(" · ")} 等 ${uniqueHighlights.length} 项过程`;
}

function createAssistantTurn(item: TimelineCardModel): ConversationTurnModel {
  return {
    id: item.id,
    runId: item.runId,
    kind: "assistant",
    primaryType: item.type,
    title: "Assistant",
    summary: item.summary,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    processItems: item.type === "result" ? [] : [item],
    processSummary: item.type === "result" ? "" : summarizeProcessItems([item])
  };
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

  for (const item of items) {
    if (item.type === "thinking" || item.type === "tool_call") {
      if (!currentAssistantTurn) {
        currentAssistantTurn = createAssistantTurn(item);
        turns.push(currentAssistantTurn);
      } else {
        currentAssistantTurn.processItems.push(item);
        currentAssistantTurn.updatedAt = item.updatedAt;
      }

      currentAssistantTurn.processSummary = summarizeProcessItems(currentAssistantTurn.processItems);

      if (item.type === "thinking") {
        currentAssistantTurn.summary = joinUniqueParagraphs([currentAssistantTurn.summary, item.summary]);
      }

      continue;
    }

    if (item.type === "result") {
      if (!currentAssistantTurn) {
        currentAssistantTurn = createAssistantTurn(item);
        turns.push(currentAssistantTurn);
      }

      currentAssistantTurn.primaryType = "result";
      currentAssistantTurn.updatedAt = item.updatedAt;
      currentAssistantTurn.summary = item.summary || currentAssistantTurn.summary || currentAssistantTurn.processSummary;
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
      processItems: currentAssistantTurn?.processItems ?? [],
      processSummary: currentAssistantTurn?.processSummary ?? ""
    });
    currentAssistantTurn = null;
  }

  return turns.map((turn) => ({
    ...turn,
    summary: turn.summary || turn.processSummary || (turn.kind === "assistant" ? "正在处理中…" : "")
  }));
}

export function getTimelineCardStatus(options: {
  type: NormalizedEventType;
  isLast: boolean;
  live: boolean;
  streamStatus?: "idle" | "connecting" | "streaming" | "reconnecting" | "waiting_for_answer" | "done" | "error";
  runStatus?: "streaming" | "waiting_for_answer" | "done" | "error";
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

export function getTimelineStatusCopy(runStatus?: "streaming" | "waiting_for_answer" | "done" | "error") {
  switch (runStatus) {
    case "done":
      return "助手已完成本轮回答。";
    case "error":
      return "本轮对话已中断，请查看失败提示。";
    case "waiting_for_answer":
      return "助手正在等待你的补充信息。";
    default:
      return "助手会持续补充回答，并在需要时展示过程。";
  }
}
