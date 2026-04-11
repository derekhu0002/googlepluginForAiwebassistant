import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import ReactMarkdown from "react-markdown";
import { submitMessageFeedback } from "../shared/api";
import type { AnswerRecord, MessageFeedbackValue, QuestionPayload, RunRecord } from "../shared/protocol";
import type { MessageFeedbackUiState, StreamConnectionState } from "../shared/types";
import {
  buildTranscriptPartStream,
  getDefaultFeedbackMessage,
  resolveTimelinePresentationState,
  type BuildChatStreamItemsOptions,
  type TranscriptPartModel
} from "./reasoningTimeline";

const GENERIC_STREAMING_COPY = "正在继续…";

function isNearBottom(element: HTMLDivElement | null) {
  if (!element) {
    return true;
  }

  return element.scrollHeight - element.scrollTop - element.clientHeight <= 32;
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

function PartActions({
  part,
  onCopy,
  onRetry,
  onFeedback
}: {
  part: TranscriptPartModel;
  onCopy: (part: TranscriptPartModel) => void | Promise<void>;
  onRetry?: (part: TranscriptPartModel) => void | Promise<void>;
  onFeedback?: (part: TranscriptPartModel, feedback: MessageFeedbackValue) => void | Promise<void>;
}) {
  if (!part.supportsCopy && !part.supportsRetry && !part.supportsFeedback) {
    return null;
  }

  return (
    <div className="transcript-part-footer-actions" aria-label="part actions">
      {part.supportsCopy ? (
        <button type="button" className="icon-button" aria-label="复制" title="复制" onClick={() => onCopy(part)}>
          <CopyIcon />
        </button>
      ) : null}
      {part.supportsFeedback ? (
        <>
          <button
            type="button"
            className={`icon-button ${part.feedbackState?.selected === "like" && part.feedbackState?.status === "submitted" ? "is-selected" : ""}`}
            aria-label="点赞"
            title="点赞"
            disabled={part.feedbackState?.status === "submitting"}
            onClick={() => onFeedback?.(part, "like")}
          >
            <LikeIcon />
          </button>
          <button
            type="button"
            className={`icon-button ${part.feedbackState?.selected === "dislike" && part.feedbackState?.status === "submitted" ? "is-selected" : ""}`}
            aria-label="点踩"
            title="点踩"
            disabled={part.feedbackState?.status === "submitting"}
            onClick={() => onFeedback?.(part, "dislike")}
          >
            <DislikeIcon />
          </button>
        </>
      ) : null}
      {part.supportsRetry ? (
        <button type="button" className="icon-button" aria-label="重试" title="重试" onClick={() => onRetry?.(part)}>
          <RetryIcon />
        </button>
      ) : null}
    </div>
  );
}

function TranscriptPartBlock({
  part,
  animate,
  live,
  onCopy,
  onRetry,
  onFeedback,
  onQuestionSubmit,
  questionSubmitDisabled
}: {
  part: TranscriptPartModel;
  animate: boolean;
  live: boolean;
  onCopy: (part: TranscriptPartModel) => void | Promise<void>;
  onRetry?: (part: TranscriptPartModel) => void | Promise<void>;
  onFeedback?: (part: TranscriptPartModel, feedback: MessageFeedbackValue) => void | Promise<void>;
  onQuestionSubmit?: (answer: { answer: string; choiceId?: string }) => void;
  questionSubmitDisabled?: boolean;
}) {
  const isUser = part.role === "user";
  const showStreamingIndicator = live && part.kind === "text" && animate;
  const feedbackMessage = part.feedbackState?.message || getDefaultFeedbackMessage(part.feedbackState?.status ?? "idle", part.feedbackState?.selected);
  const messageClassName = [
    "transcript-part-copy",
    "markdown-body",
    part.kind === "reasoning" ? "transcript-part-muted" : ""
  ].filter(Boolean).join(" ");
  const toolLabel = part.kind === "tool" ? "工具" : part.kind === "reasoning" ? "分析" : null;

  return (
    <section
      className={`transcript-part transcript-part-${part.kind}`}
      data-section="part"
      data-part-kind={part.kind}
      data-part-anchor={part.anchorId}
      data-part-role={part.role}
      data-part-type={part.kind === "summary" ? "summary" : undefined}
      data-component={part.kind === "summary" ? "summary" : undefined}
    >
      <div className="transcript-part-decoration" data-section="decoration" aria-hidden="true">
        <span className="transcript-part-anchor" data-tone={part.tone ?? undefined} />
        <span className="transcript-part-rail" />
      </div>
      <div className="transcript-part-body" data-section="content">
        {part.kind === "summary" ? (
          <>
            <p className="transcript-part-copy transcript-part-summary-copy" data-section="copy">{part.text}</p>
            {part.detail ? <p className="transcript-part-detail">{part.detail}</p> : null}
          </>
        ) : (
          <>
            {showStreamingIndicator ? <span className="streaming-indicator">生成中</span> : null}
            {toolLabel ? <span className="transcript-part-label">{toolLabel}</span> : null}
            {part.text ? (
              isUser
                ? <p className="transcript-part-copy">{part.text}</p>
                : <MarkdownMessage text={part.text} className={messageClassName} />
            ) : null}

            {part.kind === "question" && part.question && part.pendingQuestion && onQuestionSubmit ? (
              <InlineQuestionComposer question={part.question} disabled={questionSubmitDisabled} onSubmit={onQuestionSubmit} />
            ) : null}

            <PartActions part={part} onCopy={onCopy} onRetry={onRetry} onFeedback={onFeedback} />
            {feedbackMessage && part.supportsFeedback ? (
              <small className={`feedback-status feedback-${part.feedbackState?.status ?? "idle"}`}>{feedbackMessage}</small>
            ) : null}
          </>
        )}
      </div>
    </section>
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

  const parts = useMemo(() => {
    const base = buildTranscriptPartStream({
      runId,
      prompt,
      events,
      answers,
      feedbackByMessageId,
      finalOutput,
      errorMessage,
      status: runStatus,
      runStatus,
      streamStatus,
      updatedAt,
      pendingQuestionId
    });

    const merged = runSegments?.length
      ? runSegments.flatMap((segment, index) => buildTranscriptPartStream({
        ...segment,
        feedbackByMessageId,
        runStatus: segment.status,
        streamStatus: segment.runId === runId ? streamStatus : undefined,
        includeSummary: index === runSegments.length - 1
      }))
      : base;

    return merged.length ? merged : base;
  }, [answers, errorMessage, events, feedbackByMessageId, finalOutput, pendingQuestionId, prompt, runId, runSegments, runStatus, streamStatus, updatedAt]);

  const inlineStatusCopy = useMemo(() => {
    const hasAssistantTextPart = parts.some((part) => part.role === "assistant" && part.kind === "text" && part.text.trim());

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
  }, [live, parts, pendingQuestionId, presentationState.runStatus, presentationState.streamStatus]);

  useEffect(() => {
    setFeedbackByMessageId({});
  }, [runId]);

  useEffect(() => {
    setAutoFollow(live);
  }, [live]);

  useEffect(() => {
    const signature = parts.map((part) => `${part.id}:${part.text.length}:${part.updatedAt}`).join("|");
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
  }, [autoFollow, live, parts]);

  async function handleCopy(part: TranscriptPartModel) {
    const text = [part.text.trim(), part.detail?.trim() || ""].filter(Boolean).join("\n\n");
    if (!text) {
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  }

  async function handleFeedback(part: TranscriptPartModel, feedback: MessageFeedbackValue) {
    const messageId = part.actionAnchorId ?? part.anchorId;
    setFeedbackByMessageId((current) => ({
      ...current,
      [messageId]: {
        status: "submitting",
        selected: feedback,
        message: getDefaultFeedbackMessage("submitting", feedback)
      }
    }));

    const response = await submitMessageFeedback({
      runId: part.runId,
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

  async function handleRetry(part: TranscriptPartModel) {
    if (!part.sourceQuestionPrompt || !part.runId || !onRetry) {
      return;
    }

    await onRetry({
      prompt: part.sourceQuestionPrompt,
      runId: part.runId,
      messageId: part.actionAnchorId ?? part.anchorId
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
        {parts.length ? parts.map((part, index) => (
          <TranscriptPartBlock
            key={`${part.runId}:${part.id}:${index}`}
            part={part}
            animate={live
              && (presentationState.streamStatus === "connecting" || presentationState.streamStatus === "streaming" || presentationState.streamStatus === "reconnecting")
              && index === parts.length - 2
              && part.role === "assistant"
              && part.kind === "text"}
            live={live}
            onCopy={handleCopy}
            onFeedback={handleFeedback}
            onRetry={handleRetry}
            onQuestionSubmit={onQuestionSubmit}
            questionSubmitDisabled={questionSubmitDisabled}
          />
        )) : <p className="empty-state chat-empty-state">{emptyText}</p>}
      </div>
    </div>
  );
}
