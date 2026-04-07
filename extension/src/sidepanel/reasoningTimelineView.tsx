import { useEffect, useMemo, useRef, useState } from "react";
import type { NormalizedEventType, NormalizedRunEvent, RunRecord } from "../shared/protocol";
import type { StreamConnectionState } from "../shared/types";
import {
  buildConversationTurns,
  getTimelineCardStatus,
  getTimelineStatusCopy,
  type ConversationTurnModel,
  type TimelineCardModel,
  type TimelineEventEntry
} from "./reasoningTimeline";

const TYPEWRITER_EVENT_TYPES = new Set<NormalizedEventType>(["thinking"]);
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

function getProcessStepLabel(entry: TimelineEventEntry) {
  const rawLabel = (entry.message || entry.title || "").trim();
  if (!rawLabel) {
    return "Called assistant step";
  }

  const normalizedLabel = rawLabel
    .replace(/^called\s+/i, "")
    .replace(/^已?调用[:：]?/u, "")
    .replace(/[。.]$/u, "")
    .trim();

  return normalizedLabel ? `Called ${normalizedLabel}` : "Called assistant step";
}

function getProcessEntries(items: TimelineCardModel[]) {
  return items.flatMap((item) => item.entries).filter((entry) => Boolean((entry.message || entry.title || "").trim()));
}

function ProcessLayer({ items }: { items: TimelineCardModel[] }) {
  const entries = useMemo(() => getProcessEntries(items), [items]);

  if (!entries.length) {
    return null;
  }

  return (
    <div className="conversation-process-layer">
      <ol className="conversation-process-list">
        {entries.map((entry) => (
          <li key={entry.id} className="conversation-process-item">
            <span className="conversation-process-copy">{getProcessStepLabel(entry)}</span>
            <small>{formatTimestamp(entry.createdAt)}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ConversationTurn({
  turn,
  status,
  animate,
  live
}: {
  turn: ConversationTurnModel;
  status: ReturnType<typeof getTimelineCardStatus>;
  animate: boolean;
  live: boolean;
}) {
  const displayedSummary = useBufferedTypewriter(turn.summary, animate && TYPEWRITER_EVENT_TYPES.has(turn.primaryType));
  const roleLabel = turn.kind === "question" ? "Assistant needs input" : turn.kind === "error" ? "Assistant failed" : "Assistant";
  const isProcessing = live && status === "active" && turn.kind === "assistant";
  const hasFinalReply = turn.kind === "assistant" && turn.primaryType === "result";
  const messageText = turn.kind === "assistant"
    ? (hasFinalReply ? displayedSummary : (live ? "正在生成回答…" : displayedSummary || "尚未形成最终回答。"))
    : displayedSummary;
  const messageClassName = [
    "conversation-message",
    turn.kind === "assistant" && !hasFinalReply ? "conversation-message-muted" : ""
  ].filter(Boolean).join(" ");

  return (
    <article className={`conversation-turn turn-${turn.kind} is-${status}`}>
      <div className="conversation-avatar" aria-hidden="true">
        {turn.kind === "question" ? "?" : turn.kind === "error" ? "!" : "AI"}
      </div>
      <div className="conversation-bubble">
        <div className="conversation-turn-header">
          <div className="conversation-turn-heading">
            <strong>{roleLabel}</strong>
            <span className={`status-chip status-${status}`}>{getStatusLabel(status)}</span>
          </div>
          <small>{formatTimestamp(turn.updatedAt)}</small>
        </div>

        {turn.processItems.length ? <ProcessLayer items={turn.processItems} /> : null}

        {messageText ? <p className={messageClassName}>{messageText}</p> : null}

        {isProcessing && !messageText ? (
          <p className="conversation-message conversation-message-muted">助手正在组织回答…</p>
        ) : null}
      </div>
    </article>
  );
}

export interface ReasoningTimelineProps {
  events: NormalizedRunEvent[];
  live?: boolean;
  streamStatus?: StreamConnectionState["status"];
  runStatus?: RunRecord["status"];
  emptyText?: string;
}

/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-RENDERER */
/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-LIVE-HISTORY-UX */
export function ReasoningTimeline({
  events,
  live = false,
  streamStatus,
  runStatus,
  emptyText = "暂无事件。"
}: ReasoningTimelineProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoFollow, setAutoFollow] = useState(live);
  const [unreadCount, setUnreadCount] = useState(0);
  const previousSignatureRef = useRef<string>("");
  const turns = useMemo(() => buildConversationTurns(events), [events]);

  useEffect(() => {
    setAutoFollow(live);
  }, [live]);

  useEffect(() => {
    const signature = turns.map((turn) => `${turn.id}:${turn.summary.length}:${turn.processItems.length}:${turn.updatedAt}`).join("|");
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
  }, [autoFollow, live, turns]);

  function scrollToLatest() {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    setAutoFollow(true);
    setUnreadCount(0);
  }

  return (
    <div className="timeline-shell conversation-timeline-shell">
      <div
        className="event-feed reasoning-timeline conversation-thread"
        ref={containerRef}
        onScroll={() => {
          const nearBottom = isNearBottom(containerRef.current);
          setAutoFollow(nearBottom);
          if (nearBottom) {
            setUnreadCount(0);
          }
        }}
      >
        {turns.length ? turns.map((turn, index) => (
          <ConversationTurn
            key={`${turn.id}:${turn.updatedAt}`}
            turn={turn}
            status={getTimelineCardStatus({
              type: turn.primaryType,
              isLast: index === turns.length - 1,
              live,
              streamStatus,
              runStatus
            })}
            animate={live && index === turns.length - 1}
            live={live}
          />
        )) : <p className="empty-state">{emptyText}</p>}
      </div>

      {live ? (
        <div className="timeline-toolbar">
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
