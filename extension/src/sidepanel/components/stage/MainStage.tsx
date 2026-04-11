import { ReasoningTimeline } from "../../reasoningTimelineView";
import type { BuildChatStreamItemsOptions } from "../../reasoningTimeline";
import type { ActiveTabContext, AssistantState } from "../../../shared/types";
import type { RunRecord } from "../../../shared/protocol";
import type { SessionNavigationItem } from "../../model";
import { deriveRunTitle } from "../../model";

export function MainStage({
  activeContext,
  canShowPermissionButton,
  contextError,
  isBusy,
  livePrompt,
  liveConversationSegments,
  onQuestionSubmit,
  onRequestPermission,
  onRetry,
  onStartFreshSession,
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
  shouldShowPermissionCallout,
  state
}: {
  activeContext: ActiveTabContext | null;
  canShowPermissionButton: boolean | null | undefined;
  contextError: string;
  isBusy: boolean;
  livePrompt: string;
  liveConversationSegments: BuildChatStreamItemsOptions[];
  onQuestionSubmit?: (answer: { answer: string; choiceId?: string }) => void;
  onRequestPermission: () => void | Promise<void>;
  onRetry: (payload: { prompt: string; runId: string; messageId: string }) => void | Promise<void>;
  onStartFreshSession: () => void | Promise<void>;
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
          <h2>Transcript</h2>
          <small>{selectedSessionItem ? deriveRunTitle(selectedSessionItem.latestRun) : (activeContext?.hostname ?? "当前对话")}</small>
        </div>
        <div className="chat-primary-meta">
          {selectedThreadRun?.runId ? <small className="detail-muted">Run：{selectedThreadRun.runId}</small> : null}
          {canShowPermissionButton ? (
            <button
              aria-label="授权当前域名"
              className="secondary"
              disabled={requestingPermission}
              onClick={() => onRequestPermission()}
            >
              {requestingPermission ? "授权中..." : "授权当前域名"}
            </button>
          ) : null}
          <button className="secondary quick-session-button" disabled={isBusy} onClick={() => onStartFreshSession()}>新会话</button>
        </div>
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
            emptyText="正在继续…"
            onRetry={onRetry}
            onQuestionSubmit={onQuestionSubmit}
            questionSubmitDisabled={questionSubmitDisabled}
          />
        ) : (
          <section className="transcript-part transcript-part-summary transcript-empty-state empty-state" data-section="part" data-part-kind="summary" data-part-type="summary" data-part-role="assistant">
            <div className="transcript-part-decoration" data-section="decoration" aria-hidden="true">
              <span className="transcript-part-anchor" data-tone="neutral" />
              <span className="transcript-part-rail" />
            </div>
            <div className="transcript-part-body" data-section="content">
              <strong>开始一段新的会话</strong>
              <p>发送 prompt 后，这里会切换成基于 messages[] -&gt; parts[] 的 transcript 主舞台。</p>
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
