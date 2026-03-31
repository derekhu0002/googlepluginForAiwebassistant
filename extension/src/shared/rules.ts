import type { CapturedFields } from "./types";

export interface CaptureRule {
  key: keyof CapturedFields;
  label: string;
  collect: (document: Document, window: Window) => string;
}

const normalize = (value: string | null | undefined) => (value ?? "").trim();

export const defaultCaptureRules: CaptureRule[] = [
  {
    key: "pageTitle",
    label: "页面标题",
    collect: (document) => normalize(document.title)
  },
  {
    key: "pageUrl",
    label: "页面地址",
    collect: (_document, window) => normalize(window.location.href)
  },
  {
    key: "metaDescription",
    label: "Meta Description",
    collect: (document) => normalize(document.querySelector("meta[name='description']")?.getAttribute("content"))
  },
  {
    key: "h1",
    label: "首个 H1",
    collect: (document) => normalize(document.querySelector("h1")?.textContent)
  },
  {
    key: "selectedText",
    label: "选中文本",
    collect: (_document, window) => normalize(window.getSelection?.()?.toString())
  }
];

export function captureFields(document: Document, window: Window, rules = defaultCaptureRules): CapturedFields {
  return rules.reduce<CapturedFields>((accumulator, rule) => {
    accumulator[rule.key] = rule.collect(document, window);
    return accumulator;
  }, {
    pageTitle: "",
    pageUrl: "",
    metaDescription: "",
    h1: "",
    selectedText: ""
  });
}
