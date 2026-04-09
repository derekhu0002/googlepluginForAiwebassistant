import type { ReactNode } from "react";
import type { NormalizedRunEvent } from "../shared/protocol";
import { Composer } from "./components/composer/Composer";
import { ContextPanel } from "./components/panels/ContextPanel";
import { RulesPanel } from "./components/panels/RulesPanel";
import { SessionsPanel } from "./components/panels/SessionsPanel";
import { MainStage } from "./components/stage/MainStage";
import { OPENCODE_REFERENCE_INPUTS } from "./referenceMap";
export { mergeStateUpdate } from "./model";
import { useSidepanelController, type DrawerKey } from "./useSidepanelController";

/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-SHELL */
/** @ArchitectureID: REQ-AIASSIST-UI-CHAT-SEND-DECOUPLE-AND-COMPLETE-RESPONSE-RENDER */
/** @ArchitectureID: ELM-APP-008A */
export function App() {
  const controller = useSidepanelController();

  return (
    <main
      className="app-shell opencode-shell"
      data-reference-count={OPENCODE_REFERENCE_INPUTS.length}
      data-active-drawer={controller.activeDrawer ?? "none"}
    >
      <div className="opencode-layout opencode-layout-single">
        <section className="opencode-zone opencode-zone-main">
          <MainStage
            activeContext={controller.activeContext}
            canShowPermissionButton={controller.canShowPermissionButton}
            contextError={controller.contextError}
            isBusy={controller.isBusy}
            livePrompt={controller.livePrompt}
            liveConversationSegments={controller.liveConversationSegments}
            onQuestionSubmit={controller.selectedSessionIsCurrent ? controller.handleQuestionSubmit : undefined}
            onRequestPermission={controller.requestPermission}
            onRetry={controller.handleRetry}
            onStartFreshSession={controller.handleStartFreshSession}
            questionSubmitDisabled={controller.selectedSessionIsCurrent ? !controller.questionEvent?.question : true}
            requestingPermission={controller.requestingPermission}
            selectedConversationHasContent={controller.selectedConversationHasContent}
            selectedSessionIsCurrent={controller.selectedSessionIsCurrent}
            selectedSessionItem={controller.selectedSessionItem}
            selectedThreadError={controller.selectedThreadError}
            selectedThreadFinalOutput={controller.selectedThreadFinalOutput}
            selectedThreadRun={controller.selectedThreadRun}
            selectedThreadStatus={controller.selectedThreadStatus}
            selectedThreadStreamStatus={controller.selectedThreadStreamStatus}
            selectedThreadUpdatedAt={controller.selectedThreadUpdatedAt}
            shouldShowPermissionCallout={controller.shouldShowPermissionCallout}
            state={controller.state}
          />

          <BottomDrawerHost
            activeDrawer={controller.activeDrawer}
            latestReasoningItems={controller.latestReasoningItems}
            latestRunSummary={controller.latestRunSummary}
            onClose={controller.closeDrawer}
            sessionsContent={(
              <SessionsPanel
                currentRun={controller.state.currentRun}
                draftSessionSummary={controller.draftSessionSummary}
                effectiveSelectedSessionKey={controller.effectiveSelectedSessionKey}
                isBusy={controller.isBusy}
                onRefresh={controller.refresh}
                onReturnToCurrentSession={controller.handleReturnToCurrentSession}
                onSelectSession={controller.handleSelectSession}
                onStartFreshSession={controller.handleStartFreshSession}
                selectedConversationHasContent={controller.selectedConversationHasContent}
                selectedSessionIsCurrent={controller.selectedSessionIsCurrent}
                selectedSessionItem={controller.selectedSessionItem}
                selectedThreadFinalOutput={controller.selectedThreadFinalOutput}
                sessionNavigationItems={controller.sessionNavigationItems}
              />
            )}
            contextContent={(
              <ContextPanel
                active
                activeContext={controller.activeContext}
                contextError={controller.contextError}
                errorDescription={controller.errorDescription}
                errorTitle={controller.errorTitle}
                onRequestPermission={controller.requestPermission}
                referenceInputs={OPENCODE_REFERENCE_INPUTS}
                requestingPermission={controller.requestingPermission}
                shouldShowPermissionCallout={controller.shouldShowPermissionCallout}
                state={controller.state}
              />
            )}
            rulesContent={(
              <RulesPanel
                active
                draftRule={controller.draftRule}
                onAddFieldRule={controller.handleAddFieldRule}
                onAddRule={controller.addRule}
                onDeleteRule={controller.deleteCurrentRule}
                onRemoveFieldRule={controller.handleRemoveFieldRule}
                onSaveRule={controller.saveCurrentRule}
                onSelectRule={controller.handleSelectRule}
                onUpdateDraft={controller.updateDraft}
                rules={controller.rules}
                savingRule={controller.savingRule}
                selectedRuleId={controller.selectedRuleId}
              />
            )}
            runContent={(
              <RunDrawerPanel
                hasLivePendingQuestion={controller.hasLivePendingQuestion}
                latestReasoningItems={controller.latestReasoningItems}
                latestRunSummary={controller.latestRunSummary}
                selectedThreadError={controller.selectedThreadError}
                selectedThreadRunId={controller.selectedThreadRun?.runId ?? controller.state.stream.runId ?? null}
                selectedThreadStatus={controller.selectedThreadStatus ?? controller.state.status}
                selectedThreadStreamStatus={controller.selectedThreadStreamStatus ?? controller.state.stream.status}
                questionMessage={controller.questionEvent?.question?.message ?? null}
              />
            )}
          />

          <Composer
            activeDrawer={controller.activeDrawer}
            drawerItems={controller.drawerItems}
            isBusy={controller.isBusy}
            isSendDisabled={controller.isSendDisabled}
            onCaptureOnly={controller.handleCaptureOnly}
            onPromptChange={controller.setPrompt}
            onSend={() => controller.startStreamingRun({ capturePageData: false })}
            onToggleDrawer={controller.toggleDrawer}
            placeholderQuestionActive={Boolean(controller.selectedSessionIsCurrent && controller.questionEvent?.question)}
            prompt={controller.prompt}
            state={controller.state}
            textareaRef={controller.composerRef}
          />
        </section>
      </div>
    </main>
  );
}

function BottomDrawerHost({
  activeDrawer,
  contextContent,
  latestReasoningItems,
  latestRunSummary,
  onClose,
  rulesContent,
  runContent,
  sessionsContent
}: {
  activeDrawer: DrawerKey | null;
  contextContent: ReactNode;
  latestReasoningItems: NormalizedRunEvent[];
  latestRunSummary: string;
  onClose: () => void;
  rulesContent: ReactNode;
  runContent: ReactNode;
  sessionsContent: ReactNode;
}) {
  const drawerTitles: Record<DrawerKey, { title: string; description: string }> = {
    sessions: { title: "会话抽屉", description: "浏览历史会话、切换续聊目标或开始新会话。" },
    context: { title: "上下文抽屉", description: "查看页面上下文、权限状态与参考摘要。" },
    rules: { title: "规则抽屉", description: "管理命中规则、字段映射与站点规则配置。" },
    run: { title: "运行抽屉", description: "查看当前运行状态、追问入口与最新推理摘要。" }
  };

  const drawerContent = activeDrawer === "sessions"
    ? sessionsContent
    : activeDrawer === "context"
      ? contextContent
      : activeDrawer === "rules"
        ? rulesContent
        : activeDrawer === "run"
          ? runContent
          : null;

  return (
    <section
      className={`bottom-drawer-host ${activeDrawer ? "is-open" : "is-collapsed"}`}
      aria-label="底部抽屉工作区"
      data-open={activeDrawer ?? "none"}
    >
      {activeDrawer ? (
        <div className="bottom-drawer panel-block" role="region" aria-label={drawerTitles[activeDrawer].title}>
          <div className="bottom-drawer-header section-header compact">
            <div>
              <h2>{drawerTitles[activeDrawer].title}</h2>
              <small>{drawerTitles[activeDrawer].description}</small>
            </div>
            <button type="button" className="secondary" onClick={onClose}>关闭</button>
          </div>
          <div className="bottom-drawer-content">{drawerContent}</div>
        </div>
      ) : (
        <div className="bottom-drawer-placeholder" aria-hidden="true">
          <span>抽屉默认收起</span>
          <small>{activeDrawer ? latestRunSummary : "点击下方图标，在 composer 上方打开补充工作区。"}</small>
        </div>
      )}
    </section>
  );
}

function RunDrawerPanel({
  hasLivePendingQuestion,
  latestReasoningItems,
  latestRunSummary,
  questionMessage,
  selectedThreadError,
  selectedThreadRunId,
  selectedThreadStatus,
  selectedThreadStreamStatus
}: {
  hasLivePendingQuestion: boolean;
  latestReasoningItems: NormalizedRunEvent[];
  latestRunSummary: string;
  questionMessage: string | null;
  selectedThreadError: string | null | undefined;
  selectedThreadRunId: string | null;
  selectedThreadStatus: string;
  selectedThreadStreamStatus: string;
}) {
  return (
    <section className="run-drawer-panel">
      <div className="run-drawer-grid">
        <article className="status-card demoted-card">
          <strong>当前运行</strong>
          <small>状态：{selectedThreadStatus}</small>
          <small>流连接：{selectedThreadStreamStatus}</small>
          {selectedThreadRunId ? <small>Run：{selectedThreadRunId}</small> : null}
        </article>
        <article className="status-card demoted-card">
          <strong>追问入口</strong>
          <small>{hasLivePendingQuestion ? (questionMessage ?? "等待回答当前追问") : "当前无待回答追问"}</small>
          <span className={`pill ${hasLivePendingQuestion ? "pill-warning" : "pill-muted"}`}>{hasLivePendingQuestion ? "追问待答" : "主舞台连续"}</span>
        </article>
      </div>

      <article className="status-card demoted-card">
        <strong>运行摘要</strong>
        <p>{selectedThreadError || latestRunSummary}</p>
      </article>

      <article className="status-card demoted-card">
        <strong>最近推理节点</strong>
        {latestReasoningItems.length ? (
          <ul className="run-drawer-list">
            {latestReasoningItems.map((item) => (
              <li key={item.id}>
                <span className={`pill ${item.type === "tool_call" ? "pill-mode" : "pill-muted"}`}>{item.type === "tool_call" ? "工具" : "思考"}</span>
                <small>{item.message}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">暂无可展示的推理节点，主舞台中的时间线仍可继续工作。</p>
        )}
      </article>
    </section>
  );
}
