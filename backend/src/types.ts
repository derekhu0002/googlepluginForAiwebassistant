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

export type MessageFeedbackValue = "like" | "dislike";

export interface MessageFeedbackRequest {
  runId: string;
  messageId: string;
  feedback: MessageFeedbackValue;
}

export interface MessageFeedbackResult {
  accepted: true;
  runId: string;
  messageId: string;
  feedback: MessageFeedbackValue;
  updatedAt: string;
}

export interface AnalysisProvider {
  readonly name: string;
  analyze(input: AnalyzeRequest, options?: { signal?: AbortSignal }): Promise<AnalyzeResult>;
}
