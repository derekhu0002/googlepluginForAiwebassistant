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
  getTimelineStatusCopy,
  resolveTimelinePresentationState,
  type BuildChatStreamItemsOptions,
  type ChatStreamItemModel
} from "./reasoningTimeline";

const TYPEWRITER_INTERVAL_MS = 24;

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
  const displayedSummary = useBufferedTypewriter(item.summary, animate);
  const isUser = item.kind === "user_prompt" || item.kind === "user_answer";
  const roleLabel = isUser ? "You" : item.kind === "assistant_error" ? "Assistant failed" : "Assistant";
  const avatarLabel = item.kind === "assistant_question" ? "?" : item.kind === "assistant_error" ? "!" : isUser ? "你" : "AI";
  const messageText = displayedSummary || (item.kind === "assistant_progress" && live ? "正在生成回答…" : "");
  const processPreview = !isUser && item.processSummary && item.kind !== "assistant_progress" ? item.processSummary : "";
  const feedbackMessage = item.feedbackState?.message || getDefaultFeedbackMessage(item.feedbackState?.status ?? "idle", item.feedbackState?.selected);
  const messageClassName = [
    "conversation-message",
    item.kind === "assistant_progress" ? "conversation-message-muted" : ""
  ].filter(Boolean).join(" ");

  return (
    <article className={`conversation-turn ${isUser ? "turn-user" : item.kind === "assistant_error" ? "turn-error" : item.kind === "assistant_question" ? "turn-question" : "turn-assistant"} is-${status}`}>
      <div className="conversation-avatar" aria-hidden="true">{avatarLabel}</div>
      <div className={`conversation-bubble ${isUser ? "user-bubble" : ""}`}>
        <div className="conversation-turn-header">
          <div className="conversation-turn-heading">
            <strong>{roleLabel}</strong>
            {!isUser ? <span className={`status-chip status-${status}`}>{getStatusLabel(status)}</span> : null}
            {item.kind === "user_answer" ? renderAnswerLabel(item.answer) : null}
          </div>
          <small>{formatTimestamp(item.updatedAt)}</small>
        </div>

        {messageText ? (
          isUser
            ? <p className={messageClassName}>{messageText}</p>
            : <MarkdownMessage text={messageText} className={messageClassName} />
        ) : null}
        {processPreview ? <p className="conversation-process-summary">{processPreview}</p> : null}

        {!isUser ? (
          <div className="conversation-hover-actions" aria-label="message actions">
            {item.supportsCopy ? <button type="button" className="icon-button" onClick={() => onCopy?.(item)}>复制</button> : null}
            {item.supportsFeedback ? (
              <>
                <button
                  type="button"
                  className={`icon-button ${item.feedbackState?.selected === "like" && item.feedbackState?.status === "submitted" ? "is-selected" : ""}`}
                  disabled={item.feedbackState?.status === "submitting"}
                  onClick={() => onFeedback?.(item, "like")}
                >
                  点赞
                </button>
                <button
                  type="button"
                  className={`icon-button ${item.feedbackState?.selected === "dislike" && item.feedbackState?.status === "submitted" ? "is-selected" : ""}`}
                  disabled={item.feedbackState?.status === "submitting"}
                  onClick={() => onFeedback?.(item, "dislike")}
                >
                  点踩
                </button>
              </>
            ) : null}
            {item.supportsRetry ? <button type="button" className="icon-button" onClick={() => onRetry?.(item)}>重试</button> : null}
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
  const [unreadCount, setUnreadCount] = useState(0);
  const [feedbackByMessageId, setFeedbackByMessageId] = useState<Record<string, MessageFeedbackUiState>>({});
  const previousSignatureRef = useRef<string>("");
  const presentationState = useMemo(() => resolveTimelinePresentationState({
    events,
    runStatus,
    streamStatus,
    finalOutput,
    errorMessage
  }), [errorMessage, events, finalOutput, runStatus, streamStatus]);
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
    if (!runSegments?.length) {
      return items;
    }

    return runSegments
      .flatMap((segment) => buildChatStreamItems({
        ...segment,
        feedbackByMessageId
      }))
      .sort((left, right) => {
        const timestampDelta = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
        if (timestampDelta !== 0) {
          return timestampDelta;
        }

        return left.id.localeCompare(right.id);
      });
  }, [feedbackByMessageId, items, runSegments]);

  useEffect(() => {
    setFeedbackByMessageId({});
  }, [runId]);

  useEffect(() => {
    setAutoFollow(live);
  }, [live]);

  useEffect(() => {
    const signature = mergedItems.map((item) => `${item.id}:${item.summary.length}:${item.processItems.length}:${item.updatedAt}`).join("|");
    if (!live || !signature || signature === previousSignatureRef.current) {
      previousSignatureRef.current = signature;
      return;
    }

    previousSignatureRef.current = signature;

    const container = containerRef.current;
    if (autoFollow || isNearBottom(container)) {
      setUnreadCount(0);
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
      return;
    }

    setUnreadCount((current) => current + 1);
  }, [autoFollow, live, mergedItems]);

  function scrollToLatest() {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    setAutoFollow(true);
    setUnreadCount(0);
  }

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
      [item.id]: {
        status: "submitting",
        selected: feedback,
        message: getDefaultFeedbackMessage("submitting", feedback)
      }
    }));

    const response = await submitMessageFeedback({
      runId: item.runId,
      messageId: item.id,
      feedback
    });

    if (!response.ok) {
      setFeedbackByMessageId((current) => ({
        ...current,
        [item.id]: {
          status: "error",
          selected: feedback,
          message: normalizeFeedbackFailureMessage(response.error.message)
        }
      }));
      return;
    }

    setFeedbackByMessageId((current) => ({
      ...current,
      [item.id]: {
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
      messageId: item.id
    });
  }

  return (
    <div className="timeline-shell conversation-timeline-shell chat-stream-shell">
      <div
        className="event-feed conversation-thread chat-stream-feed"
        ref={containerRef}
        onScroll={() => {
          const nearBottom = isNearBottom(containerRef.current);
          setAutoFollow(nearBottom);
          if (nearBottom) {
            setUnreadCount(0);
          }
        }}
      >
        {mergedItems.length ? mergedItems.map((item, index) => (
          <ChatStreamTurn
            key={item.id}
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
              && (item.kind === "assistant_progress" || item.kind === "assistant_result")}
            live={live}
            onCopy={handleCopy}
            onFeedback={handleFeedback}
            onRetry={handleRetry}
            onQuestionSubmit={item.kind === "assistant_question" ? onQuestionSubmit : undefined}
            questionSubmitDisabled={questionSubmitDisabled}
          />
        )) : <p className="empty-state chat-empty-state">{emptyText}</p>}
      </div>

      {live ? (
        <div className="timeline-toolbar chat-stream-toolbar">
          <div className="chat-stream-statusline">
            <small className="detail-muted">{getTimelineStatusCopy({ events, runStatus, finalOutput, errorMessage })}</small>
            <small className="detail-muted">
              {presentationState.runStatus === "waiting_for_answer"
                ? "等待补充信息"
                : presentationState.runStatus === "done"
                  ? "已拿到最终结果"
                  : presentationState.runStatus === "error"
                    ? "已拿到失败结果"
                    : "持续输出中"}
            </small>
          </div>
          {!autoFollow || unreadCount ? (
            <button className="secondary unread-indicator" type="button" onClick={scrollToLatest}>
              {unreadCount ? `有 ${unreadCount} 条新进展，跳转到底部` : "已暂停自动跟随，返回最新"}
            </button>
          ) : (
            <small className="detail-muted">自动跟随最新进展</small>
          )}
        </div>
      ) : null}
    </div>
  );
}
