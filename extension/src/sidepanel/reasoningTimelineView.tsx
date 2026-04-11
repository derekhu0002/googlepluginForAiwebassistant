import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import ReactMarkdown from "react-markdown";
import { submitMessageFeedback } from "../shared/api";
import type { AnswerRecord, MessageFeedbackValue, QuestionPayload, RunRecord } from "../shared/protocol";
import type { MessageFeedbackUiState, StreamConnectionState } from "../shared/types";
import {
  buildTranscriptMessages,
  buildTranscriptSummary,
  getDefaultFeedbackMessage,
  resolveTimelinePresentationState,
  type BuildChatStreamItemsOptions,
  type TranscriptMessageModel,
  type TranscriptPartModel
} from "./reasoningTimeline";

const GENERIC_STREAMING_COPY = "正在继续…";

function isNearBottom(element: HTMLDivElement | null) {
  if (!element) {
    return true;
  }

  return element.scrollHeight - element.scrollTop - element.clientHeight <= 32;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleTimeString();
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

function SummaryStatusDecoration({ tone }: { tone: "neutral" | "progress" | "warning" | "success" | "danger" }) {
  return (
    <div className="transcript-summary-decoration" data-section="decoration" aria-hidden="true">
      <span className={`transcript-summary-status transcript-summary-status-${tone}`} />
      <span className="transcript-part-rail" />
    </div>
  );
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

function TranscriptPartBlock({
  part,
  animate,
  live,
  onQuestionSubmit,
  questionSubmitDisabled
}: {
  part: TranscriptPartModel;
  animate: boolean;
  live: boolean;
  onQuestionSubmit?: (answer: { answer: string; choiceId?: string }) => void;
  questionSubmitDisabled?: boolean;
}) {
  const isUser = part.kind === "prompt" || part.kind === "answer";
  const messageText = part.text;
  const showStreamingIndicator = live && part.kind === "text" && animate;
  const messageClassName = [
    "transcript-part-copy",
    "markdown-body",
    part.kind === "reasoning" || part.kind === "tool" ? "transcript-part-muted" : ""
  ].filter(Boolean).join(" ");

  return (
    <section
      className={`transcript-part transcript-part-${part.kind}`}
      data-section="part"
      data-part-kind={part.kind}
      data-part-anchor={part.anchorId}
    >
      <div className="transcript-part-decoration" data-section="decoration" aria-hidden="true">
        <span className="transcript-part-anchor" />
        <span className="transcript-part-rail" />
      </div>
      <div className="transcript-part-body" data-section="content">
        <div className="transcript-part-header">
          <div className="transcript-part-heading">
            {showStreamingIndicator ? <span className="streaming-indicator">生成中</span> : null}
            {part.kind === "answer" ? renderAnswerLabel(part.answer) : null}
            {part.badges.length ? (
              <span className="fragment-badge-list">
                {part.badges.map((badge) => (
                  <span key={`${part.id}:${badge.label}`} className={`fragment-badge fragment-badge-${badge.tone}`}>{badge.label}</span>
                ))}
              </span>
            ) : null}
          </div>
          <small>{formatTimestamp(part.updatedAt)}</small>
        </div>

        {messageText ? (
          isUser
            ? <p className="transcript-part-copy">{messageText}</p>
            : <MarkdownMessage text={messageText} className={messageClassName} />
        ) : null}

        {part.kind === "question" && part.question && part.pendingQuestion && onQuestionSubmit ? (
          <InlineQuestionComposer question={part.question} disabled={questionSubmitDisabled} onSubmit={onQuestionSubmit} />
        ) : null}
      </div>
    </section>
  );
}

function TranscriptMessageCard({
  message,
  animate,
  live,
  onRetry,
  onCopy,
  onFeedback,
  onQuestionSubmit,
  questionSubmitDisabled
}: {
  message: TranscriptMessageModel;
  animate: boolean;
  live: boolean;
  onRetry?: (message: TranscriptMessageModel) => void;
  onCopy?: (message: TranscriptMessageModel) => void;
  onFeedback?: (message: TranscriptMessageModel, feedback: MessageFeedbackValue) => void;
  onQuestionSubmit?: (answer: { answer: string; choiceId?: string }) => void;
  questionSubmitDisabled?: boolean;
}) {
  const isUser = message.role === "user";
  const feedbackMessage = message.feedbackState?.message || getDefaultFeedbackMessage(message.feedbackState?.status ?? "idle", message.feedbackState?.selected);

  return (
    <article className="transcript-message" data-message-anchor={message.anchorId} data-message-group-anchor={message.groupAnchorId} data-message-role={message.role}>
      <div className="transcript-message-parts">
        {message.parts.map((part, index) => (
          <TranscriptPartBlock
            key={`${message.id}:${part.id}:${index}`}
            part={part}
            animate={animate && index === message.parts.length - 1}
            live={live}
            onQuestionSubmit={onQuestionSubmit}
            questionSubmitDisabled={questionSubmitDisabled}
          />
        ))}
      </div>

      {!isUser ? (
        <div className="transcript-message-actions" aria-label="message actions">
          {message.supportsCopy ? (
            <button type="button" className="icon-button" aria-label="复制" title="复制" onClick={() => onCopy?.(message)}>
              <CopyIcon />
            </button>
          ) : null}
          {message.supportsFeedback ? (
            <>
              <button
                type="button"
                className={`icon-button ${message.feedbackState?.selected === "like" && message.feedbackState?.status === "submitted" ? "is-selected" : ""}`}
                aria-label="点赞"
                title="点赞"
                disabled={message.feedbackState?.status === "submitting"}
                onClick={() => onFeedback?.(message, "like")}
              >
                <LikeIcon />
              </button>
              <button
                type="button"
                className={`icon-button ${message.feedbackState?.selected === "dislike" && message.feedbackState?.status === "submitted" ? "is-selected" : ""}`}
                aria-label="点踩"
                title="点踩"
                disabled={message.feedbackState?.status === "submitting"}
                onClick={() => onFeedback?.(message, "dislike")}
              >
                <DislikeIcon />
              </button>
            </>
          ) : null}
          {message.supportsRetry ? (
            <button type="button" className="icon-button" aria-label="重试" title="重试" onClick={() => onRetry?.(message)}>
              <RetryIcon />
            </button>
          ) : null}
        </div>
      ) : null}

      {!isUser && feedbackMessage ? (
        <small className={`feedback-status feedback-${message.feedbackState?.status ?? "idle"}`}>{feedbackMessage}</small>
      ) : null}
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
  const messages = useMemo(() => buildTranscriptMessages({
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
  const mergedMessages = useMemo(() => {
    const merged = runSegments?.length
      ? runSegments
        .flatMap((segment, segmentIndex) => buildTranscriptMessages({
          ...segment,
          feedbackByMessageId
        }).map((message, itemIndex) => ({ message, segmentIndex, itemIndex })))
        .sort((left, right) => {
          const timestampDelta = new Date(left.message.createdAt).getTime() - new Date(right.message.createdAt).getTime();
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

          return left.message.id.localeCompare(right.message.id);
        })
        .map(({ message }) => message)
      : messages;

    return merged.length ? merged : messages;
  }, [feedbackByMessageId, messages, runSegments]);
  const inlineStatusCopy = useMemo(() => {
    const hasAssistantTextPart = mergedMessages.some((message) => message.role === "assistant"
      && message.parts.some((part) => part.kind === "text" && part.text.trim()));

    if (!live || hasAssistantTextPart) {
      return "";
    }

    if (presentationState.runStatus === "waiting_for_answer" || presentationState.streamStatus === "waiting_for_answer" || pendingQuestionId) {
      return "";
    }

    if (presentationState.runStatus === "streaming" || presentationState.streamStatus === "connecting" || presentationState.streamStatus === "streaming" || presentationState.streamStatus === "reconnecting") {
      return GENERIC_STREAMING_COPY;
    }

    return "";
  }, [live, mergedMessages, pendingQuestionId, presentationState.runStatus, presentationState.streamStatus]);
  const transcriptSummary = useMemo(() => buildTranscriptSummary({
    events,
    runStatus,
    streamStatus,
    finalOutput,
    errorMessage,
    pendingQuestionId,
    runId,
    updatedAt
  }), [errorMessage, events, finalOutput, pendingQuestionId, runId, runStatus, streamStatus, updatedAt]);

  useEffect(() => {
    setFeedbackByMessageId({});
  }, [runId]);

  useEffect(() => {
    setAutoFollow(live);
  }, [live]);

  useEffect(() => {
    const signature = mergedMessages.map((message) => `${message.id}:${message.parts.map((part) => part.text.length).join(",")}:${message.updatedAt}`).join("|");
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
    }
  }, [autoFollow, live, mergedMessages]);

  async function handleCopy(message: TranscriptMessageModel) {
    const text = message.parts.map((part) => part.text.trim()).filter(Boolean).join("\n\n");
    if (!text) {
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  }

  async function handleFeedback(message: TranscriptMessageModel, feedback: MessageFeedbackValue) {
    const messageId = message.actionAnchorId ?? message.anchorId;
    setFeedbackByMessageId((current) => ({
      ...current,
      [messageId]: {
        status: "submitting",
        selected: feedback,
        message: getDefaultFeedbackMessage("submitting", feedback)
      }
    }));

    const response = await submitMessageFeedback({
      runId: message.runId,
      messageId,
      feedback
    });

    if (!response.ok) {
      setFeedbackByMessageId((current) => ({
        ...current,
        [messageId]: {
          status: "error",
          selected: feedback,
          message: normalizeFeedbackFailureMessage(response.error.message)
        }
      }));
      return;
    }

    setFeedbackByMessageId((current) => ({
      ...current,
      [messageId]: {
        status: "submitted",
        selected: response.data.feedback,
        message: getDefaultFeedbackMessage("submitted", response.data.feedback)
      }
    }));
  }

  async function handleRetry(message: TranscriptMessageModel) {
    if (!message.sourceQuestionPrompt || !message.runId || !onRetry) {
      return;
    }

    await onRetry({
      prompt: message.sourceQuestionPrompt,
      runId: message.runId,
      messageId: message.actionAnchorId ?? message.anchorId
    });
  }

  return (
    <div className="timeline-shell conversation-timeline-shell chat-stream-shell">
      {inlineStatusCopy ? <p className="conversation-inline-status detail-muted" role="status" aria-live="polite">{inlineStatusCopy}</p> : null}
      <div
        className="event-feed transcript-feed chat-stream-feed"
        ref={containerRef}
        onScroll={() => {
          const nearBottom = isNearBottom(containerRef.current);
          setAutoFollow(nearBottom);
        }}
      >
        {mergedMessages.length ? mergedMessages.map((message, index) => (
          <TranscriptMessageCard
            key={`${message.runId}:${message.id}`}
            message={message}
            animate={live
              && (presentationState.streamStatus === "connecting" || presentationState.streamStatus === "streaming" || presentationState.streamStatus === "reconnecting")
              && index === mergedMessages.length - 1
              && message.role === "assistant"}
            live={live}
            onCopy={handleCopy}
            onFeedback={handleFeedback}
            onRetry={handleRetry}
            onQuestionSubmit={onQuestionSubmit}
            questionSubmitDisabled={questionSubmitDisabled}
          />
        )) : <p className="empty-state chat-empty-state">{emptyText}</p>}
        {mergedMessages.length ? (
          <footer className={`transcript-summary transcript-summary-${transcriptSummary.tone}`} data-component="summary">
            <SummaryStatusDecoration tone={transcriptSummary.tone} />
            <div className="transcript-summary-content" data-section="content">
              <strong>{transcriptSummary.label}</strong>
              <p>{transcriptSummary.detail}</p>
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
