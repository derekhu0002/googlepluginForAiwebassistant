import type { AnswerRecord, MessageFeedbackValue, NormalizedEventType, NormalizedRunEvent, QuestionPayload, RunRecord } from "../shared/protocol";
import type { MessageFeedbackUiState } from "../shared/types";

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
const LEAKED_REASONING_PREFIX_PATTERNS = [
  /^assessing task requirements/iu,
  /^seeking clarity/iu,
  /^summarizing\s+/iu,
  /^reviewing\b/iu,
  /^prioritizing\b/iu,
  /^i\s+(need|should|could|will|would|can)\b/iu,
  /^it\s+might\b/iu,
  /^it looks like\b/iu,
  /^there(?:'s|\s+is)\b/iu,
  /^the user\b/iu,
  /^from the context\b/iu,
  /^let'?s\b/iu,
  /^opencode\s+serv(?:e|er)\b/iu,
  /^with\s+[a-z0-9_\- ]+analysis/iu,
  /^first[,.:]?/iu,
  /^second[,.:]?/iu
];
const INLINE_ANSWER_START_PATTERNS = [
  /(?:^|[\s(（\[【])(?:基于当前|对于当前|当前(?!步骤|会话|状态)|当前仓库|综合来看|总结来看|一句话结论|结论是|建议|风险点|下一步|后续建议|可判定为|可以判定为|已具备|前台|后台|测试|发版)/u,
  /(?:^|\n)\d+\.\s/u,
  /(?:^|\n)[#>*-]\s/u
];

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
  semantic?: NormalizedRunEvent["semantic"];
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
  sourceQuestionPrompt?: string;
  supportsCopy: boolean;
  supportsRetry: boolean;
  supportsFeedback: boolean;
  feedbackState?: MessageFeedbackUiState;
}

const GENERIC_STREAMING_COPY = "正在继续…";

export function createIdleFeedbackState(): MessageFeedbackUiState {
  return {
    status: "idle"
  };
}

export function getDefaultFeedbackMessage(status: MessageFeedbackUiState["status"], selected?: MessageFeedbackValue) {
  if (status === "submitted") {
    return selected === "like" ? "已提交点赞" : selected === "dislike" ? "已提交点踩" : "已提交反馈";
  }

  if (status === "error") {
    return "反馈提交失败";
  }

  if (status === "submitting") {
    return "反馈提交中";
  }

  return "";
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

function canMergeThinkingSnapshot(current: TimelineCardModel | null, event: NormalizedRunEvent) {
  if (!current || current.type !== "thinking" || event.type !== "thinking" || current.runId !== event.runId) {
    return false;
  }

  const currentSemanticIdentity = getTimelineCardSemanticIdentity(current);
  const nextSemanticIdentity = getEventSemanticIdentity(event);
  const currentSemanticChannel = getTimelineCardSemanticChannel(current);
  const nextSemanticChannel = getEventSemanticChannel(event);

  if (currentSemanticIdentity && nextSemanticIdentity) {
    return currentSemanticChannel === "reasoning"
      && nextSemanticChannel === "reasoning"
      && currentSemanticIdentity === nextSemanticIdentity;
  }

  const currentSummary = current.summary.trim();
  const nextSummary = normalizeMessage(event.message);
  if (!currentSummary || !nextSummary) {
    return false;
  }

  if (currentSummary === nextSummary) {
    return true;
  }

  const currentComparable = currentSummary.replace(/\s+/gu, " ").trim();
  const nextComparable = nextSummary.replace(/\s+/gu, " ").trim();

  if (nextComparable.includes(currentComparable) || currentComparable.includes(nextComparable)) {
    return true;
  }

  const commonPrefixLength = getCommonPrefixLength(currentComparable, nextComparable);
  const shorterLength = Math.min(currentComparable.length, nextComparable.length);
  return shorterLength > 0 && commonPrefixLength / shorterLength >= 0.75;
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
    question: event.question,
    semantic: event.semantic
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

function hasSubstantialChineseContent(text: string) {
  const matches = text.match(/[\u3400-\u9fff]/gu);
  return (matches?.length ?? 0) >= 8;
}

function countLatinLetters(text: string) {
  return (text.match(/[A-Za-z]/gu)?.length ?? 0);
}

function findInlineAnswerStartIndex(text: string) {
  const normalized = normalizeMarkdownStructure(text).trim();
  if (!normalized || !hasSubstantialChineseContent(normalized)) {
    return -1;
  }

  for (const pattern of INLINE_ANSWER_START_PATTERNS) {
    const match = pattern.exec(normalized);
    const startIndex = match?.index ?? -1;
    if (startIndex < 0) {
      continue;
    }

    const prefix = normalized.slice(0, startIndex).trim();
    const suffix = normalized.slice(startIndex).trim();
    if (!suffix || !hasSubstantialChineseContent(suffix)) {
      continue;
    }

    if (!prefix) {
      return startIndex;
    }

    if (countLatinLetters(prefix) >= 20 || LEAKED_REASONING_PREFIX_PATTERNS.some((candidate) => candidate.test(prefix.toLowerCase()))) {
      return startIndex;
    }
  }

  const firstChineseIndex = normalized.search(/[\u3400-\u9fff]/u);
  if (firstChineseIndex <= 0) {
    return -1;
  }

  const prefix = normalized.slice(0, firstChineseIndex).trim();
  const suffix = normalized.slice(firstChineseIndex).trim();
  if (countLatinLetters(prefix) >= 32 && hasSubstantialChineseContent(suffix)) {
    return firstChineseIndex;
  }

  return -1;
}

function isLikelyLeakedReasoningLine(line: string) {
  const normalized = line.trim();
  if (!normalized) {
    return false;
  }

  return LEAKED_REASONING_PREFIX_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizeMarkdownStructure(text: string) {
  return text
    .replace(/\r\n/gu, "\n")
    .replace(/([^\n])(?=(#{1,6}\s))/gu, "$1\n\n")
    .replace(/([^\n])(?=(\d+\.\s))/gu, "$1\n\n")
    .replace(/\n(?=\d+\.\s)/gu, "\n\n")
    .replace(/([^\n])(?=(-\s))/gu, "$1\n\n")
    .replace(/\n{3,}/gu, "\n\n");
}

function splitMarkdownBlocks(text: string) {
  return text
    .split(/\n{2,}/gu)
    .map((block) => block.trim())
    .filter(Boolean);
}

function getComparableBlockKey(text: string) {
  return text.replace(/\s+/gu, " ").trim();
}

function shouldTreatComparableTextsAsDuplicate(left: string, right: string) {
  if (!left || !right) {
    return false;
  }

  if (left === right || left.includes(right) || right.includes(left)) {
    return true;
  }

  const commonPrefixLength = getCommonPrefixLength(left, right);
  const shorterLength = Math.min(left.length, right.length);
  return shorterLength > 0 && commonPrefixLength / shorterLength >= 0.75;
}

function isLikelyLeakedReasoningBlock(block: string) {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return false;
  }

  return lines.every((line) => isLikelyLeakedReasoningLine(line)) || isLikelyLeakedReasoningLine(lines[0]);
}

function dedupeMarkdownBlocks(blocks: string[]) {
  const uniqueBlocks: string[] = [];

  for (const block of blocks) {
    const comparableKey = getComparableBlockKey(block);
    if (!comparableKey) {
      continue;
    }

    const duplicateIndex = uniqueBlocks.findIndex((candidate) => shouldTreatComparableTextsAsDuplicate(
      getComparableBlockKey(candidate),
      comparableKey
    ));

    if (duplicateIndex < 0) {
      uniqueBlocks.push(block.trim());
      continue;
    }

    const existingComparable = getComparableBlockKey(uniqueBlocks[duplicateIndex] ?? "");
    if (comparableKey.length > existingComparable.length) {
      uniqueBlocks[duplicateIndex] = block.trim();
    }
  }

  return uniqueBlocks;
}

function dedupeProcessItems(items: TimelineCardModel[]) {
  const uniqueItems: TimelineCardModel[] = [];

  for (const item of items) {
    const semanticIdentity = getTimelineCardSemanticIdentity(item);
    if (semanticIdentity) {
      const semanticMatchIndex = uniqueItems.findIndex((candidate) => getTimelineCardSemanticIdentity(candidate) === semanticIdentity);
      if (semanticMatchIndex >= 0) {
        const existingItem = uniqueItems[semanticMatchIndex];
        const existingSummary = getComparableBlockKey(normalizeMarkdownStructure(existingItem.summary));
        const comparableSummary = getComparableBlockKey(normalizeMarkdownStructure(item.summary));
        if (comparableSummary.length >= existingSummary.length) {
          uniqueItems[semanticMatchIndex] = item;
        }
        continue;
      }
    }

    const comparableSummary = getComparableBlockKey(normalizeMarkdownStructure(item.summary));
    if (!comparableSummary) {
      continue;
    }

    const duplicateIndex = uniqueItems.findIndex((candidate) => {
      if (candidate.type !== item.type) {
        return false;
      }

      return shouldTreatComparableTextsAsDuplicate(
        getComparableBlockKey(normalizeMarkdownStructure(candidate.summary)),
        comparableSummary
      );
    });

    if (duplicateIndex < 0) {
      uniqueItems.push(item);
      continue;
    }

    const existingComparable = getComparableBlockKey(normalizeMarkdownStructure(uniqueItems[duplicateIndex]?.summary ?? ""));
    if (comparableSummary.length > existingComparable.length) {
      uniqueItems[duplicateIndex] = item;
    }
  }

  return uniqueItems;
}

function isLikelyOrchestrationNoiseLine(line: string) {
  const normalized = normalizeMessage(line).replace(/\s+/gu, " ");
  if (!normalized) {
    return false;
  }

  if (ORCHESTRATION_NOISE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  return /^模型正在推理[。.]?$/u.test(normalized)
    || /^已连接当前会话/iu.test(normalized)
    || /^已复用当前\s+opencode\s+session/iu.test(normalized)
    || /^已创建\s+opencode\s+session/iu.test(normalized)
    || /^opencode\s+session\s+状态更新[:：]?/iu.test(normalized)
    || /\bsoftware_version=\(empty\)/iu.test(normalized)
    || /\bselected_sr=\(empty\)/iu.test(normalized)
    || /\bbusy\b/iu.test(normalized);
}

function sanitizeAssistantThinkingText(text: string, answerText?: string | null) {
  const normalized = normalizeMarkdownStructure(text).trim();
  if (!normalized) {
    return "";
  }

  const answerBlocks = dedupeMarkdownBlocks(splitMarkdownBlocks(normalizeMarkdownStructure(answerText?.trim() || "")));
  const comparableAnswerBlocks = answerBlocks.map((block) => getComparableBlockKey(block)).filter(Boolean);

  const filteredBlocks = splitMarkdownBlocks(normalized)
    .map((block) => block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !isLikelyOrchestrationNoiseLine(line))
      .join("\n")
      .trim())
    .filter((block) => {
      if (!block) {
        return false;
      }

      const comparableBlock = getComparableBlockKey(block);
      return !comparableAnswerBlocks.some((answerBlock) => answerBlock === comparableBlock || answerBlock.includes(comparableBlock));
    });

  const cleanedThinking = dedupeMarkdownBlocks(filteredBlocks).join("\n\n").trim();
  return subtractAnswerTextFromThinking(cleanedThinking, answerText);
}

function subtractAnswerTextFromThinking(thinkingText: string, answerText?: string | null) {
  const normalizedThinking = normalizeMarkdownStructure(thinkingText).trim();
  const normalizedAnswer = normalizeMarkdownStructure(answerText?.trim() || "").trim();

  if (!normalizedThinking || !normalizedAnswer) {
    return normalizedThinking;
  }

  if (normalizedThinking === normalizedAnswer) {
    return "";
  }

  const directIndex = normalizedThinking.indexOf(normalizedAnswer);
  if (directIndex >= 0) {
    return normalizedThinking.slice(0, directIndex).trim();
  }

  const answerLines = normalizedAnswer
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const firstAnswerLine = answerLines[0];

  if (!firstAnswerLine) {
    return normalizedThinking;
  }

  const thinkingLines = normalizedThinking.split("\n");
  const answerStartIndex = thinkingLines.findIndex((line) => line.trim() === firstAnswerLine);

  if (answerStartIndex >= 0) {
    return thinkingLines.slice(0, answerStartIndex).join("\n").trim();
  }

  const inlineAnswerStartIndex = findInlineAnswerStartIndex(normalizedThinking);
  if (inlineAnswerStartIndex > 0) {
    return normalizedThinking.slice(0, inlineAnswerStartIndex).trim();
  }

  return normalizedThinking;
}

function sanitizeAssistantDisplayText(text: string) {
  const normalized = normalizeMarkdownStructure(text).trim();
  if (!normalized) {
    return "";
  }

  const containsChineseContent = hasSubstantialChineseContent(normalized);
  const dedupedBlocks = dedupeMarkdownBlocks(
    splitMarkdownBlocks(normalized).filter((block) => !(containsChineseContent && isLikelyLeakedReasoningBlock(block)))
  );
  const cleaned = dedupedBlocks.join("\n\n").trim() || normalized;
  const inlineAnswerStartIndex = findInlineAnswerStartIndex(cleaned);

  if (inlineAnswerStartIndex > 0) {
    return cleaned.slice(inlineAnswerStartIndex).trim();
  }

  if (!containsChineseContent) {
    return cleaned;
  }

  const lines = cleaned.split("\n");
  let firstAnswerLineIndex = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      continue;
    }

    if (hasSubstantialChineseContent(line) || /^[#>*-]|^\d+\.\s/u.test(line) || /^(当前|建议|总结|风险|P\d|一句话结论)/u.test(line)) {
      firstAnswerLineIndex = index;
      break;
    }

    if (!isLikelyLeakedReasoningLine(line)) {
      firstAnswerLineIndex = index;
      break;
    }
  }

  const sanitized = lines.slice(firstAnswerLineIndex).join("\n").trim();
  return sanitized || cleaned;
}

function resolveAssistantDisplayText(aggregatedText: string, finalOutput?: string | null) {
  const sanitizedFinalOutput = sanitizeAssistantDisplayText(trimTerminalText(finalOutput));
  const sanitizedAggregatedText = sanitizeAssistantDisplayText(aggregatedText);

  if (!sanitizedFinalOutput) {
    return sanitizedAggregatedText;
  }

  if (!sanitizedAggregatedText) {
    return sanitizedFinalOutput;
  }

  if (sanitizedAggregatedText === sanitizedFinalOutput || sanitizedAggregatedText.includes(sanitizedFinalOutput) || hasSubstantialChineseContent(sanitizedFinalOutput)) {
    return sanitizedFinalOutput;
  }

  return sanitizedAggregatedText;
}

function deriveAssistantDisplayTextFromReasoning(reasoningText: string) {
  const normalizedReasoning = normalizeMarkdownStructure(reasoningText).trim();
  if (!normalizedReasoning) {
    return "";
  }

  const derivedText = sanitizeAssistantDisplayText(normalizedReasoning);
  if (!derivedText) {
    return "";
  }

  const inlineAnswerStartIndex = findInlineAnswerStartIndex(normalizedReasoning);
  if (inlineAnswerStartIndex === 0) {
    return derivedText;
  }

  return derivedText !== normalizedReasoning ? derivedText : "";
}

function collectLatestAssistantResultText(events: NormalizedRunEvent[]) {
  const resultEvents = events.filter((event) => event.type === "result");
  if (!resultEvents.length) {
    return "";
  }

  return sanitizeAssistantDisplayText(resultEvents[resultEvents.length - 1]?.message ?? "");
}

function createSyntheticThinkingItem(options: {
  runId?: string | null;
  preferredMessageId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  summary: string;
}): TimelineCardModel {
  const timestamp = options.updatedAt ?? options.createdAt ?? new Date().toISOString();
  const id = `synthetic-thinking-${options.preferredMessageId ?? options.runId ?? "standalone"}`;

  return {
    id,
    runId: options.runId ?? "standalone-run",
    type: "thinking",
    title: "Thinking",
    summary: options.summary,
    createdAt: options.createdAt ?? timestamp,
    updatedAt: timestamp,
    entries: [
      {
        id,
        type: "thinking",
        createdAt: options.createdAt ?? timestamp,
        message: options.summary,
        title: "Thinking"
      }
    ],
    isAggregated: false
  };
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
  feedbackByMessageId?: Record<string, MessageFeedbackUiState>;
  finalOutput?: string | null;
  errorMessage?: string | null;
  status?: RunRecord["status"];
  updatedAt?: string | null;
  pendingQuestionId?: string | null;
}

export interface AssistantResponseAggregation {
  text: string;
  firstResponseAt: string | null;
  lastResponseAt: string | null;
  preferredMessageId: string | null;
  hasResponseEvent: boolean;
}

export type TimelineAssistantStatus = "idle" | "collecting" | "streaming" | "waiting_for_answer" | "done" | "error";
type TimelineRunStatus = RunRecord["status"];
type TimelineStreamStatus = "idle" | "connecting" | "streaming" | "reconnecting" | "waiting_for_answer" | "done" | "error";

export interface CockpitStatusModel {
  stageKey: "ready" | "collecting" | "connecting" | "working" | "awaiting_input" | "completed" | "error";
  stageLabel: string;
  modeLabel: string;
  headline: string;
  detail: string;
  tone: "neutral" | "progress" | "warning" | "success" | "danger";
}

function trimTerminalText(value?: string | null) {
  return value?.trim() || "";
}

function getEventDataValue(event: Pick<NormalizedRunEvent, "data">, key: string) {
  return typeof event.data?.[key] === "string" ? event.data[key] as string : undefined;
}

function getEventSemanticIdentity(event: Pick<NormalizedRunEvent, "semantic">) {
  return event.semantic?.identity?.trim() || undefined;
}

function getEventSemanticChannel(event: Pick<NormalizedRunEvent, "semantic">) {
  return event.semantic?.channel;
}

function getTimelineCardSemanticIdentity(item: Pick<TimelineCardModel, "entries">) {
  return item.entries
    .map((entry) => entry.semantic?.identity?.trim() || undefined)
    .find(Boolean);
}

function getTimelineCardSemanticChannel(item: Pick<TimelineCardModel, "entries">) {
  return item.entries
    .map((entry) => entry.semantic?.channel)
    .find(Boolean);
}

function getAssistantResponseMessageId(event: Pick<NormalizedRunEvent, "id" | "data" | "semantic">) {
  return event.semantic?.messageId?.trim() || getEventDataValue(event, "message_id") || event.id;
}

export function isAssistantResponseDeltaEvent(event: NormalizedRunEvent) {
  if (event.type !== "thinking") {
    return false;
  }

  if (getEventSemanticChannel(event) === "assistant_text") {
    return true;
  }

  return getEventDataValue(event, "field") === "text";
}

function getAssistantResponseThinkingEmissionKind(event: NormalizedRunEvent) {
  if (!isAssistantResponseDeltaEvent(event)) {
    return undefined;
  }

  return event.semantic?.emissionKind === "snapshot" ? "snapshot" : "delta";
}

export function isAssistantResponseSnapshotEvent(event: NormalizedRunEvent) {
  return event.type === "result";
}

function getTextOverlapLength(left: string, right: string) {
  const maxOverlap = Math.min(left.length, right.length);

  for (let size = maxOverlap; size > 0; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) {
      return size;
    }
  }

  return 0;
}

function getCommonPrefixLength(left: string, right: string) {
  const maxPrefix = Math.min(left.length, right.length);

  for (let index = 0; index < maxPrefix; index += 1) {
    if (left[index] !== right[index]) {
      return index;
    }
  }

  return maxPrefix;
}

function mergeAssistantResponseDelta(current: string, delta: string) {
  const next = delta;
  if (!next.trim()) {
    return current;
  }

  if (!current.trim()) {
    return next;
  }

  const existing = current;
  const existingComparable = existing.trimEnd();
  const nextComparable = next.trimEnd();

  if (existing === next || existing.endsWith(next)) {
    return existing;
  }

  if (next.startsWith(existing)) {
    return next;
  }

  if (existing.startsWith(next)) {
    return existing;
  }

  if (existingComparable === nextComparable || existingComparable.endsWith(nextComparable)) {
    return existing;
  }

  if (nextComparable.startsWith(existingComparable)) {
    return next;
  }

  if (existingComparable.startsWith(nextComparable)) {
    return existing;
  }

  const overlap = getTextOverlapLength(existing, next);
  if (overlap > 0) {
    return `${existing}${next.slice(overlap)}`;
  }

  const commonPrefixLength = getCommonPrefixLength(existingComparable, nextComparable);
  const shorterLength = Math.min(existingComparable.length, nextComparable.length);
  if (shorterLength > 0 && commonPrefixLength / shorterLength >= 0.75) {
    return existing.length >= next.length ? existing : next;
  }

  return `${existing}${next}`;
}

function mergeAssistantResponseSnapshot(current: string, snapshot: string) {
  const next = snapshot;
  if (!next.trim()) {
    return current;
  }

  if (!current.trim()) {
    return next;
  }

  const existing = current;
  const existingComparable = existing.trimEnd();
  const nextComparable = next.trimEnd();

  if (existing === next || existing.endsWith(next)) {
    return existing;
  }

  if (next.startsWith(existing) || nextComparable.startsWith(existingComparable)) {
    return next;
  }

  if (next.includes(existing) || nextComparable.includes(existingComparable)) {
    return next;
  }

  if (existing.includes(next) || existingComparable.includes(nextComparable)) {
    return existing;
  }

  const commonPrefixLength = getCommonPrefixLength(existingComparable, nextComparable);
  const shorterLength = Math.min(existingComparable.length, nextComparable.length);
  if (shorterLength > 0 && commonPrefixLength / shorterLength >= 0.75) {
    return existing.length >= next.length ? existing : next;
  }

  const overlap = getTextOverlapLength(existing, next);
  if (overlap > 0) {
    return `${existing}${next.slice(overlap)}`;
  }

  return joinUniqueParagraphs([existingComparable, nextComparable]);
}

/** @ArchitectureID: REQ-AIASSIST-UI-CHAT-SEND-DECOUPLE-AND-COMPLETE-RESPONSE-RENDER */
export function collectAssistantResponseAggregation(events: NormalizedRunEvent[], finalOutput?: string | null): AssistantResponseAggregation {
  let aggregatedText = "";
  let firstResponseAt: string | null = null;
  let lastResponseAt: string | null = null;
  let preferredMessageId: string | null = null;
  let hasResponseEvent = false;

  for (const event of events) {
    const thinkingEmissionKind = getAssistantResponseThinkingEmissionKind(event);
    if (thinkingEmissionKind) {
      aggregatedText = thinkingEmissionKind === "snapshot"
        ? mergeAssistantResponseSnapshot(aggregatedText, event.message)
        : mergeAssistantResponseDelta(aggregatedText, event.message);
      firstResponseAt = firstResponseAt ?? event.createdAt;
      lastResponseAt = event.createdAt;
      preferredMessageId = preferredMessageId ?? getAssistantResponseMessageId(event);
      hasResponseEvent = true;
      continue;
    }

    if (isAssistantResponseSnapshotEvent(event)) {
      aggregatedText = mergeAssistantResponseSnapshot(aggregatedText, event.message);
      firstResponseAt = firstResponseAt ?? event.createdAt;
      lastResponseAt = event.createdAt;
      preferredMessageId = preferredMessageId ?? getAssistantResponseMessageId(event);
      hasResponseEvent = true;
    }
  }

  if (finalOutput?.trim()) {
    aggregatedText = mergeAssistantResponseSnapshot(aggregatedText, finalOutput);
  }

  return {
    text: aggregatedText.trim(),
    firstResponseAt,
    lastResponseAt,
    preferredMessageId,
    hasResponseEvent
  };
}

export function collectRunAssistantResponseText(events: NormalizedRunEvent[], finalOutput?: string | null) {
  return resolveAssistantDisplayText(collectAssistantResponseAggregation(events, finalOutput).text, finalOutput);
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
export function resolveCockpitStatusModel(options: {
  events: NormalizedRunEvent[];
  assistantStatus?: TimelineAssistantStatus;
  runStatus?: TimelineRunStatus;
  streamStatus?: TimelineStreamStatus;
  pendingQuestionId?: string | null;
  finalOutput?: string | null;
  errorMessage?: string | null;
}): CockpitStatusModel {
  const presentationState = resolveTimelinePresentationState(options);
  const hasEvents = options.events.length > 0;
  const waitingForInput = Boolean(options.pendingQuestionId)
    || options.assistantStatus === "waiting_for_answer"
    || presentationState.runStatus === "waiting_for_answer"
    || presentationState.streamStatus === "waiting_for_answer";

  if (options.assistantStatus === "error" || presentationState.runStatus === "error" || presentationState.streamStatus === "error") {
    return {
      stageKey: "error",
      stageLabel: "异常中断",
      modeLabel: "重试处理",
      headline: "本轮会话已中断，请查看失败提示后决定是否重试。",
      detail: "已保留当前 run 的历史记录、追问链路和重试入口。",
      tone: "danger"
    };
  }

  if (waitingForInput) {
    return {
      stageKey: "awaiting_input",
      stageLabel: "等待补充",
      modeLabel: "追问补充",
      headline: "助手已暂停当前轮次，等待你补充必要信息后继续。",
      detail: "问题上下文和当前 run 会被原样保留，不会修改 backend/protocol 语义。",
      tone: "warning"
    };
  }

  if (options.assistantStatus === "collecting") {
    return {
      stageKey: "collecting",
      stageLabel: "采集上下文",
      modeLabel: "页面刷新",
      headline: "正在刷新页面字段、命中规则和域名授权可用性。",
      detail: "这是保守的前端采集阶段表达，不会改变现有 run/status 协议。",
      tone: "progress"
    };
  }

  if (presentationState.runStatus === "done") {
    return {
      stageKey: "completed",
      stageLabel: "结果已就绪",
      modeLabel: "结构化阅读",
      headline: "最终回答已经落定，可继续阅读、复制、反馈或同会话追问。",
      detail: presentationState.hasTerminalEvidence
        ? "阶段只在存在结果或错误证据时进入完成态。"
        : "当前仍按运行中保守处理。",
      tone: "success"
    };
  }

  if (presentationState.streamStatus === "connecting" || presentationState.streamStatus === "reconnecting") {
    return {
      stageKey: "connecting",
      stageLabel: "建立连接",
      modeLabel: presentationState.streamStatus === "reconnecting" ? "恢复流连接" : "启动运行",
      headline: "正在连接或恢复事件流，稍后会继续展示新的推理与回答。",
      detail: "连接状态会在保持当前会话上下文的前提下保守映射。",
      tone: "progress"
    };
  }

  if (options.assistantStatus === "streaming" || presentationState.runStatus === "streaming" || hasEvents) {
    return {
      stageKey: "working",
      stageLabel: "生成回答",
      modeLabel: "工作台运行",
      headline: "助手正在结合页面上下文、规则和历史会话生成本轮回答。",
      detail: hasEvents ? `已累计 ${options.events.length} 条运行事件，主舞台会持续流式刷新。` : "运行已启动，等待第一批事件进入主舞台。",
      tone: "progress"
    };
  }

  return {
    stageKey: "ready",
    stageLabel: "待开始",
    modeLabel: "新会话",
    headline: "可以开始新的分析，或在同一会话里继续追问当前页面。",
    detail: "发送消息后，主舞台会切换为对话式 AI working cockpit。",
    tone: "neutral"
  };
}

/** @ArchitectureID: ELM-APP-EXT-RUN-CONVERSATION-MAPPER */
/** @ArchitectureID: REQ-AIASSIST-UI-CHAT-SEND-DECOUPLE-AND-COMPLETE-RESPONSE-RENDER */
export function buildChatStreamItems(options: BuildChatStreamItemsOptions): ChatStreamItemModel[] {
  const streamItems: ChatStreamItemModel[] = [];
  const assistantResponse = collectAssistantResponseAggregation(options.events, options.finalOutput);
  const latestResultText = collectLatestAssistantResultText(options.events);
  const reasoningItems = buildReasoningTimelineItems(options.events.filter((event) => !isAssistantResponseDeltaEvent(event)));
  const reasoningOnlyText = joinUniqueParagraphs(
    reasoningItems
      .filter((item) => item.type === "thinking")
      .map((item) => item.summary)
  );
  const assistantDisplayText = resolveAssistantDisplayText(assistantResponse.text, options.finalOutput)
    || latestResultText
    || deriveAssistantDisplayTextFromReasoning(reasoningOnlyText);
  const answersByQuestionId = new Map<string, AnswerRecord[]>();
  const prompt = options.prompt?.trim() || "";
  const errorMessage = options.errorMessage?.trim() || "";
  const fallbackTimestamp = options.updatedAt ?? reasoningItems[reasoningItems.length - 1]?.updatedAt ?? "1970-01-01T00:00:00.000Z";
  const presentationState = resolveTimelinePresentationState({
    events: options.events,
    runStatus: options.status,
    finalOutput: assistantDisplayText,
    errorMessage
  });
  const hasResultEvent = options.events.some((event) => event.type === "result");
  const hasConcreteAnswer = Boolean(assistantDisplayText);
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
      processSummary: "",
      sourceQuestionPrompt: prompt,
      supportsCopy: true,
      supportsRetry: false,
      supportsFeedback: false
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
        pendingQuestion: item.question?.questionId === options.pendingQuestionId,
      sourceQuestionPrompt: prompt,
      supportsCopy: true,
      supportsRetry: true,
      supportsFeedback: true,
      feedbackState: options.feedbackByMessageId?.[item.id] ?? createIdleFeedbackState()
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
        answer,
        supportsCopy: true,
        supportsRetry: false,
        supportsFeedback: false
      });
      }
      continue;
    }

    if (item.type === "result") {
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
      processSummary: createReasoningSummary(pendingProcessItems),
      sourceQuestionPrompt: prompt,
      supportsCopy: true,
      supportsRetry: true,
      supportsFeedback: false
    });
    pendingProcessItems = [];
  }

  const normalizedAssistantProcessItems = pendingProcessItems
    .map((item) => {
      if (item.type !== "thinking") {
        return item;
      }

      const trimmedSummary = sanitizeAssistantThinkingText(item.summary, assistantDisplayText);
      if (!trimmedSummary) {
        return null;
      }

      return {
        ...item,
        summary: trimmedSummary,
        entries: item.entries.map((entry) => ({
          ...entry,
          message: trimmedSummary
        }))
      };
    })
    .filter((item): item is TimelineCardModel => Boolean(item));

  const syntheticThinkingSummary = sanitizeAssistantThinkingText(assistantResponse.text, assistantDisplayText);
  if (syntheticThinkingSummary) {
    normalizedAssistantProcessItems.push(createSyntheticThinkingItem({
      runId: options.runId,
      preferredMessageId: assistantResponse.preferredMessageId,
      createdAt: assistantResponse.firstResponseAt,
      updatedAt: assistantResponse.lastResponseAt,
      summary: syntheticThinkingSummary
    }));
  }

  const assistantProcessItems = dedupeProcessItems(normalizedAssistantProcessItems);
  const allowVisibleThinkingInAssistantBubble = Boolean(assistantDisplayText)
    && !hasResultEvent
    && presentationState.runStatus === "streaming";

  const visibleAssistantProcessItems = assistantProcessItems
    .map((item) => {
      if (item.type !== "thinking") {
        return item;
      }

      const visibleSummary = getVisibleThinkingSummary(item);
      if (!visibleSummary) {
        return null;
      }

      if (hasSubstantialChineseContent(visibleSummary) && !allowVisibleThinkingInAssistantBubble) {
        return null;
      }

      return {
        ...item,
        summary: visibleSummary,
        entries: item.entries.map((entry) => ({
          ...entry,
          message: visibleSummary
        }))
      };
    })
    .filter((item): item is TimelineCardModel => Boolean(item));

  const shouldRenderProcessOnlyAssistantItem = !assistantDisplayText
    && visibleAssistantProcessItems.length > 0
    && visibleAssistantProcessItems.every((item) => !hasSubstantialChineseContent(item.summary));

  const shouldRenderGenericStreamingItem = !assistantDisplayText
    && !hasErrorItem
    && presentationState.runStatus === "streaming";

  if (assistantDisplayText || shouldRenderProcessOnlyAssistantItem || shouldRenderGenericStreamingItem) {
    const shouldRenderAsFinalResult = hasResultEvent || presentationState.runStatus === "done";
    const assistantMessageSummary = hasConcreteAnswer ? assistantDisplayText : GENERIC_STREAMING_COPY;
    streamItems.push({
      id: assistantResponse.preferredMessageId ?? `synthetic-result-${options.runId ?? "standalone"}`,
      runId: options.runId ?? visibleAssistantProcessItems[0]?.runId ?? "standalone-run",
      kind: shouldRenderAsFinalResult ? "assistant_result" : "assistant_progress",
      title: "Assistant",
      summary: assistantMessageSummary,
      createdAt: assistantResponse.firstResponseAt ?? visibleAssistantProcessItems[0]?.createdAt ?? options.updatedAt ?? new Date().toISOString(),
      updatedAt: assistantResponse.lastResponseAt ?? visibleAssistantProcessItems[visibleAssistantProcessItems.length - 1]?.updatedAt ?? options.updatedAt ?? new Date().toISOString(),
      primaryType: shouldRenderAsFinalResult ? "result" : visibleAssistantProcessItems[visibleAssistantProcessItems.length - 1]?.type ?? "thinking",
      processItems: visibleAssistantProcessItems,
      processSummary: createReasoningSummary(visibleAssistantProcessItems),
      sourceQuestionPrompt: prompt,
      supportsCopy: Boolean(assistantMessageSummary),
      supportsRetry: shouldRenderAsFinalResult,
      supportsFeedback: shouldRenderAsFinalResult,
      feedbackState: shouldRenderAsFinalResult
        ? options.feedbackByMessageId?.[assistantResponse.preferredMessageId ?? `synthetic-result-${options.runId ?? "standalone"}`] ?? createIdleFeedbackState()
        : undefined
    });
    pendingProcessItems = [];
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
      processSummary: "",
      sourceQuestionPrompt: prompt,
      supportsCopy: true,
      supportsRetry: true,
      supportsFeedback: false
    });
  }

  return streamItems;
}

/** @ArchitectureID: ELM-APP-EXT-RUN-CONVERSATION-MAPPER */
export function buildReasoningTimelineItems(events: NormalizedRunEvent[]): TimelineCardModel[] {
  const items: TimelineCardModel[] = [];

  for (const event of events) {
    const entry = createTimelineEntry(event);
    const current = items[items.length - 1] ?? null;

    if (canMergeThinkingSnapshot(current, event)) {
      current.updatedAt = entry.createdAt;
      current.summary = mergeAssistantResponseSnapshot(current.summary, entry.message);
      current.title = entry.title;
      current.entries = [{
        ...entry,
        message: current.summary
      }];
      continue;
    }

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
      return "助手仍在处理中，完成后会显示最终结果。";
  }
}
