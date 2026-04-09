import { Composer } from "./components/composer/Composer";
import { ShellHeader } from "./components/shell/ShellHeader";
import { StatusRail } from "./components/shell/StatusRail";
import { ContextPanel } from "./components/panels/ContextPanel";
import { RulesPanel } from "./components/panels/RulesPanel";
import { SessionsPanel } from "./components/panels/SessionsPanel";
import { MainStage } from "./components/stage/MainStage";
import { OPENCODE_REFERENCE_INPUTS } from "./referenceMap";
export { mergeStateUpdate } from "./model";
import { useSidepanelController } from "./useSidepanelController";

/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-SHELL */
/** @ArchitectureID: REQ-AIASSIST-UI-CHAT-SEND-DECOUPLE-AND-COMPLETE-RESPONSE-RENDER */
/** @ArchitectureID: ELM-APP-008A */
export function App() {
  const controller = useSidepanelController();
  const activeAuxiliaryPanel = controller.activeConsole === "rules" ? "rules" : controller.activeConsole === "context" ? "context" : null;

  return (
    <main
      className="app-shell opencode-shell"
      data-reference-count={OPENCODE_REFERENCE_INPUTS.length}
      data-active-aux-panel={activeAuxiliaryPanel ?? "none"}
    >
      <ShellHeader
        activeContext={controller.activeContext}
        cockpitStatus={controller.cockpitStatus}
        isBusy={controller.isBusy}
        onStartFreshSession={controller.handleStartFreshSession}
        referenceCount={OPENCODE_REFERENCE_INPUTS.length}
        sessionCount={controller.sessionNavigationItems.length}
      />

      <div className="opencode-layout">
        <aside className={`opencode-zone opencode-zone-left ${controller.activeConsole === "sessions" ? "is-active" : ""}`}>
          <SessionsPanel
            activeConsole={controller.activeConsole}
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
        </aside>

        <section className="opencode-zone opencode-zone-main">
          <MainStage
            activeContext={controller.activeContext}
            canShowPermissionButton={controller.canShowPermissionButton}
            cockpitStatus={controller.cockpitStatus}
            contextError={controller.contextError}
            currentSessionHistorySummaries={controller.currentSessionHistorySummaries}
            hasLivePendingQuestion={controller.hasLivePendingQuestion}
            isBusy={controller.isBusy}
            livePrompt={controller.livePrompt}
            liveConversationSegments={controller.liveConversationSegments}
            onQuestionSubmit={controller.selectedSessionIsCurrent ? controller.handleQuestionSubmit : undefined}
            onRequestPermission={controller.requestPermission}
            onRetry={controller.handleRetry}
            onStartFreshSession={controller.handleStartFreshSession}
            questionEvent={controller.questionEvent}
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
            shellStatusLabel={controller.shellStatusLabel}
            shouldShowPermissionCallout={controller.shouldShowPermissionCallout}
            state={controller.state}
          />

          <Composer
            activeConsole={controller.activeConsole}
            isBusy={controller.isBusy}
            isSendDisabled={controller.isSendDisabled}
            onCaptureOnly={controller.handleCaptureOnly}
            onPromptChange={controller.setPrompt}
            onSend={() => controller.startStreamingRun({ capturePageData: false })}
            onToggleConsole={controller.toggleConsole}
            placeholderQuestionActive={Boolean(controller.selectedSessionIsCurrent && controller.questionEvent?.question)}
            prompt={controller.prompt}
            state={controller.state}
          />
        </section>

        <aside className="opencode-zone opencode-zone-right">
          <StatusRail
            activeContext={controller.activeContext}
            cockpitStatus={controller.cockpitStatus}
            referenceInputs={OPENCODE_REFERENCE_INPUTS}
            selectedSessionItem={controller.selectedSessionItem}
            state={controller.state}
          />

          <div className="auxiliary-panel-stack">
            {controller.activeConsole === "context" ? (
              <ContextPanel
                active
                activeContext={controller.activeContext}
                contextError={controller.contextError}
                errorDescription={controller.errorDescription}
                errorTitle={controller.errorTitle}
                onRequestPermission={controller.requestPermission}
                requestingPermission={controller.requestingPermission}
                shouldShowPermissionCallout={controller.shouldShowPermissionCallout}
                state={controller.state}
              />
            ) : null}

            {controller.activeConsole === "rules" ? (
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
            ) : null}
          </div>
        </aside>
      </div>
    </main>
  );
}
