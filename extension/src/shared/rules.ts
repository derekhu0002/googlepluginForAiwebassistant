import type { CanonicalCapturedFields, CapturedFields, FieldRuleDefinition, PageRule } from "./types";

export const RULES_STORAGE_KEY = "ai-web-assistant-rules";
export interface RulesStorageLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(payload: Record<string, unknown>): Promise<void>;
}

function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultFieldTemplates(): FieldRuleDefinition[] {
  return [
    {
      id: createId("field"),
      key: "pageTitle",
      label: "页面标题",
      source: "documentTitle",
      enabled: true
    },
    {
      id: createId("field"),
      key: "pageUrl",
      label: "页面地址",
      source: "pageUrl",
      enabled: true
    },
    {
      id: createId("field"),
      key: "metaDescription",
      label: "Meta Description",
      source: "meta",
      metaName: "description",
      enabled: true
    },
    {
      id: createId("field"),
      key: "h1",
      label: "首个 H1",
      source: "selectorText",
      selector: "h1",
      enabled: true
    },
    {
      id: createId("field"),
      key: "selectedText",
      label: "选中文本",
      source: "selectedText",
      enabled: true
    }
  ];
}

export function createDefaultRule(): PageRule {
  const timestamp = nowIso();
  return {
    id: createId("rule"),
    name: "示例规则",
    hostnamePattern: "example.com",
    pathPattern: "*",
    enabled: true,
    fields: createDefaultFieldTemplates(),
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export const defaultRules: PageRule[] = [createDefaultRule()];

function normalize(value: string | null | undefined) {
  return (value ?? "").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function wildcardToRegExp(pattern: string) {
  const normalized = pattern.trim() || "*";
  const regexSource = `^${normalized.split("*").map(escapeRegExp).join(".*")}$`;
  return new RegExp(regexSource, "i");
}

export function matchesRule(url: string, rule: PageRule) {
  if (!rule.enabled) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const pathname = `${parsed.pathname}${parsed.search}`;
    return wildcardToRegExp(rule.hostnamePattern).test(hostname) && wildcardToRegExp(rule.pathPattern).test(pathname);
  } catch {
    return false;
  }
}

export function findMatchingRule(url: string | undefined, rules: PageRule[]) {
  if (!url) {
    return null;
  }

  return rules.find((rule) => matchesRule(url, rule)) ?? null;
}

function collectFieldValue(document: Document, window: Window, field: FieldRuleDefinition) {
  switch (field.source) {
    case "documentTitle":
      return normalize(document.title) || normalize(field.fallbackValue);
    case "pageUrl":
      return normalize(window.location.href) || normalize(field.fallbackValue);
    case "selectedText":
      return normalize(window.getSelection?.()?.toString()) || normalize(field.fallbackValue);
    case "meta":
      return normalize(document.querySelector(`meta[name='${field.metaName ?? "description"}']`)?.getAttribute("content")) || normalize(field.fallbackValue);
    case "selectorText":
      return normalize(field.selector ? document.querySelector(field.selector)?.textContent : "") || normalize(field.fallbackValue);
    case "selectorAttribute":
      return normalize(field.selector ? document.querySelector(field.selector)?.getAttribute(field.attribute ?? "content") : "") || normalize(field.fallbackValue);
    default:
      return normalize(field.fallbackValue);
  }
}

export function captureFields(document: Document, window: Window, fields: FieldRuleDefinition[]): CapturedFields {
  const result: CapturedFields = {};

  for (const field of fields) {
    if (!field.enabled) {
      continue;
    }

    result[field.key] = collectFieldValue(document, window, field);
  }

  return result;
}

export function toCanonicalCapturedFields(captured: CapturedFields): CanonicalCapturedFields {
  return {
    pageTitle: captured.pageTitle ?? "",
    pageUrl: captured.pageUrl ?? "",
    metaDescription: captured.metaDescription ?? "",
    h1: captured.h1 ?? "",
    selectedText: captured.selectedText ?? ""
  };
}

export async function getStoredRules(storage: Pick<RulesStorageLike, "get"> = chrome.storage.local): Promise<PageRule[]> {
  const stored = await storage.get(RULES_STORAGE_KEY);
  const rules = stored[RULES_STORAGE_KEY] as PageRule[] | undefined;
  return rules ?? defaultRules;
}

export async function saveRules(rules: PageRule[], storage: Pick<RulesStorageLike, "set"> = chrome.storage.local) {
  await storage.set({ [RULES_STORAGE_KEY]: rules });
}

export function upsertRule(rules: PageRule[], input: PageRule) {
  const nextRule: PageRule = {
    ...input,
    fields: input.fields.map((field) => ({ ...field })),
    updatedAt: nowIso(),
    createdAt: input.createdAt || nowIso()
  };
  const index = rules.findIndex((rule) => rule.id === input.id);
  if (index === -1) {
    return [...rules, nextRule];
  }

  return rules.map((rule) => rule.id === input.id ? nextRule : rule);
}

export function removeRule(rules: PageRule[], ruleId: string) {
  return rules.filter((rule) => rule.id !== ruleId);
}
