import { useEffect, useMemo, useRef, useState } from "react";
import { extensionConfig } from "../shared/config";
import type { NormalizedEventType, NormalizedRunEvent, RunRecord } from "../shared/protocol";
import type { StreamConnectionState } from "../shared/types";
import { buildReasoningTimelineItems, getTimelineCardStatus, getTimelineStatusCopy, type TimelineCardModel } from "./reasoningTimeline";

const TYPEWRITER_EVENT_TYPES = new Set<NormalizedEventType>(["thinking", "result"]);
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

function getDetailJson(model: TimelineCardModel) {
  return model.entries
    .filter((entry) => entry.data || entry.logData || entry.question)
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      createdAt: entry.createdAt,
      data: entry.data,
      logData: entry.logData,
      question: entry.question
    }));
}

function TimelineDetails({ model }: { model: TimelineCardModel }) {
  const [expanded, setExpanded] = useState(false);
  const detailJson = useMemo(() => getDetailJson(model), [model]);
  const hasStructuredDebug = detailJson.length > 0;

  if (!model.isAggregated && !hasStructuredDebug) {
    return null;
  }

  return (
    <div className="timeline-details">
      <button className="secondary ghost-button" type="button" onClick={() => setExpanded((current) => !current)}>
        {expanded ? "收起细节" : `查看细节${model.entries.length > 1 ? `（${model.entries.length} 条）` : ""}`}
      </button>
      {expanded ? (
        <div className="timeline-details-panel">
          {model.entries.length > 1 ? (
            <ol className="timeline-entry-list">
              {model.entries.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.title}</strong>
                  <small>{formatTimestamp(entry.createdAt)}</small>
                  <p>{entry.message}</p>
                </li>
              ))}
            </ol>
          ) : null}
          {hasStructuredDebug ? (
            extensionConfig.extensionEnv === "development" ? (
              <pre>{JSON.stringify(detailJson, null, 2)}</pre>
            ) : (
              <p className="detail-muted">原始调试载荷默认隐藏，仅在开发环境中展示。</p>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TimelineCard({
  model,
  status,
  animate
}: {
  model: TimelineCardModel;
  status: ReturnType<typeof getTimelineCardStatus>;
  animate: boolean;
}) {
  const displayedSummary = useBufferedTypewriter(model.summary, animate && TYPEWRITER_EVENT_TYPES.has(model.type));
  const itemCountLabel = model.entries.length > 1 ? `已合并 ${model.entries.length} 条连续事件` : null;

  return (
    <article className={`event-card event-${model.type} is-${status}`}>
      <div className="event-card-header">
        <div className="event-card-heading">
          <strong>{model.title}</strong>
          <span className={`status-chip status-${status}`}>{getStatusLabel(status)}</span>
        </div>
        <small>{formatTimestamp(model.updatedAt)}</small>
      </div>
      {itemCountLabel ? <small className="detail-muted">{itemCountLabel}</small> : null}
      <p className="event-summary">{displayedSummary}</p>
      <TimelineDetails model={model} />
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

/** @ArchitectureID: ELM-APP-EXT-EVENT-PRESENTATION */
/** @ArchitectureID: ELM-APP-EXT-STREAM-UX */
/** @ArchitectureID: ELM-APP-EXT-HISTORY-TIMELINE */
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
  const items = useMemo(() => buildReasoningTimelineItems(events), [events]);

  useEffect(() => {
    setAutoFollow(live);
  }, [live]);

  useEffect(() => {
    const signature = items.map((event) => `${event.id}:${event.summary.length}:${event.entries.length}`).join("|");
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
    <div className="timeline-shell">
      <div
        className="event-feed reasoning-timeline"
        ref={containerRef}
        onScroll={() => {
          const nearBottom = isNearBottom(containerRef.current);
          setAutoFollow(nearBottom);
          if (nearBottom) {
            setUnreadCount(0);
          }
        }}
      >
        {items.length ? items.map((event, index) => (
          <TimelineCard
            key={`${event.id}:${event.updatedAt}`}
            model={event}
            status={getTimelineCardStatus({
              type: event.type,
              isLast: index === items.length - 1,
              live,
              streamStatus,
              runStatus
            })}
            animate={live && index === items.length - 1}
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
