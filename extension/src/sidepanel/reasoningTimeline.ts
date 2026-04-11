import type { AnswerRecord, MessageFeedbackValue, NormalizedEventType, NormalizedRunEvent, QuestionPayload, RunRecord } from "../shared/protocol";
import type { MessageFeedbackUiState } from "../shared/types";

const DEFAULT_EVENT_TITLES: Record<NormalizedEventType, string> = {
  thinking: "分析中",
  tool_call: "处理中",
  question: "需要确认",
  result: "分析结果",
  error: "运行失败"
};

const SMALL_EVENT_MESSAGE_LIMIT = 140;
const AGGREGATED_EVENT_TYPES = new Set<NormalizedEventType>(["thinking", "tool_call"]);
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
const GENERIC_STREAMING_COPY = "正在继续…";

export type TimelineCardStatus = "active" | "complete" | "waiting" | "attention";
export type ConversationTurnKind = "assistant" | "question" | "error";
export type FragmentBadgeTone = "neutral" | "progress" | "warning" | "danger" | "success";
export type ChatStreamItemKind =
  | "user_prompt"
  | "user_answer"
  | "assistant_output"
  | "assistant_process"
  | "assistant_question"
  | "assistant_error";

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

export interface FragmentBadgeModel {
  label: string;
  tone: FragmentBadgeTone;
}

export interface ChatStreamItemModel {
  id: string;
  anchorId: string;
  groupAnchorId: string;
  runId: string;
  kind: ChatStreamItemKind;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  primaryType: NormalizedEventType | "user_prompt" | "user_answer";
  badges: FragmentBadgeModel[];
  originEventTypes: NormalizedEventType[];
  question?: QuestionPayload;
  answer?: AnswerRecord;
  pendingQuestion?: boolean;
  sourceQuestionPrompt?: string;
  supportsCopy: boolean;
  supportsRetry: boolean;
  supportsFeedback: boolean;
  feedbackState?: MessageFeedbackUiState;
}

export type TranscriptMessageRole = "user" | "assistant";
export type TranscriptPartKind = "prompt" | "answer" | "text" | "reasoning" | "tool" | "question" | "error" | "summary";

export interface TranscriptPartModel {
  id: string;
  kind: TranscriptPartKind;
  role: TranscriptMessageRole;
  runId: string;
  text: string;
  detail?: string;
  tone?: FragmentBadgeTone;
  createdAt: string;
  updatedAt: string;
  anchorId: string;
  groupAnchorId: string;
  originEventTypes: NormalizedEventType[];
  badges: FragmentBadgeModel[];
  question?: QuestionPayload;
  answer?: AnswerRecord;
  pendingQuestion?: boolean;
  sourceQuestionPrompt?: string;
  supportsCopy: boolean;
  supportsRetry: boolean;
  supportsFeedback: boolean;
  feedbackState?: MessageFeedbackUiState;
  actionAnchorId?: string;
}

export interface TranscriptMessageModel {
  id: string;
  runId: string;
  role: TranscriptMessageRole;
  createdAt: string;
  updatedAt: string;
  anchorId: string;
  groupAnchorId: string;
  parts: TranscriptPartModel[];
  sourceQuestionPrompt?: string;
  supportsCopy: boolean;
  supportsRetry: boolean;
  supportsFeedback: boolean;
  feedbackState?: MessageFeedbackUiState;
  actionAnchorId?: string;
}

export interface TranscriptSummaryModel {
  label: string;
  detail: string;
  tone: FragmentBadgeTone;
  runId?: string | null;
  updatedAt?: string | null;
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
  includeToolCallParts?: boolean;
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

export function createIdleFeedbackState(): MessageFeedbackUiState {
  return { status: "idle" };
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
  return item.entries.map((entry) => entry.semantic?.identity?.trim() || undefined).find(Boolean);
}

function getTimelineCardSemanticChannel(item: Pick<TimelineCardModel, "entries">) {
  return item.entries.map((entry) => entry.semantic?.channel).find(Boolean);
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
  return text.split(/\n{2,}/gu).map((block) => block.trim()).filter(Boolean);
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

function dedupeMarkdownBlocks(blocks: string[]) {
  const uniqueBlocks: string[] = [];

  for (const block of blocks) {
    const comparableKey = getComparableBlockKey(block);
    if (!comparableKey) {
      continue;
    }

    const duplicateIndex = uniqueBlocks.findIndex((candidate) => shouldTreatComparableTextsAsDuplicate(getComparableBlockKey(candidate), comparableKey));
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

function isLikelyLeakedReasoningBlock(block: string) {
  const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    return false;
  }

  return lines.every((line) => isLikelyLeakedReasoningLine(line)) || isLikelyLeakedReasoningLine(lines[0]);
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

  const answerLines = normalizedAnswer.split("\n").map((line) => line.trim()).filter(Boolean);
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
  const dedupedBlocks = dedupeMarkdownBlocks(splitMarkdownBlocks(normalized).filter((block) => !(containsChineseContent && isLikelyLeakedReasoningBlock(block))));
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

function resolveAssistantDisplayText(
  aggregatedText: string,
  finalOutput?: string | null,
  status?: RunRecord["status"]
) {
  const sanitizedFinalOutput = sanitizeAssistantDisplayText(trimTerminalText(finalOutput));
  const sanitizedAggregatedText = sanitizeAssistantDisplayText(aggregatedText);

  if (!sanitizedFinalOutput) {
    return sanitizedAggregatedText;
  }

  if (!sanitizedAggregatedText) {
    return status === "done" ? sanitizedFinalOutput : "";
  }

  if (status !== "done") {
    return sanitizedAggregatedText;
  }

  if (
    sanitizedAggregatedText === sanitizedFinalOutput
    || sanitizedAggregatedText.includes(sanitizedFinalOutput)
  ) {
    return sanitizedAggregatedText;
  }

  if (sanitizedFinalOutput.includes(sanitizedAggregatedText)) {
    return sanitizedFinalOutput;
  }

  return sanitizedAggregatedText;
}

function deriveVisibleAssistantSegmentText(fullText: string, baselineText: string) {
  if (!fullText.trim()) {
    return "";
  }

  if (!baselineText.trim()) {
    return fullText;
  }

  if (fullText === baselineText) {
    return "";
  }

  if (fullText.startsWith(baselineText)) {
    return fullText.slice(baselineText.length).trimStart();
  }

  const overlap = getTextOverlapLength(baselineText, fullText);
  if (overlap > 0 && overlap < fullText.length) {
    return fullText.slice(overlap).trimStart();
  }

  const commonPrefixLength = getCommonPrefixLength(baselineText, fullText);
  const shorterLength = Math.min(baselineText.length, fullText.length);
  if (shorterLength > 0 && commonPrefixLength / shorterLength >= 0.75 && commonPrefixLength < fullText.length) {
    return fullText.slice(commonPrefixLength).trimStart();
  }

  return fullText;
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

export function buildReasoningTimelineItems(events: NormalizedRunEvent[]): TimelineCardModel[] {
  const items: TimelineCardModel[] = [];

  for (const event of events) {
    const entry = createTimelineEntry(event);
    const current = items[items.length - 1] ?? null;

    if (canMergeThinkingSnapshot(current, event)) {
      current.updatedAt = entry.createdAt;
      current.summary = mergeAssistantResponseSnapshot(current.summary, entry.message);
      current.title = entry.title;
      current.entries = [{ ...entry, message: current.summary }];
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

function createReasoningSummary(items: TimelineCardModel[]) {
  const parts = items.map((item) => item.summary.trim()).filter(Boolean);
  if (!parts.length) {
    return "已记录推理过程";
  }

  return `已记录 ${parts.length} 条推理过程`;
}

function sortAnswers(answers: AnswerRecord[]) {
  return [...answers].sort((left, right) => new Date(left.submittedAt).getTime() - new Date(right.submittedAt).getTime());
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
  return resolveAssistantDisplayText(collectAssistantResponseAggregation(events, finalOutput).text, finalOutput, finalOutput?.trim() ? "done" : undefined);
}

export function hasTerminalResultEvidence(options: { events: NormalizedRunEvent[]; finalOutput?: string | null; }) {
  return options.events.some((event) => event.type === "result") || Boolean(trimTerminalText(options.finalOutput));
}

export function hasTerminalErrorEvidence(options: { events: NormalizedRunEvent[]; errorMessage?: string | null; }) {
  return options.events.some((event) => event.type === "error") || Boolean(trimTerminalText(options.errorMessage));
}

function resolveTerminalStatus<TStatus extends TimelineRunStatus | TimelineStreamStatus | undefined>(
  status: TStatus,
  options: { hasResultEvidence: boolean; hasErrorEvidence: boolean; }
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
      detail: presentationState.hasTerminalEvidence ? "阶段只在存在结果或错误证据时进入完成态。" : "当前仍按运行中保守处理。",
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

function createBadge(label: string, tone: FragmentBadgeTone): FragmentBadgeModel {
  return { label, tone };
}

function getProcessBadge(primaryType: NormalizedEventType) {
  if (primaryType === "tool_call") {
    return [createBadge("工具", "progress")];
  }

  return [createBadge("分析", "neutral")];
}

function getQuestionBadges(pending: boolean) {
  return [createBadge("需要确认", pending ? "warning" : "neutral")];
}

function getErrorBadges() {
  return [createBadge("运行失败", "danger")];
}

function getAssistantOutputBadges(options: { terminal: boolean; hasResultEvent: boolean; hasStreamingText: boolean; }) {
  if (options.terminal && options.hasResultEvent) {
    return [createBadge("输出", "success")];
  }

  if (options.hasStreamingText) {
    return [createBadge("流式输出", "progress")];
  }

  return [createBadge("处理中", "neutral")];
}

function createBaseItem(options: {
  id: string;
  anchorId?: string;
  groupAnchorId?: string;
  runId: string;
  kind: ChatStreamItemKind;
  title: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  primaryType: ChatStreamItemModel["primaryType"];
  badges?: FragmentBadgeModel[];
  originEventTypes?: NormalizedEventType[];
  question?: QuestionPayload;
  answer?: AnswerRecord;
  pendingQuestion?: boolean;
  sourceQuestionPrompt?: string;
  supportsCopy?: boolean;
  supportsRetry?: boolean;
  supportsFeedback?: boolean;
  feedbackState?: MessageFeedbackUiState;
}): ChatStreamItemModel {
  return {
    id: options.id,
    anchorId: options.anchorId ?? options.id,
    groupAnchorId: options.groupAnchorId ?? options.id,
    runId: options.runId,
    kind: options.kind,
    title: options.title,
    summary: options.summary,
    createdAt: options.createdAt,
    updatedAt: options.updatedAt,
    primaryType: options.primaryType,
    badges: options.badges ?? [],
    originEventTypes: options.originEventTypes ?? [],
    question: options.question,
    answer: options.answer,
    pendingQuestion: options.pendingQuestion,
    sourceQuestionPrompt: options.sourceQuestionPrompt,
    supportsCopy: options.supportsCopy ?? false,
    supportsRetry: options.supportsRetry ?? false,
    supportsFeedback: options.supportsFeedback ?? false,
    feedbackState: options.feedbackState
  };
}

function createPromptItem(options: { runId: string; prompt: string; createdAt: string; updatedAt: string; }) {
  return createBaseItem({
    id: `user-prompt-${options.runId}`,
    runId: options.runId,
    kind: "user_prompt",
    title: "You",
    summary: options.prompt,
    createdAt: options.createdAt,
    updatedAt: options.updatedAt,
    primaryType: "user_prompt",
    supportsCopy: true,
    sourceQuestionPrompt: options.prompt
  });
}

function getReasoningOnlyText(events: NormalizedRunEvent[]) {
  return joinUniqueParagraphs(events
    .filter((event) => event.type === "thinking" && !isAssistantResponseDeltaEvent(event))
    .map((event) => event.message));
}

function getOutputAnchorId(options: { runId: string; assistantResponse: AssistantResponseAggregation; firstOutputEvent?: NormalizedRunEvent; }) {
  return options.assistantResponse.preferredMessageId
    || (options.firstOutputEvent ? getAssistantResponseMessageId(options.firstOutputEvent) : undefined)
    || `assistant-output:${options.runId}:active`;
}

function shouldDisplayThinkingFragment(summary: string, assistantDisplayText: string, status?: RunRecord["status"], hasResultEvent?: boolean) {
  if (!summary) {
    return false;
  }

  if (hasSubstantialChineseContent(summary)) {
    return Boolean(assistantDisplayText) && !hasResultEvent && status === "streaming";
  }

  return true;
}

function normalizeProcessFragment(item: ChatStreamItemModel, assistantDisplayText: string, status?: RunRecord["status"], hasResultEvent?: boolean) {
  if (item.kind !== "assistant_process") {
    return item;
  }

  if (item.primaryType === "thinking") {
    return null;
  }

  const sanitized = item.primaryType === "tool_call"
    ? normalizeMarkdownStructure(item.summary).trim()
    : normalizeMarkdownStructure(item.summary)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !isLikelyOrchestrationNoiseLine(line))
      .join("\n")
      .trim();

  if (!sanitized) {
    return null;
  }

  return {
    ...item,
    summary: sanitized
  };
}

function dedupeFragmentSequence(items: ChatStreamItemModel[]) {
  const deduped: ChatStreamItemModel[] = [];

  for (const item of items) {
    const previous = deduped[deduped.length - 1];
    if (!previous) {
      deduped.push(item);
      continue;
    }

    if (item.kind === "assistant_process"
      && previous.kind === "assistant_process"
      && item.runId === previous.runId
      && item.primaryType === previous.primaryType
      && (item.anchorId === previous.anchorId || shouldTreatComparableTextsAsDuplicate(getComparableBlockKey(previous.summary), getComparableBlockKey(item.summary)))) {
      if (item.summary.length >= previous.summary.length) {
        deduped[deduped.length - 1] = {
          ...previous,
          ...item,
          badges: previous.badges,
          originEventTypes: [...new Set([...previous.originEventTypes, ...item.originEventTypes])]
        };
      }
      continue;
    }

    if (item.kind === "assistant_question"
      && previous.kind === "assistant_question"
      && item.question?.questionId
      && item.question.questionId === previous.question?.questionId) {
      deduped[deduped.length - 1] = { ...previous, ...item };
      continue;
    }

    deduped.push(item);
  }

  return deduped;
}

function getTranscriptRole(item: ChatStreamItemModel): TranscriptMessageRole {
  return item.kind === "user_prompt" || item.kind === "user_answer" ? "user" : "assistant";
}

function getTranscriptPartKind(item: ChatStreamItemModel): TranscriptPartKind {
  switch (item.kind) {
    case "user_prompt":
      return "prompt";
    case "user_answer":
      return "answer";
    case "assistant_process":
      return item.primaryType === "tool_call" ? "tool" : "reasoning";
    case "assistant_question":
      return "question";
    case "assistant_error":
      return "error";
    default:
      return "text";
  }
}

function createTranscriptPart(item: ChatStreamItemModel): TranscriptPartModel {
  return {
    id: item.id,
    kind: getTranscriptPartKind(item),
    role: getTranscriptRole(item),
    runId: item.runId,
    text: item.summary,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    anchorId: item.anchorId,
    groupAnchorId: item.groupAnchorId,
    originEventTypes: item.originEventTypes,
    badges: item.badges,
    question: item.question,
    answer: item.answer,
    pendingQuestion: item.pendingQuestion,
    sourceQuestionPrompt: item.sourceQuestionPrompt,
    supportsCopy: item.supportsCopy,
    supportsRetry: item.supportsRetry,
    supportsFeedback: item.supportsFeedback,
    feedbackState: item.feedbackState,
    actionAnchorId: item.supportsCopy || item.supportsRetry || item.supportsFeedback ? item.anchorId : undefined
  };
}

function canMergeTranscriptMessage(current: TranscriptMessageModel | null, item: ChatStreamItemModel) {
  if (!current) {
    return false;
  }

  const role = getTranscriptRole(item);
  if (current.role !== role || current.runId !== item.runId) {
    return false;
  }

  if (role === "user") {
    return false;
  }

  return current.groupAnchorId === item.groupAnchorId;
}

function createTranscriptMessage(item: ChatStreamItemModel): TranscriptMessageModel {
  return {
    id: `message:${item.runId}:${item.groupAnchorId}:${getTranscriptRole(item)}`,
    runId: item.runId,
    role: getTranscriptRole(item),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    anchorId: item.anchorId,
    groupAnchorId: item.groupAnchorId,
    parts: [createTranscriptPart(item)],
    sourceQuestionPrompt: item.sourceQuestionPrompt,
    supportsCopy: item.supportsCopy,
    supportsRetry: item.supportsRetry,
    supportsFeedback: item.supportsFeedback,
    feedbackState: item.feedbackState,
    actionAnchorId: item.supportsCopy || item.supportsRetry || item.supportsFeedback ? item.anchorId : undefined
  };
}

function mergeTranscriptMessage(current: TranscriptMessageModel, item: ChatStreamItemModel) {
  const next: TranscriptMessageModel = {
    ...current,
    anchorId: current.anchorId || item.anchorId,
    updatedAt: item.updatedAt,
    parts: [...current.parts, createTranscriptPart(item)],
    sourceQuestionPrompt: item.sourceQuestionPrompt ?? current.sourceQuestionPrompt,
    supportsCopy: current.supportsCopy || item.supportsCopy,
    supportsRetry: current.supportsRetry || item.supportsRetry,
    supportsFeedback: current.supportsFeedback || item.supportsFeedback,
    feedbackState: item.feedbackState ?? current.feedbackState,
    actionAnchorId: item.supportsCopy || item.supportsRetry || item.supportsFeedback ? item.anchorId : current.actionAnchorId
  };

  return next;
}

export function flattenTranscriptMessages(messages: TranscriptMessageModel[]) {
  return messages.flatMap((message) => message.parts);
}

function createTranscriptSummaryPart(summary: TranscriptSummaryModel): TranscriptPartModel {
  return {
    id: `summary:${summary.runId ?? "transcript"}:${summary.updatedAt ?? "pending"}`,
    kind: "summary",
    role: "assistant",
    runId: summary.runId ?? "transcript",
    text: summary.label,
    detail: summary.detail,
    tone: summary.tone,
    createdAt: summary.updatedAt ?? "1970-01-01T00:00:00.000Z",
    updatedAt: summary.updatedAt ?? "1970-01-01T00:00:00.000Z",
    anchorId: `summary:${summary.runId ?? "transcript"}`,
    groupAnchorId: `summary:${summary.runId ?? "transcript"}`,
    originEventTypes: [],
    badges: [],
    supportsCopy: false,
    supportsRetry: false,
    supportsFeedback: false
  };
}

/** @ArchitectureID: ELM-APP-EXT-RUN-CONVERSATION-MAPPER */
export function buildTranscriptPartStream(options: BuildChatStreamItemsOptions & {
  streamStatus?: TimelineStreamStatus;
  runStatus?: TimelineRunStatus;
  includeSummary?: boolean;
}) {
  const messages = buildTranscriptMessages({
    ...options,
    includeToolCallParts: options.includeToolCallParts ?? false
  });
  const parts = flattenTranscriptMessages(messages);

  if (!messages.length || options.includeSummary === false) {
    return parts;
  }

  return [...parts, createTranscriptSummaryPart(buildTranscriptSummary({
    events: options.events,
    runStatus: options.runStatus ?? options.status,
    streamStatus: options.streamStatus,
    finalOutput: options.finalOutput,
    errorMessage: options.errorMessage,
    pendingQuestionId: options.pendingQuestionId,
    runId: options.runId,
    updatedAt: options.updatedAt
  }))];
}

/** @ArchitectureID: ELM-APP-EXT-RUN-CONVERSATION-MAPPER */
export function buildFragmentSequence(options: BuildChatStreamItemsOptions): ChatStreamItemModel[] {
  const runId = options.runId ?? "standalone-run";
  const prompt = options.prompt?.trim() || "";
  const events = options.events;
  const includeToolCallParts = options.includeToolCallParts ?? true;
  const answersByQuestionId = new Map<string, AnswerRecord[]>();
  const consumedQuestionAnswerIds = new Set<string>();
  const items: ChatStreamItemModel[] = [];
  const fallbackTimestamp = options.updatedAt ?? events[events.length - 1]?.createdAt ?? "1970-01-01T00:00:00.000Z";
  const assistantResponse = collectAssistantResponseAggregation(events, options.finalOutput);
  const latestResultText = collectLatestAssistantResultText(events);
  const reasoningOnlyText = getReasoningOnlyText(events);
  const assistantDisplayText = resolveAssistantDisplayText(assistantResponse.text, options.finalOutput, options.status)
    || latestResultText
    || deriveAssistantDisplayTextFromReasoning(reasoningOnlyText);
  const errorMessage = trimTerminalText(options.errorMessage);
  const presentationState = resolveTimelinePresentationState({
    events,
    runStatus: options.status,
    finalOutput: assistantDisplayText,
    errorMessage
  });
  const hasResultEvent = events.some((event) => event.type === "result");
  const firstOutputEvent = events.find((event) => isAssistantResponseDeltaEvent(event) || event.type === "result");
  const outputAnchorId = getOutputAnchorId({ runId, assistantResponse, firstOutputEvent });
  let assistantGroupIndex = 0;
  let currentAssistantGroupAnchorId = `fragment-group:${runId}:assistant:${assistantGroupIndex}`;
  let assistantTextSoFar = "";
  let currentOutputIndex = -1;
  let currentOutputAnchorId: string | null = null;
  let segmentBaselineText = "";

  const closeCurrentOutputSegment = () => {
    currentOutputIndex = -1;
    currentOutputAnchorId = null;
    segmentBaselineText = assistantTextSoFar;
  };

  const advanceAssistantGroup = () => {
    assistantGroupIndex += 1;
    currentAssistantGroupAnchorId = `fragment-group:${runId}:assistant:${assistantGroupIndex}`;
    closeCurrentOutputSegment();
  };

  const upsertAssistantOutputSegment = (event: NormalizedRunEvent, text: string) => {
    const normalizedText = sanitizeAssistantDisplayText(text);
    if (!normalizedText) {
      return;
    }

    const anchorId = getAssistantResponseMessageId(event);
    if (currentOutputIndex >= 0 && currentOutputAnchorId === anchorId) {
      items[currentOutputIndex] = {
        ...items[currentOutputIndex],
        summary: normalizedText,
        updatedAt: event.createdAt,
        primaryType: event.type === "result" ? "result" : items[currentOutputIndex].primaryType
      };
      return;
    }

    items.push(createBaseItem({
      id: `assistant-output:${event.id}`,
      anchorId,
      groupAnchorId: currentAssistantGroupAnchorId,
      runId,
      kind: "assistant_output",
      title: "Assistant",
      summary: normalizedText,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
      primaryType: event.type === "result" ? "result" : "thinking",
      originEventTypes: [event.type],
      sourceQuestionPrompt: prompt,
      supportsCopy: false,
      supportsRetry: false,
      supportsFeedback: false
    }));
    currentOutputIndex = items.length - 1;
    currentOutputAnchorId = anchorId;
  };

  for (const answer of sortAnswers(options.answers ?? [])) {
    const bucket = answersByQuestionId.get(answer.questionId) ?? [];
    bucket.push(answer);
    answersByQuestionId.set(answer.questionId, bucket);
  }

  if (prompt) {
    items.push(createPromptItem({
      runId,
      prompt,
      createdAt: events[0]?.createdAt ?? fallbackTimestamp,
      updatedAt: events[0]?.createdAt ?? fallbackTimestamp
    }));
  }

  for (const event of events) {
    if (isAssistantResponseDeltaEvent(event) || event.type === "result") {
      const thinkingEmissionKind = getAssistantResponseThinkingEmissionKind(event);
      assistantTextSoFar = thinkingEmissionKind === "snapshot" || event.type === "result"
        ? mergeAssistantResponseSnapshot(assistantTextSoFar, event.message)
        : mergeAssistantResponseDelta(assistantTextSoFar, event.message);

      upsertAssistantOutputSegment(event, deriveVisibleAssistantSegmentText(assistantTextSoFar, segmentBaselineText));
      continue;
    }

    if (event.type === "question") {
      closeCurrentOutputSegment();
      const questionId = event.question?.questionId ?? event.id;
      const anchorId = questionId;
      items.push(createBaseItem({
        id: `question:${anchorId}`,
        anchorId,
        groupAnchorId: currentAssistantGroupAnchorId,
        runId,
        kind: "assistant_question",
        title: event.question?.title || "Assistant",
        summary: event.question?.message?.trim() || event.message.trim(),
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
        primaryType: "question",
        badges: getQuestionBadges(event.question?.questionId === options.pendingQuestionId),
        originEventTypes: ["question"],
        question: event.question,
        pendingQuestion: event.question?.questionId === options.pendingQuestionId,
        sourceQuestionPrompt: prompt,
        supportsCopy: true,
        supportsRetry: true,
        supportsFeedback: true,
        feedbackState: options.feedbackByMessageId?.[anchorId] ?? createIdleFeedbackState()
      }));

      for (const answer of answersByQuestionId.get(questionId) ?? []) {
        consumedQuestionAnswerIds.add(answer.id);
        items.push(createBaseItem({
          id: answer.id,
          anchorId: answer.id,
          groupAnchorId: `fragment-group:${runId}:${questionId}`,
          runId,
          kind: "user_answer",
          title: "You",
          summary: answer.answer,
          createdAt: answer.submittedAt,
          updatedAt: answer.submittedAt,
          primaryType: "user_answer",
          badges: answer.choiceId ? [createBadge("已回答", "success")] : [],
          answer,
          supportsCopy: true
        }));
      }

      advanceAssistantGroup();
      continue;
    }

    if (event.type === "error") {
      closeCurrentOutputSegment();
      items.push(createBaseItem({
        id: `error:${event.id}`,
        anchorId: event.id,
        groupAnchorId: currentAssistantGroupAnchorId,
        runId,
        kind: "assistant_error",
        title: "Assistant",
        summary: event.message.trim() || errorMessage,
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
        primaryType: "error",
        badges: getErrorBadges(),
        originEventTypes: ["error"],
        sourceQuestionPrompt: prompt,
        supportsCopy: true,
        supportsRetry: true
      }));
      continue;
    }

    if (event.type === "thinking" || event.type === "tool_call") {
      if (event.type === "tool_call") {
        if (!includeToolCallParts) {
          continue;
        }

        closeCurrentOutputSegment();
      }

      items.push(createBaseItem({
        id: `process:${event.id}`,
        anchorId: getEventSemanticIdentity(event) || event.id,
        groupAnchorId: currentAssistantGroupAnchorId,
        runId,
        kind: "assistant_process",
        title: getEventTitle(event),
        summary: event.message.trim(),
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
        primaryType: event.type,
        badges: getProcessBadge(event.type),
        originEventTypes: [event.type],
        sourceQuestionPrompt: prompt,
        supportsCopy: true
      }));
    }
  }

  for (const answer of sortAnswers(options.answers ?? [])) {
    if (consumedQuestionAnswerIds.has(answer.id)) {
      continue;
    }

    items.push(createBaseItem({
      id: answer.id,
      anchorId: answer.id,
      groupAnchorId: `fragment-group:${runId}:${answer.questionId}`,
      runId,
      kind: "user_answer",
      title: "You",
      summary: answer.answer,
      createdAt: answer.submittedAt,
      updatedAt: answer.submittedAt,
      primaryType: "user_answer",
      badges: answer.choiceId ? [createBadge("已回答", "success")] : [],
      answer,
      supportsCopy: true
    }));
  }

  if (assistantDisplayText) {
    const resolvedSegmentText = deriveVisibleAssistantSegmentText(assistantDisplayText, segmentBaselineText);
    if (resolvedSegmentText) {
      if (currentOutputIndex >= 0) {
        items[currentOutputIndex] = {
          ...items[currentOutputIndex],
          anchorId: outputAnchorId,
          summary: resolvedSegmentText,
          updatedAt: assistantResponse.lastResponseAt ?? fallbackTimestamp,
          primaryType: presentationState.runStatus === "done" ? "result" : items[currentOutputIndex].primaryType,
          originEventTypes: [...new Set([...items[currentOutputIndex].originEventTypes, presentationState.runStatus === "done" ? "result" : "thinking"])] as NormalizedEventType[]
        };
      } else {
        upsertAssistantOutputSegment({
          id: `${runId}:resolved-output`,
          runId,
          type: presentationState.runStatus === "done" ? "result" : "thinking",
          createdAt: assistantResponse.lastResponseAt ?? fallbackTimestamp,
          sequence: Number.MAX_SAFE_INTEGER,
          message: assistantDisplayText,
          data: { message_id: outputAnchorId }
        } as NormalizedRunEvent, resolvedSegmentText);
      }
      assistantTextSoFar = assistantDisplayText;
    }
  }

  if (!items.some((item) => item.kind === "assistant_error") && presentationState.runStatus === "error" && errorMessage) {
    items.push(createBaseItem({
      id: `error:${runId}:synthetic`,
      anchorId: outputAnchorId,
      groupAnchorId: currentAssistantGroupAnchorId,
      runId,
      kind: "assistant_error",
      title: "Assistant",
      summary: errorMessage,
      createdAt: fallbackTimestamp,
      updatedAt: fallbackTimestamp,
      primaryType: "error",
      badges: getErrorBadges(),
      originEventTypes: ["error"],
      sourceQuestionPrompt: prompt,
      supportsCopy: true,
      supportsRetry: true
    }));
  }

  const lastAssistantOutputItemIndex = [...items].map((item, index) => ({ item, index }))
    .filter(({ item }) => item.kind === "assistant_output")
    .at(-1)?.index ?? -1;

  if (lastAssistantOutputItemIndex >= 0) {
    const lastAssistantOutputItem = items[lastAssistantOutputItemIndex];
    const terminal = presentationState.runStatus === "done";
    items[lastAssistantOutputItemIndex] = {
      ...lastAssistantOutputItem,
      badges: getAssistantOutputBadges({
        terminal,
        hasResultEvent,
        hasStreamingText: assistantResponse.hasResponseEvent
      }),
      supportsCopy: Boolean(lastAssistantOutputItem.summary.trim()),
      supportsRetry: terminal,
      supportsFeedback: terminal,
      feedbackState: terminal
        ? options.feedbackByMessageId?.[lastAssistantOutputItem.anchorId] ?? createIdleFeedbackState()
        : undefined,
      originEventTypes: [...new Set(items
        .filter((item) => item.kind === "assistant_output")
        .flatMap((item) => item.originEventTypes.length ? item.originEventTypes : [item.primaryType === "result" ? "result" : "thinking"]))] as NormalizedEventType[]
    };
  }

  return dedupeFragmentSequence(items
    .map((item) => normalizeProcessFragment(item, assistantDisplayText, presentationState.runStatus, hasResultEvent))
    .filter((item): item is ChatStreamItemModel => Boolean(item)));
}

export function buildChatStreamItems(options: BuildChatStreamItemsOptions): ChatStreamItemModel[] {
  return buildFragmentSequence(options);
}

/** @ArchitectureID: ELM-APP-EXT-RUN-CONVERSATION-MAPPER */
export function buildTranscriptMessages(options: BuildChatStreamItemsOptions): TranscriptMessageModel[] {
  const fragments = buildFragmentSequence({
    ...options,
    includeToolCallParts: options.includeToolCallParts ?? false
  });
  const messages: TranscriptMessageModel[] = [];

  for (const item of fragments) {
    const current = messages[messages.length - 1] ?? null;
    if (canMergeTranscriptMessage(current, item)) {
      messages[messages.length - 1] = mergeTranscriptMessage(current, item);
      continue;
    }

    messages.push(createTranscriptMessage(item));
  }

  return messages;
}

/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-RENDERER */
export function buildTranscriptSummary(options: {
  events: NormalizedRunEvent[];
  runStatus?: TimelineRunStatus;
  streamStatus?: TimelineStreamStatus;
  finalOutput?: string | null;
  errorMessage?: string | null;
  pendingQuestionId?: string | null;
  runId?: string | null;
  updatedAt?: string | null;
}): TranscriptSummaryModel {
  const presentationState = resolveTimelinePresentationState(options);
  const waitingForAnswer = Boolean(options.pendingQuestionId)
    || presentationState.runStatus === "waiting_for_answer"
    || presentationState.streamStatus === "waiting_for_answer";

  if (presentationState.runStatus === "error" || presentationState.streamStatus === "error") {
    return {
      label: "已中断",
      detail: trimTerminalText(options.errorMessage) || "本轮对话已中断，请查看失败提示后决定是否重试。",
      tone: "danger",
      runId: options.runId,
      updatedAt: options.updatedAt
    };
  }

  if (waitingForAnswer) {
    return {
      label: "等待补充",
      detail: "当前 transcript 已暂停，等待补充信息后会在原位置继续。",
      tone: "warning",
      runId: options.runId,
      updatedAt: options.updatedAt
    };
  }

  if (presentationState.runStatus === "done") {
    return {
      label: "已完成",
      detail: "本轮回答已就绪，可继续追问、复制结果或发起重试。",
      tone: "success",
      runId: options.runId,
      updatedAt: options.updatedAt
    };
  }

  if (presentationState.streamStatus === "reconnecting") {
    return {
      label: "重新连接中",
      detail: "事件流正在恢复，transcript 会继续在底部追加。",
      tone: "progress",
      runId: options.runId,
      updatedAt: options.updatedAt
    };
  }

  if (presentationState.streamStatus === "connecting") {
    return {
      label: "连接中",
      detail: "正在建立事件流连接，准备继续更新 transcript。",
      tone: "progress",
      runId: options.runId,
      updatedAt: options.updatedAt
    };
  }

  if (options.events.length > 0) {
    return {
      label: "进行中",
      detail: "当前 transcript 正在继续生成，新的 message parts 会持续追加。",
      tone: "progress",
      runId: options.runId,
      updatedAt: options.updatedAt
    };
  }

  return {
    label: "待开始",
    detail: "发送新消息后，这里会按统一的 message-part transcript 合同开始展示。",
    tone: "neutral",
    runId: options.runId,
    updatedAt: options.updatedAt
  };
}

export function buildConversationTurns(events: NormalizedRunEvent[]): ConversationTurnModel[] {
  return buildFragmentSequence({ events })
    .filter((item) => item.kind === "assistant_output" || item.kind === "assistant_question" || item.kind === "assistant_error")
    .map((item) => ({
      id: item.id,
      runId: item.runId,
      kind: item.kind === "assistant_question" ? "question" : item.kind === "assistant_error" ? "error" : "assistant",
      primaryType: item.primaryType === "user_prompt" || item.primaryType === "user_answer" ? "result" : item.primaryType,
      title: item.title,
      summary: item.summary,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      processItems: [],
      processSummary: "",
      question: item.question
    }));
}

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
