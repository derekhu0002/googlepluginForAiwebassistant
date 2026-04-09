import type { AssistantState } from "../../../shared/types";
import { COMPOSER_PLACEHOLDER_CHIPS } from "../../useSidepanelController";
import { AttachmentIcon, CaptureIcon, ContextIcon, PageContextIcon, RulesIcon, SelectionIcon, SendIcon, SessionIcon } from "../shared/icons";

export function Composer({
  activeConsole,
  isBusy,
  isSendDisabled,
  onCaptureOnly,
  onPromptChange,
  onSend,
  onToggleConsole,
  placeholderQuestionActive,
  prompt,
  state
}: {
  activeConsole: "sessions" | "context" | "rules" | null;
  isBusy: boolean;
  isSendDisabled: boolean;
  onCaptureOnly: () => void | Promise<void>;
  onPromptChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onToggleConsole: (panel: "sessions" | "context" | "rules") => void;
  placeholderQuestionActive: boolean;
  prompt: string;
  state: AssistantState;
}) {
  return (
    <div className="conversation-composer docked-composer opencode-composer-zone">
      <label className="composer-input-shell copilot-composer-shell">
        <textarea value={prompt} onChange={(event) => onPromptChange(event.target.value)} rows={4} placeholder="Ask AI Web Assistant anything about the current page…" />
        <button
          className="send-button"
          aria-label={placeholderQuestionActive ? "发送补充说明" : "发送消息"}
          title={placeholderQuestionActive ? "发送补充说明" : "发送消息"}
          disabled={isSendDisabled}
          onClick={() => onSend()}
        >
          <SendIcon />
        </button>
      </label>

      <div className="composer-utility-strip">
        <div className="chat-console-dock compact-icon-dock" aria-label="chat utilities">
          <button className={`utility-icon-button ${activeConsole === "sessions" ? "active" : ""}`} aria-label="会话" title="会话控制台，切换当前续聊目标" data-tooltip="会话" onClick={() => onToggleConsole("sessions")}>
            <SessionIcon />
            <span className="sr-only">会话</span>
          </button>
          <button className={`utility-icon-button ${activeConsole === "context" ? "active" : ""}`} aria-label="上下文" title="上下文控制台，查看页面状态和采集结果" data-tooltip="上下文" onClick={() => onToggleConsole("context")}>
            <ContextIcon />
            <span className="sr-only">上下文</span>
          </button>
          <button className={`utility-icon-button ${activeConsole === "rules" ? "active" : ""}`} aria-label="规则" title="规则控制台，管理当前页面规则" data-tooltip="规则" onClick={() => onToggleConsole("rules")}>
            <RulesIcon />
            <span className="sr-only">规则</span>
          </button>
          {COMPOSER_PLACEHOLDER_CHIPS.map((chip) => (
            <button
              key={chip.key}
              className="utility-icon-button utility-icon-button-muted"
              type="button"
              aria-label={chip.label}
              aria-disabled="true"
              title={`${chip.label}：${chip.description}`}
              data-tooltip={chip.label}
            >
              {chip.key === "attachment" ? <AttachmentIcon /> : null}
              {chip.key === "page_context" ? <PageContextIcon /> : null}
              {chip.key === "selection" ? <SelectionIcon /> : null}
              <span className="sr-only">{chip.label}</span>
            </button>
          ))}
          <button className={`utility-icon-button ${state.status === "collecting" ? "pending" : ""}`} aria-label={state.status === "collecting" ? "采集中..." : "采集页面"} title="重新采集页面上下文。发送消息默认不会触发页面采集。" data-tooltip={state.status === "collecting" ? "采集中" : "采集页面"} disabled={isBusy} onClick={() => onCaptureOnly()}>
            <CaptureIcon />
            <span className="sr-only">{state.status === "collecting" ? "采集中..." : "采集页面"}</span>
          </button>
        </div>
        <div className="conversation-composer-actions compact-composer-actions">
          <small className="detail-muted">用户名：{state.usernameContext?.username ?? "unknown"}（{state.usernameContext?.usernameSource ?? "pending"}）</small>
        </div>
      </div>
    </div>
  );
}
