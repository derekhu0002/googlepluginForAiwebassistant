import type { AnalysisProvider, AnalyzeRequest, AnalyzeResult } from "../types.js";

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    function onAbort() {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    }

    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class MockAnalysisProvider implements AnalysisProvider {
  readonly name = "mock-analysis-provider";

  constructor(private readonly delayMs: number) {}

  async analyze(input: AnalyzeRequest, options?: { signal?: AbortSignal }): Promise<AnalyzeResult> {
    const startedAt = Date.now();
    await sleep(this.delayMs, options?.signal);

    const { capture } = input;
    const emphasis = capture.selectedText
      ? `当前用户高亮文本：> ${capture.selectedText}`
      : "当前页面没有高亮文本，建议结合标题与 H1 做整体理解。";

    return {
      provider: this.name,
      durationMs: Date.now() - startedAt,
      markdown: [
        "# 页面分析结果",
        "",
        "## 摘要",
        `- 页面标题：**${capture.pageTitle || "未获取"}**`,
        `- 页面地址：${capture.pageUrl || "未获取"}`,
        `- 页面主标题：${capture.h1 || "未获取"}`,
        "",
        "## 观察",
        `- Meta Description：${capture.metaDescription || "空"}`,
        `- ${emphasis}`,
        "",
        "## 建议",
        "1. 优先核对页面标题与 H1 是否一致。",
        "2. 若高亮文本存在，可作为后续真实 LLM 总结的重点上下文。",
        "3. 当前为 Mock Provider，后续可替换为真实模型提供商。"
      ].join("\n")
    };
  }
}
