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

/** @ArchitectureID: ELM-APP-EXT-REASONING-TIMELINE */
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

export function getTimelineCardStatus(options: {
  type: NormalizedEventType;
  isLast: boolean;
  live: boolean;
  streamStatus?: "idle" | "connecting" | "streaming" | "reconnecting" | "waiting_for_answer" | "done" | "error";
  runStatus?: "streaming" | "waiting_for_answer" | "done" | "error";
}): TimelineCardStatus {
  const { type, isLast, live, streamStatus, runStatus } = options;
  const isWaitingForAnswer = streamStatus === "waiting_for_answer" || runStatus === "waiting_for_answer";

  if (type === "error" || runStatus === "error") {
    return type === "error" || isLast ? "attention" : "complete";
  }

  if (type === "question") {
    return isLast && isWaitingForAnswer ? "waiting" : "complete";
  }

  if (type === "result" || runStatus === "done" || streamStatus === "done") {
    return type === "result" && isLast ? "complete" : "complete";
  }

  if (live && isLast && (streamStatus === "connecting" || streamStatus === "streaming" || streamStatus === "reconnecting")) {
    return "active";
  }

  return "complete";
}

export function getTimelineStatusCopy(runStatus?: "streaming" | "waiting_for_answer" | "done" | "error") {
  switch (runStatus) {
    case "done":
      return "本次推理已完成，已收起为稳定结果视图。";
    case "error":
      return "本次推理已中断，请查看错误卡片了解详情。";
    case "waiting_for_answer":
      return "推理正在等待你的确认后继续。";
    default:
      return "推理过程将持续追加到时间线中。";
  }
}
