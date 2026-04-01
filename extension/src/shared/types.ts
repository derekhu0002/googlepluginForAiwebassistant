import type { DomainError } from "./errors";

export type CapturedFields = Record<string, string>;

export interface CanonicalCapturedFields {
  pageTitle: string;
  pageUrl: string;
  metaDescription: string;
  h1: string;
  selectedText: string;
}

export type FieldSourceType =
  | "documentTitle"
  | "pageUrl"
  | "selectedText"
  | "meta"
  | "selectorText"
  | "selectorAttribute";

export interface FieldRuleDefinition {
  id: string;
  key: string;
  label: string;
  source: FieldSourceType;
  enabled: boolean;
  selector?: string;
  attribute?: string;
  metaName?: string;
  fallbackValue?: string;
}

export interface PageRule {
  id: string;
  name: string;
  hostnamePattern: string;
  pathPattern: string;
  enabled: boolean;
  fields: FieldRuleDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface MatchedRuleSummary {
  id: string;
  name: string;
}

export interface ActiveTabContext {
  tabId: number | null;
  url: string | null;
  hostname: string | null;
  restricted: boolean;
  matchedRule: MatchedRuleSummary | null;
  permissionGranted: boolean;
  permissionOrigin: string | null;
  canRequestPermission: boolean;
  activeTabFallbackAvailable: boolean;
  message: string;
}

export interface AssistantState {
  status: "idle" | "collecting" | "analyzing" | "done" | "error";
  capturedFields: CapturedFields | null;
  analysisMarkdown: string;
  error: DomainError | null;
  errorMessage: string;
  lastUpdatedAt: string | null;
  uiMode: "sidepanel" | "embedded";
  matchedRule: MatchedRuleSummary | null;
  lastCapturedUrl: string | null;
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
  | { type: "COLLECT_FIELDS"; payload: { fields: FieldRuleDefinition[] } }
  | { type: "GET_STATE" }
  | { type: "GET_RULES" }
  | { type: "UPSERT_RULE"; payload: PageRule }
  | { type: "DELETE_RULE"; payload: { ruleId: string } }
  | { type: "GET_ACTIVE_CONTEXT" }
  | { type: "REQUEST_HOST_PERMISSION" }
  | { type: "CAPTURE_AND_ANALYZE" }
  | { type: "RECAPTURE" }
  | { type: "CLEAR_RESULT" }
  | { type: "STATE_UPDATED"; payload: AssistantState };
