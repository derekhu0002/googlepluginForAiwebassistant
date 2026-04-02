import type { UsernameContext } from "./types";

interface UsernameExtractionInput {
  document: Document;
  window: Window & typeof globalThis;
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

function normalized(value: string | null | undefined) {
  return (value ?? "").trim();
}

function fromDomAttributes(doc: Document): UsernameContext | null {
  for (const selector of USERNAME_DOM_SELECTORS) {
    const element = doc.querySelector(selector);
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

  return null;
}

function fromMeta(doc: Document): UsernameContext | null {
  const meta = doc.querySelector("meta[name='logged-in-user'],meta[name='username'],meta[property='og:username']");
  const value = normalized(meta?.getAttribute("content"));
  return value ? { username: value, usernameSource: "meta_tag" } : null;
}

function fromWindow(windowObject: Window & typeof globalThis): UsernameContext | null {
  const candidates = [
    (windowObject as Window & { __AI_WEB_ASSISTANT_USER__?: unknown }).__AI_WEB_ASSISTANT_USER__,
    (windowObject as Window & { __CURRENT_USER__?: unknown }).__CURRENT_USER__,
    (windowObject as Window & { currentUser?: unknown }).currentUser
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

  return null;
}

export function extractUsernameContext(input: UsernameExtractionInput): UsernameContext {
  return fromDomAttributes(input.document)
    ?? fromMeta(input.document)
    ?? fromWindow(input.window)
    ?? {
      username: "unknown",
      usernameSource: input.document.body ? "unknown_fallback" : "unresolved_login_state"
    };
}
