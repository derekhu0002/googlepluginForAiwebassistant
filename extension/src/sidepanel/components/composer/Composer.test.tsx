import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialAssistantState } from "../../../shared/state";
import type { DrawerBarItem } from "../../useSidepanelController";
import { Composer } from "./Composer";

/**
 * Guardrail: protects the composer entrypoint against duplicate sends,
 * incorrect disabled-state behavior, and follow-up/question mode regressions.
 */

function createDrawerItems(): DrawerBarItem[] {
  return [
    { key: "sessions", label: "会话", description: "查看会话" },
    { key: "context", label: "上下文", description: "查看上下文" },
    { key: "rules", label: "规则", description: "查看规则" },
    { key: "run", label: "运行", description: "查看运行" }
  ];
}

function createProps(overrides: Partial<Parameters<typeof Composer>[0]> = {}): Parameters<typeof Composer>[0] {
  return {
    activeDrawer: null,
    agentMenuHost: null,
    drawerItems: createDrawerItems(),
    isBusy: false,
    isSendDisabled: false,
    mainAgentOptions: [{ value: "ThreatIntelAnalyst", label: "ThreatIntelAnalyst", description: "默认主代理" }],
    nextRunAgentDescription: "使用默认主代理发送",
    onCaptureOnly: vi.fn(),
    onPromptChange: vi.fn(),
    onSelectMainAgent: vi.fn(),
    onSend: vi.fn(),
    onToggleDrawer: vi.fn(),
    placeholderQuestionActive: false,
    prompt: "请总结当前风险",
    textareaRef: { current: null },
    state: initialAssistantState,
    ...overrides
  };
}

describe("Composer guardrail", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    // @ts-expect-error test-only React act environment flag
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("prevents send clicks when the composer is disabled", async () => {
    const onSend = vi.fn();

    await act(async () => {
      root.render(<Composer {...createProps({ isSendDisabled: true, onSend })} />);
    });

    const sendButton = container.querySelector(".send-button") as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);

    await act(async () => {
      sendButton.click();
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("forwards prompt updates and invokes send exactly once per click", async () => {
    const onPromptChange = vi.fn();
    const onSend = vi.fn();

    await act(async () => {
      root.render(<Composer {...createProps({ onPromptChange, onSend })} />);
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const sendButton = container.querySelector(".send-button") as HTMLButtonElement;

    await act(async () => {
      textarea.value = "请给出修复建议";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
      sendButton.click();
    });

    expect(onPromptChange).toHaveBeenCalledWith("请给出修复建议");
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("switches send affordances into follow-up question mode without breaking send", async () => {
    const onSend = vi.fn();

    await act(async () => {
      root.render(<Composer {...createProps({ placeholderQuestionActive: true, onSend })} />);
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const sendButton = container.querySelector(".send-button") as HTMLButtonElement;

    expect(textarea.placeholder).toContain("继续补充当前问题");
    expect(sendButton.getAttribute("aria-label")).toBe("发送补充说明");

    await act(async () => {
      sendButton.click();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
  });
});