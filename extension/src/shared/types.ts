import type { DomainError } from "./errors";

export interface CapturedFields {
  pageTitle: string;
  pageUrl: string;
  metaDescription: string;
  h1: string;
  selectedText: string;
}

export interface AssistantState {
  status: "idle" | "collecting" | "analyzing" | "done" | "error";
  capturedFields: CapturedFields | null;
  analysisMarkdown: string;
  error: DomainError | null;
  errorMessage: string;
  lastUpdatedAt: string | null;
  uiMode: "sidepanel" | "embedded";
}

export interface AnalyzeSuccessResponse {
  ok: true;
  data: {
    markdown: string;
    provider: string;
    durationMs: number;
  };
}

export interface AnalyzeFailureResponse {
  ok: false;
  error: DomainError;
}

export type AnalyzeApiResponse = AnalyzeSuccessResponse | AnalyzeFailureResponse;

export type RuntimeMessage =
  | { type: "OPEN_PANEL" }
  | { type: "TOGGLE_EMBEDDED_PANEL" }
  | { type: "COLLECT_FIELDS" }
  | { type: "GET_STATE" }
  | { type: "CAPTURE_AND_ANALYZE" }
  | { type: "RECAPTURE" }
  | { type: "CLEAR_RESULT" }
  | { type: "STATE_UPDATED"; payload: AssistantState };
