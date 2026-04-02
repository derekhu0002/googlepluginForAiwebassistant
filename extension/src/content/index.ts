import type { FieldRuleDefinition, RuntimeMessage, UsernameContext } from "../shared/types";

const FLOATING_BUTTON_ID = "ai-web-assistant-floating-button";
const EMBEDDED_PANEL_ID = "ai-web-assistant-embedded-panel";

function normalized(value: string | null | undefined) {
  return (value ?? "").trim();
}

function collectFieldValue(document: Document, window: Window, field: FieldRuleDefinition) {
  switch (field.source) {
    case "documentTitle":
      return normalized(document.title) || normalized(field.fallbackValue);
    case "pageUrl":
      return normalized(window.location.href) || normalized(field.fallbackValue);
    case "selectedText":
      return normalized(window.getSelection?.()?.toString()) || normalized(field.fallbackValue);
    case "meta":
      return normalized(document.querySelector(`meta[name='${field.metaName ?? "description"}']`)?.getAttribute("content")) || normalized(field.fallbackValue);
    case "selectorText":
      return normalized(field.selector ? document.querySelector(field.selector)?.textContent : "") || normalized(field.fallbackValue);
    case "selectorAttribute":
      return normalized(field.selector ? document.querySelector(field.selector)?.getAttribute(field.attribute ?? "content") : "") || normalized(field.fallbackValue);
    default:
      return normalized(field.fallbackValue);
  }
}

function captureFields(document: Document, window: Window, fields: FieldRuleDefinition[]) {
  const result: Record<string, string> = {};

  for (const field of fields) {
    if (!field.enabled) {
      continue;
    }

    result[field.key] = collectFieldValue(document, window, field);
  }

  return result;
}

const USERNAME_DOM_SELECTORS = [
  "[data-username]",
  "[data-user-name]",
  "[data-testid='username']",
  "[data-testid='user-name']",
  ".user-name",
  ".username",
  "#username"
];

function extractUsernameContext(input: { document: Document; window: Window & typeof globalThis }): UsernameContext {
  for (const selector of USERNAME_DOM_SELECTORS) {
    const element = input.document.querySelector(selector);
    if (!element) {
      continue;
    }

    const direct = normalized(element.getAttribute("data-username") ?? element.getAttribute("data-user-name"));
    if (direct) {
      return { username: direct, usernameSource: "dom_data_attribute" };
    }

    const text = normalized(element.textContent);
    if (text) {
      return { username: text, usernameSource: "dom_text" };
    }
  }

  const meta = input.document.querySelector("meta[name='logged-in-user'],meta[name='username'],meta[property='og:username']");
  const metaValue = normalized(meta?.getAttribute("content"));
  if (metaValue) {
    return { username: metaValue, usernameSource: "meta_tag" };
  }

  const candidates = [
    (input.window as Window & { __AI_WEB_ASSISTANT_USER__?: unknown }).__AI_WEB_ASSISTANT_USER__,
    (input.window as Window & { __CURRENT_USER__?: unknown }).__CURRENT_USER__,
    (input.window as Window & { currentUser?: unknown }).currentUser
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && normalized(candidate)) {
      return { username: normalized(candidate), usernameSource: "page_global" };
    }

    if (candidate && typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      const nested = [record.username, record.userName, record.name].find((value) => typeof value === "string" && normalized(value as string));
      if (typeof nested === "string") {
        return { username: normalized(nested), usernameSource: "page_global" };
      }
    }
  }

  return {
    username: "unknown",
    usernameSource: input.document.body ? "unknown_fallback" : "unresolved_login_state"
  };
}

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
  if (message.type === "PING") {
    sendResponse({ ready: true });
    return true;
  }

  if (message.type === "COLLECT_FIELDS") {
    sendResponse(captureFields(document, window, message.payload.fields));
    return true;
  }

  if (message.type === "GET_USERNAME_CONTEXT") {
    sendResponse(extractUsernameContext({ document, window }));
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
