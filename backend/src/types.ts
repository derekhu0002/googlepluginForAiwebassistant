export type CapturePayload = Record<string, string> & {
  pageTitle: string;
  pageUrl: string;
  metaDescription: string;
  h1: string;
  selectedText: string;
};

export interface AnalyzeRequest {
  capture: CapturePayload;
  context?: {
    source?: string;
    capturedAt?: string;
  };
}

export interface AnalyzeResult {
  markdown: string;
  provider: string;
  durationMs: number;
}

export interface AnalysisProvider {
  readonly name: string;
  analyze(input: AnalyzeRequest, options?: { signal?: AbortSignal }): Promise<AnalyzeResult>;
}
