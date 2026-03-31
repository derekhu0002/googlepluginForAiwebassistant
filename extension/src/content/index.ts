import { captureFields } from "../shared/rules";
import type { RuntimeMessage } from "../shared/types";

const FLOATING_BUTTON_ID = "ai-web-assistant-floating-button";
const EMBEDDED_PANEL_ID = "ai-web-assistant-embedded-panel";

function createFloatingButton() {
  if (!document.body) {
    return;
  }

  if (document.getElementById(FLOATING_BUTTON_ID)) {
    return;
  }

  const button = document.createElement("button");
  button.id = FLOATING_BUTTON_ID;
  button.textContent = "AI";
  Object.assign(button.style, {
    position: "fixed",
    top: "50%",
    right: "12px",
    transform: "translateY(-50%)",
    zIndex: "2147483647",
    width: "44px",
    height: "44px",
    borderRadius: "999px",
    border: "none",
    background: "#2563eb",
    color: "#fff",
    fontWeight: "700",
    cursor: "pointer",
    boxShadow: "0 8px 24px rgba(37, 99, 235, 0.35)"
  } satisfies Partial<CSSStyleDeclaration>);

  button.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_PANEL" } satisfies RuntimeMessage).catch(() => undefined);
  });

  document.body.appendChild(button);
}

function toggleEmbeddedPanel() {
  const existingPanel = document.getElementById(EMBEDDED_PANEL_ID);
  if (existingPanel) {
    existingPanel.remove();
    return;
  }

  const panel = document.createElement("div");
  panel.id = EMBEDDED_PANEL_ID;
  Object.assign(panel.style, {
    position: "fixed",
    top: "0",
    right: "0",
    width: "420px",
    maxWidth: "90vw",
    height: "100vh",
    zIndex: "2147483646",
    background: "#ffffff",
    boxShadow: "-8px 0 24px rgba(15, 23, 42, 0.18)"
  } satisfies Partial<CSSStyleDeclaration>);

  const iframe = document.createElement("iframe");
  iframe.src = chrome.runtime.getURL("sidepanel.html?mode=embedded");
  iframe.title = "AI Web Assistant";
  Object.assign(iframe.style, {
    width: "100%",
    height: "100%",
    border: "none"
  } satisfies Partial<CSSStyleDeclaration>);

  panel.appendChild(iframe);
  document.body.appendChild(panel);
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === "COLLECT_FIELDS") {
    sendResponse(captureFields(document, window));
    return true;
  }

  if (message.type === "TOGGLE_EMBEDDED_PANEL") {
    toggleEmbeddedPanel();
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

if (document.documentElement instanceof HTMLElement) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createFloatingButton, { once: true });
  } else {
    createFloatingButton();
  }
}
