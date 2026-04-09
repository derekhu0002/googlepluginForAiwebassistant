import type { ReactNode } from "react";
import { ReasoningTimeline } from "../../reasoningTimelineView";
import type { BuildChatStreamItemsOptions, CockpitStatusModel } from "../../reasoningTimeline";
import type { ActiveTabContext, AssistantState } from "../../../shared/types";
import type { RunRecord } from "../../../shared/protocol";
import type { SessionNavigationItem } from "../../model";
import { deriveRunTitle } from "../../model";

export function MainStage({
  activeContext,
  canShowPermissionButton,
  cockpitStatus,
  contextError,
  currentSessionHistorySummaries,
  hasLivePendingQuestion,
  isBusy,
  livePrompt,
  liveConversationSegments,
  onQuestionSubmit,
  onRequestPermission,
  onRetry,
  onStartFreshSession,
  questionEvent,
  questionSubmitDisabled,
  requestingPermission,
  selectedConversationHasContent,
  selectedSessionIsCurrent,
  selectedSessionItem,
  selectedThreadError,
  selectedThreadFinalOutput,
  selectedThreadRun,
  selectedThreadStatus,
  selectedThreadStreamStatus,
  selectedThreadUpdatedAt,
  shellStatusLabel,
  shouldShowPermissionCallout,
  state
}: {
  activeContext: ActiveTabContext | null;
  canShowPermissionButton: boolean | null | undefined;
  cockpitStatus: CockpitStatusModel;
  contextError: string;
  currentSessionHistorySummaries: string[];
  hasLivePendingQuestion: boolean;
  isBusy: boolean;
  livePrompt: string;
  liveConversationSegments: BuildChatStreamItemsOptions[];
  onQuestionSubmit?: (answer: { answer: string; choiceId?: string }) => void;
  onRequestPermission: () => void | Promise<void>;
  onRetry: (payload: { prompt: string; runId: string; messageId: string }) => void | Promise<void>;
  onStartFreshSession: () => void | Promise<void>;
  questionEvent: { question?: { questionId: string } | null } | null;
  questionSubmitDisabled: boolean;
  requestingPermission: boolean;
  selectedConversationHasContent: boolean;
  selectedSessionIsCurrent: boolean;
  selectedSessionItem: SessionNavigationItem | null;
  selectedThreadError: string | null | undefined;
  selectedThreadFinalOutput: string;
  selectedThreadRun: RunRecord | null | undefined;
  selectedThreadStatus: RunRecord["status"] | "streaming" | undefined;
  selectedThreadStreamStatus: AssistantState["stream"]["status"] | undefined;
  selectedThreadUpdatedAt: string | null | undefined;
  shellStatusLabel: string;
  shouldShowPermissionCallout: boolean;
  state: AssistantState;
}) {
  return (
    <section className="panel-block chat-primary-panel opencode-stage-panel">
      {shouldShowPermissionCallout ? (
        <section className="panel-block host-permission-callout" aria-label="当前域名授权提示">
          <div>
            <strong>当前页面需要先授权域名访问</strong>
            <p>{activeContext?.message || "授权当前域名后，扩展才能继续读取页面上下文并正常工作。"}</p>
            {!canShowPermissionButton ? (
              <p>
                当前构建尚未把这个域名加入可申请授权清单。请先确认已将 extension/.env.example 复制为 extension/.env，重新执行 npm run build --workspace extension，然后在 chrome://extensions 里重新加载 extension/dist。
              </p>
            ) : null}
          </div>
          {canShowPermissionButton ? (
            <button className="secondary" disabled={requestingPermission} onClick={() => onRequestPermission()}>
              {requestingPermission ? "授权中..." : "授权当前域名"}
            </button>
          ) : null}
          {contextError ? <p className="error-text">{contextError}</p> : null}
        </section>
      ) : null}

      <div className="chat-primary-header section-header compact" data-component="header">
        <div>
          <h2>AI Working Cockpit</h2>
          <small>{selectedSessionItem ? deriveRunTitle(selectedSessionItem.latestRun) : cockpitStatus.headline}</small>
        </div>
        <div className="chat-primary-meta">
          <small className={`conversation-live-chip tone-${cockpitStatus.tone}`}>{selectedSessionIsCurrent ? shellStatusLabel : (selectedThreadRun?.status ?? "done")}</small>
          {selectedThreadRun?.runId ? <small className="detail-muted">Run：{selectedThreadRun.runId}</small> : null}
          <button className="secondary quick-session-button" disabled={isBusy} onClick={() => onStartFreshSession()}>新会话</button>
        </div>
      </div>

      <div className="chat-stage-statusbar">
        <span className={`pill pill-stage pill-${cockpitStatus.tone}`}>阶段：{cockpitStatus.stageLabel}</span>
        <span className="pill pill-mode">模式：{cockpitStatus.modeLabel}</span>
        <span className="pill pill-muted">页面：{activeContext?.hostname ?? "未读取"}</span>
        <span className={`pill ${activeContext?.permissionGranted ? "pill-success" : "pill-warning"}`}>
          {activeContext?.permissionGranted ? "域名已授权" : "域名未授权"}
        </span>
        <span className={`pill ${selectedSessionIsCurrent && hasLivePendingQuestion ? "pill-warning" : "pill-muted"}`}>
          {selectedSessionIsCurrent && hasLivePendingQuestion ? "等待补充信息" : "自由对话"}
        </span>
        <span className="pill pill-muted">状态：{selectedThreadStatus ?? state.status}</span>
        <span className="pill pill-muted">流连接：{selectedThreadStreamStatus ?? state.stream.status}</span>
        {currentSessionHistorySummaries.slice(-2).map((summary, index) => (
          <span key={`${index}-${summary}`} className="pill pill-history-summary">历史：{summary.slice(0, 24)}{summary.length > 24 ? "…" : ""}</span>
        ))}
      </div>

      <div className="conversation-mainline chat-primary-mainline">
        {selectedConversationHasContent ? (
          <ReasoningTimeline
            runId={selectedThreadRun?.runId ?? state.stream.runId}
            prompt={selectedThreadRun?.prompt ?? livePrompt}
            events={selectedSessionIsCurrent ? state.runEvents : []}
            runSegments={liveConversationSegments}
            assistantStatus={selectedSessionIsCurrent ? state.status : undefined}
            answers={selectedSessionIsCurrent ? state.answers : []}
            live={selectedSessionIsCurrent}
            streamStatus={selectedThreadStreamStatus}
            runStatus={selectedThreadStatus}
            finalOutput={selectedThreadFinalOutput}
            errorMessage={selectedThreadError}
            updatedAt={selectedThreadUpdatedAt}
            pendingQuestionId={selectedSessionIsCurrent ? state.stream.pendingQuestionId : null}
            emptyText="正在生成回答…"
            onRetry={onRetry}
            onQuestionSubmit={onQuestionSubmit}
            questionSubmitDisabled={questionSubmitDisabled}
          />
        ) : (
          <div className="chat-empty-hero empty-state">
            <strong>开始一段新的会话</strong>
            <p>发送 prompt 后，这里会切换成更接近 OpenCode Share 的主舞台：展示摘要、对话、追问、thinking 与 retry。</p>
          </div>
        )}
      </div>
      {selectedSessionIsCurrent && questionEvent?.question ? <StageSemanticCue>对话</StageSemanticCue> : null}
    </section>
  );
}

function StageSemanticCue({ children }: { children: ReactNode }) {
  return <div className="sr-only">{children}</div>;
}
