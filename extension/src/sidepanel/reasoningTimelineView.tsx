import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import ReactMarkdown from "react-markdown";
import { submitMessageFeedback } from "../shared/api";
import type { AnswerRecord, MessageFeedbackValue, QuestionPayload, RunRecord } from "../shared/protocol";
import type { MessageFeedbackUiState, StreamConnectionState } from "../shared/types";
import {
  buildChatStreamItems,
  getDefaultFeedbackMessage,
  getTimelineCardStatus,
  resolveTimelinePresentationState,
  type BuildChatStreamItemsOptions,
  type ChatStreamItemModel
} from "./reasoningTimeline";

const TYPEWRITER_INTERVAL_MS = 24;
const GENERIC_STREAMING_COPY = "正在继续…";

const CHAT_ITEM_SORT_RANK: Record<ChatStreamItemModel["kind"], number> = {
  user_prompt: 0,
  user_answer: 1,
  assistant_process: 2,
  assistant_output: 3,
  assistant_question: 4,
  assistant_error: 5
};

function isNearBottom(element: HTMLDivElement | null) {
  if (!element) {
    return true;
  }

  return element.scrollHeight - element.scrollTop - element.clientHeight <= 32;
}

function useBufferedTypewriter(text: string, enabled: boolean) {
  const [displayedText, setDisplayedText] = useState(enabled ? "" : text);
  const displayedRef = useRef(displayedText);

  useEffect(() => {
    displayedRef.current = displayedText;
  }, [displayedText]);

  useEffect(() => {
    if (!enabled) {
      displayedRef.current = text;
      setDisplayedText(text);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    let nextLength = text.startsWith(displayedRef.current) ? displayedRef.current.length : 0;

    displayedRef.current = text.slice(0, nextLength);
    setDisplayedText(displayedRef.current);

    if (nextLength >= text.length) {
      return;
    }

    const tick = () => {
      if (cancelled) {
        return;
      }

      const remaining = text.length - nextLength;
      const chunkSize = Math.max(1, Math.ceil(remaining / 12));
      nextLength = Math.min(text.length, nextLength + chunkSize);
      const nextValue = text.slice(0, nextLength);
      displayedRef.current = nextValue;
      setDisplayedText(nextValue);

      if (nextLength < text.length) {
        timer = window.setTimeout(tick, TYPEWRITER_INTERVAL_MS);
      }
    };

    timer = window.setTimeout(tick, TYPEWRITER_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [enabled, text]);

  return displayedText;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleTimeString();
}

function getStatusLabel(status: ReturnType<typeof getTimelineCardStatus>) {
  switch (status) {
    case "active":
      return "进行中";
    case "waiting":
      return "待确认";
    case "attention":
      return "需处理";
    default:
      return "已记录";
  }
}

function renderAnswerLabel(answer?: AnswerRecord) {
  if (!answer?.choiceId) {
    return null;
  }

  return <span className="inline-answer-pill">已选择</span>;
}

function normalizeFeedbackFailureMessage(message: string) {
  return message.trim() || "反馈提交失败";
}

function MarkdownMessage({ text, className }: { text: string; className: string }) {
  return (
    <div className={`${className} markdown-body`}>
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="message-action-icon">
      <path d="M9 7.5A2.5 2.5 0 0 1 11.5 5h7A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 9 16.5v-9Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15 5V4.5A2.5 2.5 0 0 0 12.5 2h-7A2.5 2.5 0 0 0 3 4.5v9A2.5 2.5 0 0 0 5.5 16H6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="message-action-icon">
      <path d="M6 8V3.8L2.8 7M4 7h9a7 7 0 1 1-6.1 10.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LikeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="message-action-icon">
      <path d="M10 10V6.8c0-1.8 1.2-3.5 3-4.3l.8-.4v4.4l2.7 3.1c.3.4.5.9.5 1.4v5.6c0 1.1-.9 2-2 2H9.5A2.5 2.5 0 0 1 7 16.1V10h3Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M3 10h4v8H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function DislikeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="message-action-icon">
      <path d="M14 14v3.2c0 1.8-1.2 3.5-3 4.3l-.8.4v-4.4l-2.7-3.1a2.2 2.2 0 0 1-.5-1.4V7.4c0-1.1.9-2 2-2H14.5A2.5 2.5 0 0 1 17 7.9V14h-3Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M21 14h-4V6h2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function InlineQuestionComposer({
  question,
  disabled,
  onSubmit
}: {
  question: QuestionPayload;
  disabled?: boolean;
  onSubmit: (answer: { answer: string; choiceId?: string }) => void;
}) {
  const [choiceId, setChoiceId] = useState<string>(question.options[0]?.id ?? "");
  const [freeText, setFreeText] = useState("");

  useEffect(() => {
    setChoiceId(question.options[0]?.id ?? "");
    setFreeText("");
  }, [question.questionId, question.options]);

  const selectedOption = question.options.find((item) => item.id === choiceId);

  function handleSubmit() {
    const answer = freeText.trim() || selectedOption?.value || "";
    if (!answer) {
      return;
    }
    onSubmit({ answer, choiceId: selectedOption ? choiceId || undefined : undefined });
  }

  return (
    <div className="inline-question-card question-card">
      {question.options.length ? (
        <div className="inline-question-options" role="group" aria-label={question.title}>
          {question.options.map((option) => (
            <button
              key={option.id}
              className={`inline-option-button ${choiceId === option.id ? "selected" : ""}`}
              type="button"
              disabled={disabled}
              onClick={() => setChoiceId(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {question.allowFreeText ? (
        <label>
          <span className="sr-only">补充回答</span>
          <textarea
            value={freeText}
            placeholder={question.placeholder ?? "继续补充你的信息"}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setFreeText(event.target.value)}
            disabled={disabled}
          />
        </label>
      ) : null}
      <div className="inline-question-actions">
        <button type="button" disabled={disabled || (!selectedOption && !freeText.trim())} onClick={handleSubmit}>提交回答</button>
        <small className="detail-muted">也可以直接在底部输入框继续追问。</small>
      </div>
    </div>
  );
}

function ChatStreamTurn({
  item,
  status,
  animate,
  live,
  onRetry,
  onCopy,
  onFeedback,
  onQuestionSubmit,
  questionSubmitDisabled
}: {
  item: ChatStreamItemModel;
  status: ReturnType<typeof getTimelineCardStatus>;
  animate: boolean;
  live: boolean;
  onRetry?: (item: ChatStreamItemModel) => void;
  onCopy?: (item: ChatStreamItemModel) => void;
  onFeedback?: (item: ChatStreamItemModel, feedback: MessageFeedbackValue) => void;
  onQuestionSubmit?: (answer: { answer: string; choiceId?: string }) => void;
  questionSubmitDisabled?: boolean;
}) {
  const isUser = item.kind === "user_prompt" || item.kind === "user_answer";
  const isThinkingProcess = item.kind === "assistant_process" && item.primaryType === "thinking";
  const shouldAnimateSummary = animate && !isUser && Boolean(item.summary) && item.summary !== GENERIC_STREAMING_COPY;
  const displayedSummary = useBufferedTypewriter(item.summary, shouldAnimateSummary);
  const roleLabel = isUser ? "You" : item.kind === "assistant_error" ? "Assistant failed" : "Assistant";
  const avatarLabel = item.kind === "assistant_question" ? "?" : item.kind === "assistant_error" ? "!" : isUser ? "你" : "AI";
  const messageText = isUser ? item.summary : displayedSummary;
  const showStreamingIndicator = live && item.kind === "assistant_output" && status === "active";
  const feedbackMessage = item.feedbackState?.message || getDefaultFeedbackMessage(item.feedbackState?.status ?? "idle", item.feedbackState?.selected);
  const messageClassName = [
    "conversation-message",
    item.kind === "assistant_process" ? "conversation-message-muted conversation-fragment-process-copy" : ""
  ].filter(Boolean).join(" ");

  return (
    <article className={`conversation-turn conversation-fragment conversation-fragment-${item.kind} ${isThinkingProcess ? "assistant-thinking-item" : ""} ${isUser ? "turn-user" : item.kind === "assistant_error" ? "turn-error" : item.kind === "assistant_question" ? "turn-question" : "turn-assistant"} is-${status}`} data-fragment-anchor={item.anchorId} data-fragment-group-anchor={item.groupAnchorId}>
      <div className="conversation-avatar" aria-hidden="true">{avatarLabel}</div>
      <div className={`conversation-bubble ${isUser ? "user-bubble" : ""}`}>
        <div className="conversation-turn-header">
          <div className="conversation-turn-heading">
            <strong>{roleLabel}</strong>
            {!isUser ? <span className={`status-chip status-${status}`}>{getStatusLabel(status)}</span> : null}
            {showStreamingIndicator ? <span className="streaming-indicator">生成中</span> : null}
            {item.kind === "user_answer" ? renderAnswerLabel(item.answer) : null}
            {!isUser && item.badges.length ? (
              <span className="fragment-badge-list">
                {item.badges.map((badge) => (
                  <span key={`${item.id}:${badge.label}`} className={`fragment-badge fragment-badge-${badge.tone}`}>{badge.label}</span>
                ))}
              </span>
            ) : null}
          </div>
          <small>{formatTimestamp(item.updatedAt)}</small>
        </div>

        {messageText ? (
          isUser
            ? <p className={messageClassName}>{messageText}</p>
            : <MarkdownMessage text={messageText} className={messageClassName} />
        ) : null}

        {!isUser ? (
          <div className="conversation-hover-actions" aria-label="message actions">
            {item.supportsCopy ? (
              <button type="button" className="icon-button" aria-label="复制" title="复制" onClick={() => onCopy?.(item)}>
                <CopyIcon />
              </button>
            ) : null}
            {item.supportsFeedback ? (
              <>
                <button
                  type="button"
                  className={`icon-button ${item.feedbackState?.selected === "like" && item.feedbackState?.status === "submitted" ? "is-selected" : ""}`}
                  aria-label="点赞"
                  title="点赞"
                  disabled={item.feedbackState?.status === "submitting"}
                  onClick={() => onFeedback?.(item, "like")}
                >
                  <LikeIcon />
                </button>
                <button
                  type="button"
                  className={`icon-button ${item.feedbackState?.selected === "dislike" && item.feedbackState?.status === "submitted" ? "is-selected" : ""}`}
                  aria-label="点踩"
                  title="点踩"
                  disabled={item.feedbackState?.status === "submitting"}
                  onClick={() => onFeedback?.(item, "dislike")}
                >
                  <DislikeIcon />
                </button>
              </>
            ) : null}
            {item.supportsRetry ? (
              <button type="button" className="icon-button" aria-label="重试" title="重试" onClick={() => onRetry?.(item)}>
                <RetryIcon />
              </button>
            ) : null}
          </div>
        ) : null}

        {!isUser && feedbackMessage ? (
          <small className={`feedback-status feedback-${item.feedbackState?.status ?? "idle"}`}>{feedbackMessage}</small>
        ) : null}

        {item.kind === "assistant_question" && item.question && item.pendingQuestion && onQuestionSubmit ? (
          <InlineQuestionComposer question={item.question} disabled={questionSubmitDisabled} onSubmit={onQuestionSubmit} />
        ) : null}
      </div>
    </article>
  );
}

export interface ChatStreamViewProps {
  runId?: string | null;
  prompt?: string | null;
  events: import("../shared/protocol").NormalizedRunEvent[];
  runSegments?: BuildChatStreamItemsOptions[];
  assistantStatus?: "idle" | "collecting" | "streaming" | "waiting_for_answer" | "done" | "error";
  answers?: AnswerRecord[];
  live?: boolean;
  streamStatus?: StreamConnectionState["status"];
  runStatus?: RunRecord["status"];
  finalOutput?: string | null;
  errorMessage?: string | null;
  updatedAt?: string | null;
  pendingQuestionId?: string | null;
  emptyText?: string;
  onRetry?: (payload: { prompt: string; runId: string; messageId: string }) => void | Promise<void>;
  onQuestionSubmit?: (answer: { answer: string; choiceId?: string }) => void;
  questionSubmitDisabled?: boolean;
}

/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-RENDERER */
/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-LIVE-HISTORY-UX */
export function ReasoningTimeline({
  runId,
  prompt,
  events,
  runSegments,
  assistantStatus,
  answers = [],
  live = false,
  streamStatus,
  runStatus,
  finalOutput,
  errorMessage,
  updatedAt,
  pendingQuestionId,
  emptyText = "暂无事件。",
  onRetry,
  onQuestionSubmit,
  questionSubmitDisabled = false
}: ChatStreamViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoFollow, setAutoFollow] = useState(live);
  const [feedbackByMessageId, setFeedbackByMessageId] = useState<Record<string, MessageFeedbackUiState>>({});
  const previousSignatureRef = useRef<string>("");
  const presentationState = useMemo(() => resolveTimelinePresentationState({
    events,
    runStatus,
    streamStatus,
    finalOutput,
    errorMessage
  }), [errorMessage, events, finalOutput, runStatus, streamStatus]);
  const inlineStatusCopy = useMemo(() => {
    if (presentationState.runStatus === "error" || presentationState.streamStatus === "error") {
      return "本轮已中断，可直接重试。";
    }

    if (
      pendingQuestionId
      || assistantStatus === "waiting_for_answer"
      || presentationState.runStatus === "waiting_for_answer"
      || presentationState.streamStatus === "waiting_for_answer"
    ) {
      return "等待补充信息…";
    }

    if (presentationState.streamStatus === "reconnecting") {
      return "正在重新连接…";
    }

    if (presentationState.streamStatus === "connecting") {
      return "连接中…";
    }

    return "";
  }, [assistantStatus, pendingQuestionId, presentationState.runStatus, presentationState.streamStatus]);
  const items = useMemo(() => buildChatStreamItems({
    runId,
    prompt,
    events,
    answers,
    feedbackByMessageId,
    finalOutput,
    errorMessage,
    status: runStatus,
    updatedAt,
    pendingQuestionId
  }), [answers, errorMessage, events, feedbackByMessageId, finalOutput, pendingQuestionId, prompt, runId, runStatus, updatedAt]);
  const mergedItems = useMemo(() => {
    const fragments = runSegments?.length
      ? runSegments
        .flatMap((segment, segmentIndex) => buildChatStreamItems({
          ...segment,
          feedbackByMessageId
        }).map((item, itemIndex) => ({ item, segmentIndex, itemIndex })))
        .sort((left, right) => {
          const timestampDelta = new Date(left.item.createdAt).getTime() - new Date(right.item.createdAt).getTime();
          if (timestampDelta !== 0) {
            return timestampDelta;
          }

          const segmentDelta = left.segmentIndex - right.segmentIndex;
          if (segmentDelta !== 0) {
            return segmentDelta;
          }

          const itemDelta = left.itemIndex - right.itemIndex;
          if (itemDelta !== 0) {
            return itemDelta;
          }

          const rankDelta = CHAT_ITEM_SORT_RANK[left.item.kind] - CHAT_ITEM_SORT_RANK[right.item.kind];
          if (rankDelta !== 0) {
            return rankDelta;
          }

          return left.item.id.localeCompare(right.item.id);
        })
        .map(({ item }) => item)
      : items;

    return fragments.length ? fragments : items;
  }, [feedbackByMessageId, items, runSegments]);

  useEffect(() => {
    setFeedbackByMessageId({});
  }, [runId]);

  useEffect(() => {
    setAutoFollow(live);
  }, [live]);

  useEffect(() => {
    const signature = mergedItems.map((item) => `${item.id}:${item.summary.length}:${item.updatedAt}`).join("|");
    if (!live || !signature || signature === previousSignatureRef.current) {
      previousSignatureRef.current = signature;
      return;
    }

    previousSignatureRef.current = signature;

    const container = containerRef.current;
    if (autoFollow || isNearBottom(container)) {
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
      return;
    }
  }, [autoFollow, live, mergedItems]);

  async function handleCopy(item: ChatStreamItemModel) {
    const text = item.summary.trim();
    if (!text) {
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  }

  async function handleFeedback(item: ChatStreamItemModel, feedback: MessageFeedbackValue) {
    setFeedbackByMessageId((current) => ({
      ...current,
      [item.anchorId]: {
        status: "submitting",
        selected: feedback,
        message: getDefaultFeedbackMessage("submitting", feedback)
      }
    }));

    const response = await submitMessageFeedback({
      runId: item.runId,
      messageId: item.anchorId,
      feedback
    });

    if (!response.ok) {
      setFeedbackByMessageId((current) => ({
        ...current,
        [item.anchorId]: {
          status: "error",
          selected: feedback,
          message: normalizeFeedbackFailureMessage(response.error.message)
        }
      }));
      return;
    }

    setFeedbackByMessageId((current) => ({
      ...current,
      [item.anchorId]: {
        status: "submitted",
        selected: response.data.feedback,
        message: getDefaultFeedbackMessage("submitted", response.data.feedback)
      }
    }));
  }

  async function handleRetry(item: ChatStreamItemModel) {
    if (!item.sourceQuestionPrompt || !item.runId || !onRetry) {
      return;
    }

    await onRetry({
      prompt: item.sourceQuestionPrompt,
      runId: item.runId,
      messageId: item.anchorId
    });
  }

  return (
    <div className="timeline-shell conversation-timeline-shell chat-stream-shell">
      {inlineStatusCopy ? <p className="conversation-inline-status detail-muted" role="status" aria-live="polite">{inlineStatusCopy}</p> : null}
      <div
        className="event-feed conversation-thread chat-stream-feed"
        ref={containerRef}
        onScroll={() => {
          const nearBottom = isNearBottom(containerRef.current);
          setAutoFollow(nearBottom);
        }}
      >
        {mergedItems.length ? mergedItems.map((item, index) => (
          <ChatStreamTurn
            key={`${item.runId}:${item.id}`}
            item={item}
            status={getTimelineCardStatus({
              type: item.primaryType === "user_prompt" || item.primaryType === "user_answer" ? "result" : item.primaryType,
              isLast: index === mergedItems.length - 1,
              live,
              streamStatus: presentationState.streamStatus,
              runStatus: presentationState.runStatus
            })}
            animate={live
              && (presentationState.streamStatus === "connecting" || presentationState.streamStatus === "streaming" || presentationState.streamStatus === "reconnecting")
              && index === mergedItems.length - 1
              && item.kind === "assistant_output"}
            live={live}
            onCopy={handleCopy}
            onFeedback={handleFeedback}
            onRetry={handleRetry}
            onQuestionSubmit={item.kind === "assistant_question" ? onQuestionSubmit : undefined}
            questionSubmitDisabled={questionSubmitDisabled}
          />
        )) : <p className="empty-state chat-empty-state">{emptyText}</p>}
      </div>
    </div>
  );
}
