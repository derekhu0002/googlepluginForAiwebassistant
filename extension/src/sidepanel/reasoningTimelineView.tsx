import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { AnswerRecord, QuestionPayload, RunRecord } from "../shared/protocol";
import type { StreamConnectionState } from "../shared/types";
import {
  buildChatStreamItems,
  getTimelineCardStatus,
  getTimelineStatusCopy,
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
  onQuestionSubmit,
  questionSubmitDisabled
}: {
  item: ChatStreamItemModel;
  status: ReturnType<typeof getTimelineCardStatus>;
  animate: boolean;
  live: boolean;
  onQuestionSubmit?: (answer: { answer: string; choiceId?: string }) => void;
  questionSubmitDisabled?: boolean;
}) {
  const displayedSummary = useBufferedTypewriter(item.summary, animate);
  const isUser = item.kind === "user_prompt" || item.kind === "user_answer";
  const roleLabel = isUser ? "You" : item.kind === "assistant_error" ? "Assistant failed" : "Assistant";
  const avatarLabel = item.kind === "assistant_question" ? "?" : item.kind === "assistant_error" ? "!" : isUser ? "你" : "AI";
  const messageText = displayedSummary || (item.kind === "assistant_progress" && live ? "正在生成回答…" : "");
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

        {messageText ? <p className={messageClassName}>{messageText}</p> : null}

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
  answers?: AnswerRecord[];
  live?: boolean;
  streamStatus?: StreamConnectionState["status"];
  runStatus?: RunRecord["status"];
  finalOutput?: string | null;
  errorMessage?: string | null;
  updatedAt?: string | null;
  pendingQuestionId?: string | null;
  emptyText?: string;
  onQuestionSubmit?: (answer: { answer: string; choiceId?: string }) => void;
  questionSubmitDisabled?: boolean;
}

/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-RENDERER */
/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-LIVE-HISTORY-UX */
export function ReasoningTimeline({
  runId,
  prompt,
  events,
  answers = [],
  live = false,
  streamStatus,
  runStatus,
  finalOutput,
  errorMessage,
  updatedAt,
  pendingQuestionId,
  emptyText = "暂无事件。",
  onQuestionSubmit,
  questionSubmitDisabled = false
}: ChatStreamViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoFollow, setAutoFollow] = useState(live);
  const [unreadCount, setUnreadCount] = useState(0);
  const previousSignatureRef = useRef<string>("");
  const items = useMemo(() => buildChatStreamItems({
    runId,
    prompt,
    events,
    answers,
    finalOutput,
    errorMessage,
    status: runStatus,
    updatedAt,
    pendingQuestionId
  }), [answers, errorMessage, events, finalOutput, pendingQuestionId, prompt, runId, runStatus, updatedAt]);

  useEffect(() => {
    setAutoFollow(live);
  }, [live]);

  useEffect(() => {
    const signature = items.map((item) => `${item.id}:${item.summary.length}:${item.processItems.length}:${item.updatedAt}`).join("|");
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
  }, [autoFollow, items, live]);

  function scrollToLatest() {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    setAutoFollow(true);
    setUnreadCount(0);
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
        {items.length ? items.map((item, index) => (
          <ChatStreamTurn
            key={`${item.id}:${item.updatedAt}`}
            item={item}
            status={getTimelineCardStatus({
              type: item.primaryType === "user_prompt" || item.primaryType === "user_answer" ? "result" : item.primaryType,
              isLast: index === items.length - 1,
              live,
              streamStatus,
              runStatus
            })}
            animate={live
              && (streamStatus === "connecting" || streamStatus === "streaming" || streamStatus === "reconnecting")
              && index === items.length - 1
              && (item.kind === "assistant_progress" || item.kind === "assistant_result")}
            live={live}
            onQuestionSubmit={item.kind === "assistant_question" ? onQuestionSubmit : undefined}
            questionSubmitDisabled={questionSubmitDisabled}
          />
        )) : <p className="empty-state chat-empty-state">{emptyText}</p>}
      </div>

      {live ? (
        <div className="timeline-toolbar chat-stream-toolbar">
          <small className="detail-muted">{getTimelineStatusCopy(runStatus)}</small>
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
