import type { ReactNode, RefObject } from "react";
import type { AssistantState } from "../../../shared/types";
import type { DrawerBarItem, DrawerKey } from "../../useSidepanelController";
import { CaptureIcon, ContextIcon, RulesIcon, SendIcon, SessionIcon } from "../shared/icons";
import { RunIcon } from "../shared/icons";

export function Composer({
  activeDrawer,
  drawerItems,
  isBusy,
  isSendDisabled,
  onCaptureOnly,
  onPromptChange,
  onSend,
  onToggleDrawer,
  placeholderQuestionActive,
  prompt,
  textareaRef,
  state
}: {
  activeDrawer: DrawerKey | null;
  drawerItems: DrawerBarItem[];
  isBusy: boolean;
  isSendDisabled: boolean;
  onCaptureOnly: () => void | Promise<void>;
  onPromptChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onToggleDrawer: (panel: DrawerKey) => void;
  placeholderQuestionActive: boolean;
  prompt: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  state: AssistantState;
}) {
  const iconByKey: Record<DrawerKey, ReactNode> = {
    sessions: <SessionIcon />,
    context: <ContextIcon />,
    rules: <RulesIcon />,
    run: <RunIcon />
  };
  const sessionDrawerItem = drawerItems.find((item) => item.key === "sessions");

  return (
    <div className="conversation-composer docked-composer opencode-composer-zone">
      <label className="composer-input-shell copilot-composer-shell">
        <textarea ref={textareaRef} value={prompt} onChange={(event) => onPromptChange(event.target.value)} onInput={(event) => onPromptChange((event.target as HTMLTextAreaElement).value)} rows={4} placeholder="Ask AI Web Assistant anything about the current page…" />
        <button
          type="button"
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
        <div className="chat-console-dock compact-icon-dock" aria-label="drawer icon bar">
          {drawerItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`utility-icon-button ${activeDrawer === item.key ? "active" : ""} ${item.status === "pending" ? "pending" : ""}`}
              aria-label={item.label}
              aria-pressed={activeDrawer === item.key}
              title={item.description}
              data-tooltip={item.label}
              onClick={() => onToggleDrawer(item.key)}
            >
              {iconByKey[item.key]}
              {item.badge ? <span className="utility-icon-badge" aria-hidden="true">{item.badge}</span> : null}
              <span className="sr-only">{item.label}</span>
            </button>
          ))}
          <button type="button" className={`utility-icon-button ${state.status === "collecting" ? "pending" : ""}`} aria-label={state.status === "collecting" ? "采集中..." : "采集页面"} title="重新采集页面上下文。发送消息默认不会触发页面采集。" data-tooltip={state.status === "collecting" ? "采集中" : "采集页面"} disabled={isBusy} onClick={() => onCaptureOnly()}>
            <CaptureIcon />
            <span className="sr-only">{state.status === "collecting" ? "采集中..." : "采集页面"}</span>
          </button>
        </div>
        <div className="conversation-composer-actions compact-composer-actions">
          <small className="detail-muted">用户名：{state.usernameContext?.username ?? "unknown"}（{state.usernameContext?.usernameSource ?? "pending"}）</small>
          {sessionDrawerItem?.badge ? <small className="detail-muted">{sessionDrawerItem.badge} 个会话簇</small> : null}
        </div>
      </div>
    </div>
  );
}
