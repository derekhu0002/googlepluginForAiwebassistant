import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import ReactMarkdown from "react-markdown";
import { submitMessageFeedback } from "../shared/api";
import type { AnswerRecord, MessageFeedbackValue, QuestionPayload, RunRecord } from "../shared/protocol";
import type { MessageFeedbackUiState, StreamConnectionState } from "../shared/types";
import {
  buildTranscriptPartStream,
  getDefaultFeedbackMessage,
  resolveTimelinePresentationState,
  type BuildChatStreamItemsOptions,
  type TranscriptMessageModel,
  type TranscriptPartModel,
  type TranscriptReadModel,
  type TranscriptTailPatchModel
} from "./reasoningTimeline";
import { deriveTranscriptTraceCorrelation } from "../shared/protocol";
import { useScrollFollowController } from "./useScrollFollowController";

const MAX_MARKDOWN_FPS = 30;
const MIN_MARKDOWN_FRAME_MS = 1000 / MAX_MARKDOWN_FPS;

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
  onCopy,
  onRetry,
  onFeedback,
  onQuestionSubmit,
  questionSubmitDisabled
}: {
  part: TranscriptPartModel;
  onCopy: (part: TranscriptPartModel) => void | Promise<void>;
  onRetry?: (part: TranscriptPartModel) => void | Promise<void>;
  onFeedback?: (part: TranscriptPartModel, feedback: MessageFeedbackValue) => void | Promise<void>;
  onQuestionSubmit?: (answer: { answer: string; choiceId?: string }) => void;
  questionSubmitDisabled?: boolean;
}) {
  const isUser = part.role === "user";
  const hasMessageActions = part.supportsCopy || part.supportsRetry || part.supportsFeedback;
  const feedbackMessage = part.feedbackState?.message || getDefaultFeedbackMessage(part.feedbackState?.status ?? "idle", part.feedbackState?.selected);
  const messageClassName = [
    "transcript-part-copy",
    isUser ? "transcript-part-copy-user" : "transcript-part-copy-assistant",
    "markdown-body",
    part.kind === "reasoning" ? "transcript-part-muted" : ""
  ].filter(Boolean).join(" ");
  return (
    <section
      className={`transcript-part transcript-part-${part.kind} ${isUser ? "transcript-part-user" : "transcript-part-assistant"} ${hasMessageActions ? "transcript-part-has-actions" : ""}`}
      data-section="part"
      data-part-kind={part.kind}
      data-part-anchor={part.anchorId}
      data-part-role={part.role}
      data-part-type={part.kind === "summary" ? "summary" : undefined}
      data-component={part.kind === "summary" ? "summary" : undefined}
      data-has-message-actions={hasMessageActions ? "true" : undefined}
      tabIndex={hasMessageActions ? 0 : undefined}
    >
      <div className={`transcript-part-body ${isUser ? "transcript-part-body-user" : "transcript-part-body-assistant"}`} data-section="content">
        {part.kind === "summary" ? (
          <>
            <p className="transcript-part-copy transcript-part-summary-copy" data-section="copy">{part.text}</p>
            {part.detail ? <p className="transcript-part-detail">{part.detail}</p> : null}
          </>
        ) : (
          <>
            {part.text ? (
              isUser
                ? <p className="transcript-part-copy transcript-part-copy-user">{part.text}</p>
                : <MarkdownMessage text={part.text} className={messageClassName} />
            ) : null}
            {part.kind === "question" && part.question && part.pendingQuestion && onQuestionSubmit && !questionSubmitDisabled ? (
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

const MemoTranscriptPartBlock = memo(TranscriptPartBlock, (previous, next) => previous.part === next.part && previous.questionSubmitDisabled === next.questionSubmitDisabled);

function applyFeedbackStateToPart(part: TranscriptPartModel, feedbackByMessageId: Record<string, MessageFeedbackUiState>) {
  if (!part.supportsFeedback) {
    return part;
  }

  const messageId = part.actionAnchorId ?? part.anchorId;
  const nextFeedbackState = feedbackByMessageId[messageId];
  return nextFeedbackState ? { ...part, feedbackState: nextFeedbackState } : part;
}

function applyFeedbackStateToMessages(messages: TranscriptMessageModel[], feedbackByMessageId: Record<string, MessageFeedbackUiState>) {
  if (!Object.keys(feedbackByMessageId).length) {
    return messages;
  }

  return messages.map((message) => {
    let changed = false;
    const nextParts = message.parts.map((part) => {
      const nextPart = applyFeedbackStateToPart(part, feedbackByMessageId);
      changed = changed || nextPart !== part;
      return nextPart;
    });

    return changed ? { ...message, parts: nextParts } : message;
  });
}

function HistoricalMessageBlock({
  message,
  onCopy,
  onRetry,
  onFeedback,
  onQuestionSubmit,
  questionSubmitDisabled
}: {
  message: TranscriptMessageModel;
  onCopy: (part: TranscriptPartModel) => void | Promise<void>;
  onRetry?: (part: TranscriptPartModel) => void | Promise<void>;
  onFeedback?: (part: TranscriptPartModel, feedback: MessageFeedbackValue) => void | Promise<void>;
  onQuestionSubmit?: (answer: { answer: string; choiceId?: string }) => void;
  questionSubmitDisabled?: boolean;
}) {
  return (
    <article className={`transcript-message transcript-message-${message.role}`} data-message-id={message.id} data-message-role={message.role}>
      {message.parts.map((part) => (
        <MemoTranscriptPartBlock
          key={part.id}
          part={part}
          onCopy={onCopy}
          onRetry={onRetry}
          onFeedback={onFeedback}
          onQuestionSubmit={onQuestionSubmit}
          questionSubmitDisabled={questionSubmitDisabled}
        />
      ))}
    </article>
  );
}

const MemoHistoricalMessageBlock = memo(HistoricalMessageBlock, (previous, next) => previous.message === next.message && previous.questionSubmitDisabled === next.questionSubmitDisabled);

function HistoricalTranscriptList({
  messages,
  onCopy,
  onRetry,
  onFeedback,
  onQuestionSubmit,
  questionSubmitDisabled
}: {
  messages: TranscriptMessageModel[];
  onCopy: (part: TranscriptPartModel) => void | Promise<void>;
  onRetry?: (part: TranscriptPartModel) => void | Promise<void>;
  onFeedback?: (part: TranscriptPartModel, feedback: MessageFeedbackValue) => void | Promise<void>;
  onQuestionSubmit?: (answer: { answer: string; choiceId?: string }) => void;
  questionSubmitDisabled?: boolean;
}) {
  return (
    <div data-component="historical-transcript-list">
      {messages.map((message) => (
        <MemoHistoricalMessageBlock
          key={message.id}
          message={message}
          onCopy={onCopy}
          onRetry={onRetry}
          onFeedback={onFeedback}
          onQuestionSubmit={onQuestionSubmit}
          questionSubmitDisabled={questionSubmitDisabled}
        />
      ))}
    </div>
  );
}

const MemoHistoricalTranscriptList = memo(HistoricalTranscriptList, (previous, next) => previous.messages === next.messages && previous.questionSubmitDisabled === next.questionSubmitDisabled);

function ProcessStream({
  parts,
  onCopy,
  onRetry,
  onFeedback,
  onQuestionSubmit,
  questionSubmitDisabled
}: {
  parts: TranscriptPartModel[];
  onCopy: (part: TranscriptPartModel) => void | Promise<void>;
  onRetry?: (part: TranscriptPartModel) => void | Promise<void>;
  onFeedback?: (part: TranscriptPartModel, feedback: MessageFeedbackValue) => void | Promise<void>;
  onQuestionSubmit?: (answer: { answer: string; choiceId?: string }) => void;
  questionSubmitDisabled?: boolean;
}) {
  if (!parts.length) {
    return null;
  }

  return (
    <section className="conversation-process-stream" data-component="process-stream">
      <div className="conversation-process-list">
        {parts.map((part) => (
          <MemoTranscriptPartBlock
            key={part.id}
            part={part}
            onCopy={onCopy}
            onRetry={onRetry}
            onFeedback={onFeedback}
            onQuestionSubmit={onQuestionSubmit}
            questionSubmitDisabled={questionSubmitDisabled}
          />
        ))}
      </div>
    </section>
  );
}

function ActiveTailRenderer({
  messageId,
  part,
  tailPatch,
  terminalState,
  onFrameRendered,
  onCopy,
  onRetry,
  onFeedback,
  onQuestionSubmit,
  questionSubmitDisabled
}: {
  messageId: string;
  part: TranscriptPartModel;
  tailPatch: TranscriptTailPatchModel | null;
  terminalState: boolean;
  onFrameRendered?: (revision: string) => void;
  onCopy: (part: TranscriptPartModel) => void | Promise<void>;
  onRetry?: (part: TranscriptPartModel) => void | Promise<void>;
  onFeedback?: (part: TranscriptPartModel, feedback: MessageFeedbackValue) => void | Promise<void>;
  onQuestionSubmit?: (answer: { answer: string; choiceId?: string }) => void;
  questionSubmitDisabled?: boolean;
}) {
  const [renderedText, setRenderedText] = useState(tailPatch?.fullText ?? part.text);
  const frameRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFlushAtRef = useRef(0);
  const pendingTextRef = useRef(tailPatch?.fullText ?? part.text);

  const clearScheduledWork = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const flush = useCallback((revision: string) => {
    clearScheduledWork();
    lastFlushAtRef.current = performance.now();
    setRenderedText(pendingTextRef.current);
    onFrameRendered?.(revision);
  }, [clearScheduledWork, onFrameRendered]);

  useEffect(() => {
    pendingTextRef.current = tailPatch?.fullText ?? part.text;
    const revision = tailPatch?.revision ?? `${messageId}:${part.updatedAt}`;
    flush(terminalState || tailPatch?.terminal ? `${revision}:terminal` : revision);

    return () => {
      clearScheduledWork();
    };
  }, [clearScheduledWork, flush, messageId, part.text, part.updatedAt, tailPatch?.fullText, tailPatch?.revision, tailPatch?.terminal, terminalState]);

  const renderedPart = useMemo(() => ({
    ...part,
    text: renderedText,
    updatedAt: tailPatch?.updatedAt ?? part.updatedAt
  }), [part, renderedText, tailPatch?.updatedAt]);

  return (
    <div data-component="active-tail-renderer" data-tail-revision={tailPatch?.revision ?? "sealed"}>
      <MemoTranscriptPartBlock
        part={renderedPart}
        onCopy={onCopy}
        onRetry={onRetry}
        onFeedback={onFeedback}
        onQuestionSubmit={onQuestionSubmit}
        questionSubmitDisabled={questionSubmitDisabled}
      />
    </div>
  );
}

function FinalAnswerPanel({
  activeMessageId,
  finalAnswerPart,
  tailPatch,
  terminalState,
  onFrameRendered,
  onCopy,
  onRetry,
  onFeedback,
  onQuestionSubmit,
  questionSubmitDisabled
}: {
  activeMessageId: string | null;
  finalAnswerPart: TranscriptPartModel | null;
  tailPatch: TranscriptTailPatchModel | null;
  terminalState: boolean;
  onFrameRendered?: (revision: string) => void;
  onCopy: (part: TranscriptPartModel) => void | Promise<void>;
  onRetry?: (part: TranscriptPartModel) => void | Promise<void>;
  onFeedback?: (part: TranscriptPartModel, feedback: MessageFeedbackValue) => void | Promise<void>;
  onQuestionSubmit?: (answer: { answer: string; choiceId?: string }) => void;
  questionSubmitDisabled?: boolean;
}) {
  if (!finalAnswerPart) {
    return null;
  }

  return (
    <section className="conversation-final-answer-panel" data-component="final-answer-panel">
      {tailPatch && activeMessageId ? (
        <ActiveTailRenderer
          messageId={activeMessageId}
          part={finalAnswerPart}
          tailPatch={tailPatch}
          terminalState={terminalState}
          onFrameRendered={onFrameRendered}
          onCopy={onCopy}
          onRetry={onRetry}
          onFeedback={onFeedback}
          onQuestionSubmit={onQuestionSubmit}
          questionSubmitDisabled={questionSubmitDisabled}
        />
      ) : (
        <MemoTranscriptPartBlock
          part={finalAnswerPart}
          onCopy={onCopy}
          onRetry={onRetry}
          onFeedback={onFeedback}
          onQuestionSubmit={onQuestionSubmit}
          questionSubmitDisabled={questionSubmitDisabled}
        />
      )}
    </section>
  );
}

function LatestMessageButton({ visible, onClick }: { visible: boolean; onClick: () => void; }) {
  if (!visible) {
    return null;
  }

  return (
    <button type="button" className="secondary latest-message-button" data-component="latest-message-button" onClick={onClick}>
      ⬇ 最新消息
    </button>
  );
}

function buildRenderTrace(details: {
  runId: string | null | undefined;
  transcriptReadModel?: TranscriptReadModel | null;
  fallbackParts: TranscriptPartModel[];
  contentRevision: string;
  tailRenderRevision: string;
  projectedTranscriptPresent: boolean;
  presentationState: ReturnType<typeof resolveTimelinePresentationState>;
}): import("../shared/protocol").TranscriptTraceRecord[] {
  const runId = details.runId ?? details.transcriptReadModel?.summaryPart?.runId ?? details.fallbackParts[0]?.runId ?? "render";
  const renderBaseCorrelation = details.transcriptReadModel?.finalAnswerPart
      ? deriveTranscriptTraceCorrelation({
        runId,
        id: details.transcriptReadModel.finalAnswerPart.anchorId,
        sequence: Number.NaN,
        message: details.transcriptReadModel.finalAnswerPart.text,
        canonical: { key: details.transcriptReadModel.finalAnswerPart.anchorId } as never,
        semantic: undefined,
        question: undefined,
        tool: undefined
      })
    : {
        runId,
        rawEventId: null,
        canonicalEventKey: details.transcriptReadModel?.activeAssistantMessageId ?? null,
        sequence: null,
        contentKey: details.contentRevision,
        contentPreview: details.fallbackParts[0]?.text.slice(0, 160) ?? ""
      };

  const stageRecords: import("../shared/protocol").TranscriptTraceRecord[] = [
    {
      stage: "render",
      step: "render_path",
      outcome: "info",
      createdAt: new Date().toISOString(),
      correlation: renderBaseCorrelation,
      details: {
        projectedTranscriptPresent: details.projectedTranscriptPresent,
        fallbackPartCount: details.fallbackParts.length,
        sealedMessageCount: details.transcriptReadModel?.sealedMessages.length ?? 0,
        activeMessageId: details.transcriptReadModel?.activeAssistantMessageId ?? null
      }
    },
    {
      stage: "render",
      step: "visible_order",
      outcome: "visible",
      createdAt: new Date().toISOString(),
      correlation: renderBaseCorrelation,
      details: {
        visiblePartIds: details.transcriptReadModel?.parts.map((part) => part.id) ?? details.fallbackParts.map((part) => part.id),
        summaryPartId: details.transcriptReadModel?.summaryPart?.id ?? null,
        contentRevision: details.contentRevision
      }
    },
    {
      stage: "render",
      step: "tail_revision",
      outcome: details.transcriptReadModel?.tailPatch ? "visible" : "info",
      createdAt: new Date().toISOString(),
      correlation: renderBaseCorrelation,
      details: {
        tailPatchRevision: details.transcriptReadModel?.tailPatch?.revision ?? null,
        tailRenderRevision: details.tailRenderRevision || null,
        terminalState: details.transcriptReadModel?.terminalState ?? details.presentationState.hasTerminalEvidence
      }
    }
  ];

  if (details.transcriptReadModel) {
    const projectedIds = new Set(details.transcriptReadModel.parts.map((part) => part.id));
    const renderedIds = new Set([
      ...details.transcriptReadModel.sealedMessages.flatMap((message) => message.parts.map((part) => part.id)),
      ...details.transcriptReadModel.processParts.map((part) => part.id),
      details.transcriptReadModel.finalAnswerPart?.id,
      details.transcriptReadModel.questionPart?.id,
      details.transcriptReadModel.errorPart?.id,
      details.transcriptReadModel.summaryPart?.id
    ].filter((value): value is string => Boolean(value)));
    const missingRenderedIds = [...projectedIds].filter((id) => !renderedIds.has(id));
    if (missingRenderedIds.length) {
      stageRecords.push({
        stage: "render",
        step: "projection_vs_render",
        outcome: "anomaly",
        createdAt: new Date().toISOString(),
        correlation: renderBaseCorrelation,
        details: {
          missingRenderedIds,
          projectedPartCount: projectedIds.size,
          renderedPartCount: renderedIds.size
        }
      });
    }
  }

  return stageRecords;
}

function ConversationViewport({
  activeParts,
  activeMessageId,
  processParts,
  finalAnswerPart,
  questionPart,
  errorPart,
  summaryPart,
  tailPatch,
  terminalState,
  onTailFrameRendered,
  onCopy,
  onRetry,
  onFeedback,
  onQuestionSubmit,
  questionSubmitDisabled
}: {
  activeParts: TranscriptPartModel[];
  activeMessageId: string | null;
  processParts: TranscriptPartModel[];
  finalAnswerPart: TranscriptPartModel | null;
  questionPart: TranscriptPartModel | null;
  errorPart: TranscriptPartModel | null;
  summaryPart: TranscriptPartModel | null;
  tailPatch: TranscriptTailPatchModel | null;
  terminalState: boolean;
  onTailFrameRendered: (revision: string) => void;
  onCopy: (part: TranscriptPartModel) => void | Promise<void>;
  onRetry?: (part: TranscriptPartModel) => void | Promise<void>;
  onFeedback?: (part: TranscriptPartModel, feedback: MessageFeedbackValue) => void | Promise<void>;
  onQuestionSubmit?: (answer: { answer: string; choiceId?: string }) => void;
  questionSubmitDisabled?: boolean;
}) {
  const orderedActiveParts = useMemo(
    () => activeParts.filter((part) => part.kind !== "summary"),
    [activeParts]
  );
  const finalAnswerIndex = finalAnswerPart
    ? orderedActiveParts.findIndex((part) => part.id === finalAnswerPart.id)
    : -1;
  const leadingParts = finalAnswerIndex >= 0
    ? orderedActiveParts.slice(0, finalAnswerIndex)
    : orderedActiveParts;
  const trailingParts = finalAnswerIndex >= 0
    ? orderedActiveParts.slice(finalAnswerIndex + 1)
    : [];

  return (
    <div className="conversation-viewport" data-component="conversation-viewport">
      <ProcessStream
        parts={leadingParts.length ? leadingParts : processParts}
        onCopy={onCopy}
        onRetry={onRetry}
        onFeedback={onFeedback}
        onQuestionSubmit={onQuestionSubmit}
        questionSubmitDisabled={questionSubmitDisabled}
      />
      <FinalAnswerPanel
        activeMessageId={activeMessageId}
        finalAnswerPart={finalAnswerPart}
        tailPatch={tailPatch}
        terminalState={terminalState}
        onFrameRendered={onTailFrameRendered}
        onCopy={onCopy}
        onRetry={onRetry}
        onFeedback={onFeedback}
        onQuestionSubmit={onQuestionSubmit}
        questionSubmitDisabled={questionSubmitDisabled}
      />
      {trailingParts.map((part) => (
        <MemoTranscriptPartBlock
          key={part.id}
          part={part}
          onCopy={onCopy}
          onRetry={onRetry}
          onFeedback={onFeedback}
          onQuestionSubmit={onQuestionSubmit}
          questionSubmitDisabled={questionSubmitDisabled}
        />
      ))}
      {!leadingParts.length && !trailingParts.length && questionPart ? (
        <MemoTranscriptPartBlock
          part={questionPart}
          onCopy={onCopy}
          onRetry={onRetry}
          onFeedback={onFeedback}
          onQuestionSubmit={onQuestionSubmit}
          questionSubmitDisabled={questionSubmitDisabled}
        />
      ) : null}
      {!leadingParts.length && !trailingParts.length && errorPart ? (
        <MemoTranscriptPartBlock
          part={errorPart}
          onCopy={onCopy}
          onRetry={onRetry}
          onFeedback={onFeedback}
          onQuestionSubmit={onQuestionSubmit}
          questionSubmitDisabled={questionSubmitDisabled}
        />
      ) : null}
      {summaryPart ? (
        <MemoTranscriptPartBlock
          part={summaryPart}
          onCopy={onCopy}
          onRetry={onRetry}
          onFeedback={onFeedback}
          onQuestionSubmit={onQuestionSubmit}
          questionSubmitDisabled={questionSubmitDisabled}
        />
      ) : null}
    </div>
  );
}

export interface ChatStreamViewProps {
  runId?: string | null;
  prompt?: string | null;
  events: import("../shared/protocol").NormalizedRunEvent[];
  runSegments?: BuildChatStreamItemsOptions[];
  transcriptReadModel?: TranscriptReadModel;
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
  onRenderTrace?: (traces: import("../shared/protocol").TranscriptTraceRecord[]) => void;
}

// @ArchitectureID: ELM-FUNC-EXT-RENDER-INCREMENTAL-TRANSCRIPT
// @ArchitectureID: ELM-APP-EXT-CONVERSATION-RENDERER
// @ArchitectureID: ELM-APP-EXT-CONVERSATION-LIVE-HISTORY-UX
// @ArchitectureID: ELM-REQ-OPENCODE-UX
// @ArchitectureID: ELM-FUNC-SP-ANALYZE-FINAL-TRANSCRIPT-RENDER
// @SoftwareUnitID: SU-SP-CONVERSATION-VIEWPORT
// @SoftwareUnitID: SU-SP-HISTORICAL-TRANSCRIPT-LIST
// @SoftwareUnitID: SU-SP-ACTIVE-TAIL-RENDERER
export function ReasoningTimeline({
  runId,
  prompt,
  events,
  runSegments,
  transcriptReadModel,
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
  questionSubmitDisabled = false,
  onRenderTrace
}: ChatStreamViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeMessageRef = useRef<HTMLElement | null>(null);
  const [feedbackByMessageId, setFeedbackByMessageId] = useState<Record<string, MessageFeedbackUiState>>({});
  const [tailRenderRevision, setTailRenderRevision] = useState("");

  const presentationState = useMemo(() => resolveTimelinePresentationState({
    events,
    runStatus,
    streamStatus,
    finalOutput,
    errorMessage
  }), [errorMessage, events, finalOutput, runStatus, streamStatus]);

  const fallbackParts = useMemo(() => {
    if (transcriptReadModel) {
      return [] as TranscriptPartModel[];
    }

    if (runSegments?.length) {
      const merged = runSegments.flatMap((segment, index) => buildTranscriptPartStream({
        ...segment,
        feedbackByMessageId,
        runStatus: segment.status,
        streamStatus: segment.runId === runId ? streamStatus : undefined,
        includeSummary: index === runSegments.length - 1,
        includeToolCallParts: segment.includeToolCallParts ?? false
      }));

      if (merged.length) {
        return merged;
      }
    }

    return buildTranscriptPartStream({
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
      pendingQuestionId,
      includeToolCallParts: false
    });
  }, [answers, errorMessage, events, feedbackByMessageId, finalOutput, pendingQuestionId, prompt, runId, runSegments, runStatus, streamStatus, transcriptReadModel, updatedAt]);

  const projectedTranscript = useMemo(() => {
    if (!transcriptReadModel) {
      return null;
    }

    const sealedMessages = applyFeedbackStateToMessages(transcriptReadModel.sealedMessages, feedbackByMessageId);
    const activeParts = transcriptReadModel.activeMessage?.parts.map((part) => applyFeedbackStateToPart(part, feedbackByMessageId)) ?? [];
    const processParts = transcriptReadModel.processParts.map((part) => applyFeedbackStateToPart(part, feedbackByMessageId));
    const finalAnswerPart = transcriptReadModel.finalAnswerPart ? applyFeedbackStateToPart(transcriptReadModel.finalAnswerPart, feedbackByMessageId) : null;
    const questionPart = transcriptReadModel.questionPart ? applyFeedbackStateToPart(transcriptReadModel.questionPart, feedbackByMessageId) : null;
    const errorPart = transcriptReadModel.errorPart ? applyFeedbackStateToPart(transcriptReadModel.errorPart, feedbackByMessageId) : null;

    return {
      sealedMessages,
      activeParts,
      activeMessageId: transcriptReadModel.activeAssistantMessageId,
      processParts,
      finalAnswerPart,
      questionPart,
      errorPart,
      summaryPart: transcriptReadModel.summaryPart,
      tailPatch: transcriptReadModel.tailPatch,
      terminalState: transcriptReadModel.terminalState,
      contentRevision: [
        transcriptReadModel.historicalSignature,
        transcriptReadModel.tailPatch?.revision ?? "sealed",
        transcriptReadModel.summaryPart?.id ?? "no-summary",
        tailRenderRevision
      ].join("::")
    };
  }, [feedbackByMessageId, tailRenderRevision, transcriptReadModel]);

  useEffect(() => {
    setFeedbackByMessageId({});
  }, [runId]);

  const contentRevision = projectedTranscript?.contentRevision
    ?? fallbackParts.map((part) => `${part.id}:${part.text.length}:${part.updatedAt}`).join("|");

  useEffect(() => {
    onRenderTrace?.(buildRenderTrace({
      runId,
      transcriptReadModel: transcriptReadModel ?? null,
      fallbackParts,
      contentRevision,
      tailRenderRevision,
      projectedTranscriptPresent: Boolean(projectedTranscript),
      presentationState
    }));
  }, [contentRevision, fallbackParts, onRenderTrace, presentationState, projectedTranscript, runId, tailRenderRevision, transcriptReadModel]);

  const scrollFollow = useScrollFollowController({
    containerRef,
    activeMessageRef,
    live,
    contentRevision,
    activeMessageId: projectedTranscript?.activeMessageId ?? null
  });

  const handleCopy = useCallback(async (part: TranscriptPartModel) => {
    const text = [part.text.trim(), part.detail?.trim() || ""].filter(Boolean).join("\n\n");
    if (!text) {
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  }, []);

  const handleFeedback = useCallback(async (part: TranscriptPartModel, feedback: MessageFeedbackValue) => {
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
  }, []);

  const handleRetry = useCallback(async (part: TranscriptPartModel) => {
    if (!part.sourceQuestionPrompt || !part.runId || !onRetry) {
      return;
    }

    await onRetry({
      prompt: part.sourceQuestionPrompt,
      runId: part.runId,
      messageId: part.actionAnchorId ?? part.anchorId
    });
  }, [onRetry]);

  const renderedFallback = fallbackParts.length ? fallbackParts.map((part) => (
    <MemoTranscriptPartBlock
      key={part.id}
      part={part}
      onCopy={handleCopy}
      onFeedback={handleFeedback}
      onRetry={handleRetry}
      onQuestionSubmit={onQuestionSubmit}
      questionSubmitDisabled={questionSubmitDisabled}
    />
  )) : <p className="empty-state chat-empty-state">{emptyText}</p>;

  return (
    <div className="timeline-shell conversation-timeline-shell chat-stream-shell">
      <div
        className="event-feed transcript-feed chat-stream-feed"
        ref={containerRef}
        onScroll={scrollFollow.handleScroll}
      >
        {projectedTranscript ? (
          <>
            <MemoHistoricalTranscriptList
              messages={projectedTranscript.sealedMessages}
              onCopy={handleCopy}
              onFeedback={handleFeedback}
              onRetry={handleRetry}
              onQuestionSubmit={onQuestionSubmit}
              questionSubmitDisabled={questionSubmitDisabled}
            />
            {(projectedTranscript.finalAnswerPart || projectedTranscript.processParts.length || projectedTranscript.questionPart || projectedTranscript.errorPart || projectedTranscript.summaryPart) ? (
              <article
                className="transcript-message transcript-message-assistant transcript-message-active"
                data-message-id={projectedTranscript.activeMessageId ?? "sealed-assistant"}
                data-message-role="assistant"
                data-active-message={projectedTranscript.tailPatch ? "true" : undefined}
                ref={activeMessageRef}
              >
                <ConversationViewport
                  activeParts={projectedTranscript.activeParts}
                  activeMessageId={projectedTranscript.activeMessageId}
                  processParts={projectedTranscript.processParts}
                  finalAnswerPart={projectedTranscript.finalAnswerPart}
                  questionPart={projectedTranscript.questionPart}
                  errorPart={projectedTranscript.errorPart}
                  summaryPart={projectedTranscript.summaryPart}
                  tailPatch={projectedTranscript.tailPatch}
                  terminalState={projectedTranscript.terminalState || presentationState.hasTerminalEvidence}
                  onTailFrameRendered={setTailRenderRevision}
                  onCopy={handleCopy}
                  onFeedback={handleFeedback}
                  onRetry={handleRetry}
                  onQuestionSubmit={onQuestionSubmit}
                  questionSubmitDisabled={questionSubmitDisabled}
                />
              </article>
            ) : null}
          </>
        ) : renderedFallback}
      </div>
      <LatestMessageButton visible={scrollFollow.showLatestMessageButton} onClick={scrollFollow.resumeFollow} />
    </div>
  );
}
