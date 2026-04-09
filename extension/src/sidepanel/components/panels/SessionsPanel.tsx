import type { RunRecord } from "../../../shared/protocol";
import type { SessionNavigationItem } from "../../model";
import { DRAFT_SESSION_KEY, deriveRunSummary, deriveRunTitle } from "../../model";

export function SessionsPanel({
  activeConsole,
  currentRun,
  draftSessionSummary,
  effectiveSelectedSessionKey,
  isBusy,
  onRefresh,
  onReturnToCurrentSession,
  onSelectSession,
  onStartFreshSession,
  selectedConversationHasContent,
  selectedSessionIsCurrent,
  selectedSessionItem,
  selectedThreadFinalOutput,
  sessionNavigationItems
}: {
  activeConsole: "sessions" | "context" | "rules" | null;
  currentRun: RunRecord | null;
  draftSessionSummary: string;
  effectiveSelectedSessionKey: string | null;
  isBusy: boolean;
  onRefresh: () => void | Promise<void>;
  onReturnToCurrentSession: () => void | Promise<void>;
  onSelectSession: (sessionKey: string) => void;
  onStartFreshSession: () => void | Promise<void>;
  selectedConversationHasContent: boolean;
  selectedSessionIsCurrent: boolean;
  selectedSessionItem: SessionNavigationItem | null;
  selectedThreadFinalOutput: string;
  sessionNavigationItems: SessionNavigationItem[];
}) {
  return (
    <section className={`panel-block session-sidebar-panel ${activeConsole === "sessions" ? "panel-emphasis" : ""}`}>
      <div className="section-header compact session-sidebar-header">
        <div>
          <h2>会话</h2>
          <small>历史会话、当前续聊与新草稿</small>
        </div>
        <div className="session-sidebar-actions">
          <button className="secondary" disabled={isBusy} onClick={() => onStartFreshSession()}>新会话</button>
          <button className="secondary" onClick={() => onRefresh()}>刷新</button>
        </div>
      </div>

      <div className="session-sidebar-meta">
        <span className={`pill ${selectedSessionIsCurrent ? "pill-success" : "pill-muted"}`}>{selectedSessionIsCurrent ? "当前会话" : "历史会话"}</span>
        <span className={`pill ${effectiveSelectedSessionKey === DRAFT_SESSION_KEY ? "pill-success" : "pill-muted"}`}>{effectiveSelectedSessionKey === DRAFT_SESSION_KEY ? "新会话" : `${sessionNavigationItems.length} 个会话簇`}</span>
        {currentRun ? <button className="secondary floating-inline-button" onClick={() => onReturnToCurrentSession()}>返回当前会话</button> : null}
      </div>

      <article className="current-session-card">
        <div className="current-session-card-header">
          <div>
            <small>{effectiveSelectedSessionKey === DRAFT_SESSION_KEY ? "Draft session" : "Selected session"}</small>
            <strong>{effectiveSelectedSessionKey === DRAFT_SESSION_KEY ? "开始一段新的会话" : selectedSessionItem ? deriveRunTitle(selectedSessionItem.latestRun) : "未选择会话"}</strong>
          </div>
          {selectedSessionItem ? <span className={`status-dot status-${selectedSessionItem.latestRun.status}`} aria-hidden="true" /> : null}
        </div>
        <p className="session-summary-text">
          {effectiveSelectedSessionKey === DRAFT_SESSION_KEY
            ? draftSessionSummary
            : selectedConversationHasContent
              ? (selectedThreadFinalOutput || (selectedSessionItem ? deriveRunSummary(selectedSessionItem.latestRun) : "等待更多会话内容"))
              : "等待更多会话内容"}
        </p>
      </article>

      <div className="history-list copilot-history-list">
        {sessionNavigationItems.length ? sessionNavigationItems.map((item) => (
          <button
            key={item.key}
            className={`rule-list-item history-nav-item ${effectiveSelectedSessionKey === item.key ? "active" : ""}`}
            onClick={() => onSelectSession(item.key)}
          >
            <div className="history-nav-item-header">
              <strong>{deriveRunTitle(item.latestRun)}</strong>
              <span className={`status-dot status-${item.latestRun.status}`} aria-hidden="true" />
            </div>
            <small>{item.runCount} 轮消息 · {item.latestRun.username}</small>
          </button>
        )) : <p className="empty-state">暂无历史记录。</p>}
      </div>
    </section>
  );
}
