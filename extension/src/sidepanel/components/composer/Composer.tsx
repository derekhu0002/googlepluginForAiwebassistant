import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { MainAgent } from "../../../shared/protocol";
import type { AssistantState } from "../../../shared/types";
import type { DrawerBarItem, DrawerKey } from "../../useSidepanelController";
import { CaptureIcon, ContextIcon, RulesIcon, SendIcon, SessionIcon } from "../shared/icons";
import { RunIcon } from "../shared/icons";

/** @ArchitectureID: ELM-APP-EXT-CONVERSATION-RENDERER */
export function Composer({
  activeDrawer,
  agentMenuHost,
  drawerItems,
  isBusy,
  isSendDisabled,
  mainAgentOptions,
  nextRunAgentDescription,
  onCaptureOnly,
  onPromptChange,
  onSelectMainAgent,
  onSend,
  onToggleDrawer,
  placeholderQuestionActive,
  prompt,
  textareaRef,
  state
}: {
  activeDrawer: DrawerKey | null;
  agentMenuHost: HTMLDivElement | null;
  drawerItems: DrawerBarItem[];
  isBusy: boolean;
  isSendDisabled: boolean;
  mainAgentOptions: Array<{ value: MainAgent; label: string; description: string }>;
  nextRunAgentDescription: string;
  onCaptureOnly: () => void | Promise<void>;
  onPromptChange: (value: string) => void;
  onSelectMainAgent: (selectedAgent: MainAgent) => void | Promise<void>;
  onSend: () => void | Promise<void>;
  onToggleDrawer: (panel: DrawerKey) => void;
  placeholderQuestionActive: boolean;
  prompt: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  state: AssistantState;
}) {
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [agentMenuStyle, setAgentMenuStyle] = useState<CSSProperties>({});
  const agentMenuId = useId();
  const agentTriggerRef = useRef<HTMLButtonElement | null>(null);
  const iconByKey: Record<DrawerKey, ReactNode> = {
    sessions: <SessionIcon />,
    context: <ContextIcon />,
    rules: <RulesIcon />,
    run: <RunIcon />
  };
  const sessionDrawerItem = drawerItems.find((item) => item.key === "sessions");

  useEffect(() => {
    if (!agentMenuOpen || !agentMenuHost || !agentTriggerRef.current) {
      return;
    }

    const updatePosition = () => {
      if (!agentMenuHost || !agentTriggerRef.current) {
        return;
      }
      const triggerRect = agentTriggerRef.current.getBoundingClientRect();
      const hostRect = agentMenuHost.getBoundingClientRect();
      setAgentMenuStyle({
        left: Math.max(0, triggerRect.left - hostRect.left),
        bottom: Math.max(0, hostRect.bottom - triggerRect.top + 8),
        minWidth: triggerRect.width
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [agentMenuHost, agentMenuOpen]);

  useEffect(() => {
    if (!agentMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (agentTriggerRef.current?.contains(target)) {
        return;
      }
      if (agentMenuHost?.firstElementChild?.contains(target)) {
        return;
      }
      setAgentMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAgentMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [agentMenuHost, agentMenuOpen]);

  const agentMenu = agentMenuOpen && agentMenuHost
    ? createPortal(
        <div className="main-agent-menu" style={agentMenuStyle} role="menu" aria-label="主 AGENT 菜单" id={agentMenuId}>
          {mainAgentOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === state.mainAgentPreference}
              className={`main-agent-option ${option.value === state.mainAgentPreference ? "selected" : ""}`}
              onClick={() => {
                setAgentMenuOpen(false);
                onSelectMainAgent(option.value as MainAgent);
              }}
            >
              <span>{option.label}</span>
              <small>{option.description}</small>
            </button>
          ))}
        </div>,
        agentMenuHost
      )
    : null;

  return (
    <>
      {agentMenu}
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
            <div className="main-agent-picker" aria-label="主 AGENT 选择器">
              <button
                ref={agentTriggerRef}
                type="button"
                className={`main-agent-trigger ${agentMenuOpen ? "active" : ""}`}
                aria-haspopup="menu"
                aria-expanded={agentMenuOpen}
                aria-controls={agentMenuOpen ? agentMenuId : undefined}
                aria-label={`主 AGENT：${state.mainAgentPreference}`}
                onClick={() => setAgentMenuOpen((current) => !current)}
              >
                {`主 AGENT：${state.mainAgentPreference}`}
              </button>
            </div>
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
            <small className="detail-muted">{nextRunAgentDescription}</small>
            <small className="detail-muted">用户名：{state.usernameContext?.username ?? "unknown"}（{state.usernameContext?.usernameSource ?? "pending"}）</small>
            {sessionDrawerItem?.badge ? <small className="detail-muted">{sessionDrawerItem.badge} 个会话簇</small> : null}
          </div>
        </div>
      </div>
    </>
  );
}
