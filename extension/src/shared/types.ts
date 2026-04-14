import type { DomainError } from "./errors";
import type {
  AnswerRecord,
  MainAgent,
  MessageFeedbackRequest,
  MessageFeedbackResponse,
  NormalizedRunEvent,
  QuestionAnswerRequest,
  RunEventState,
  RunStateSyncMetadata,
  RunHistoryDetail,
  RunRecord,
  UsernameSource
} from "./protocol";

export type CapturedFields = Record<string, string>;

export interface CanonicalCapturedFields {
  pageTitle: string;
  pageUrl: string;
  metaDescription: string;
  h1: string;
  selectedText: string;
  software_version?: string;
  selected_sr?: string;
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

export interface UsernameContext {
  username: string;
  usernameSource: UsernameSource;
}

export interface StreamConnectionState {
  runId: string | null;
  status: "idle" | "connecting" | "streaming" | "reconnecting" | "waiting_for_answer" | "done" | "error";
  pendingQuestionId: string | null;
  reconnectCount?: number;
}

export interface AssistantState {
  status: "idle" | "collecting" | "streaming" | "waiting_for_answer" | "done" | "error";
  mainAgentPreference: MainAgent;
  activeSessionId: string | null;
  capturedFields: CapturedFields | null;
  runPrompt: string;
  runEvents: NormalizedRunEvent[];
  currentRun: RunRecord | null;
  history: RunRecord[];
  selectedHistoryDetail: RunHistoryDetail | null;
  answers: AnswerRecord[];
  error: DomainError | null;
  errorMessage: string;
  lastUpdatedAt: string | null;
  uiMode: "sidepanel" | "embedded";
  matchedRule: MatchedRuleSummary | null;
  lastCapturedUrl: string | null;
  usernameContext: UsernameContext | null;
  stream: StreamConnectionState;
  runEventState: RunEventState;
  syncMetadata: RunStateSyncMetadata | null;
}

export type SyncableAssistantRunState = Pick<AssistantState,
  "status"
  | "activeSessionId"
  | "capturedFields"
  | "runPrompt"
  | "runEvents"
  | "currentRun"
  | "answers"
  | "error"
  | "errorMessage"
  | "matchedRule"
  | "lastCapturedUrl"
  | "usernameContext"
  | "stream"
  | "runEventState"
  | "syncMetadata"
>;

export interface StartRunResponse {
  ok: true;
  data: {
    runId: string;
    selectedAgent: MainAgent;
    sessionId?: string;
  };
}

export interface ExtensionApiFailureResponse {
  ok: false;
  error: DomainError;
}

export type StartRunApiResponse = StartRunResponse | ExtensionApiFailureResponse;

export interface AnswerSuccessResponse {
  ok: true;
  data: {
    accepted: true;
    runId: string;
    questionId: string;
  };
}

export type AnswerApiResponse = AnswerSuccessResponse | ExtensionApiFailureResponse;

export interface FeedbackSuccessResponse {
  ok: true;
  data: MessageFeedbackResponse;
}

export type FeedbackApiResponse = FeedbackSuccessResponse | ExtensionApiFailureResponse;

export interface MessageFeedbackUiState {
  status: "idle" | "submitting" | "submitted" | "error";
  selected?: MessageFeedbackRequest["feedback"];
  message?: string;
}

export interface ContentScriptReadyResponse {
  ready: true;
}

export type RuntimeMessage =
  | { type: "OPEN_PANEL" }
  | { type: "PING" }
  | { type: "TOGGLE_EMBEDDED_PANEL" }
  | { type: "COLLECT_FIELDS"; payload: { fields: FieldRuleDefinition[] } }
  | { type: "GET_USERNAME_CONTEXT" }
  | { type: "GET_STATE" }
  | { type: "GET_RULES" }
  | { type: "UPSERT_RULE"; payload: PageRule }
  | { type: "DELETE_RULE"; payload: { ruleId: string } }
  | { type: "GET_ACTIVE_CONTEXT" }
  | {
      type: "START_RUN";
      payload: {
        prompt: string;
        selectedAgent: MainAgent;
        sessionId?: string;
        capturePageData?: boolean;
        retryFromRunId?: string;
        retryFromMessageId?: string;
      };
    }
  | { type: "SET_MAIN_AGENT"; payload: { selectedAgent: MainAgent } }
  | {
      type: "SYNC_RUN_STATE";
      payload: SyncableAssistantRunState;
    }
  | { type: "SUBMIT_QUESTION_ANSWER"; payload: QuestionAnswerRequest }
  | { type: "RECAPTURE" }
  | { type: "CLEAR_RESULT" }
  | { type: "SELECT_HISTORY_RUN"; payload: { runId: string } }
  | { type: "HISTORY_UPDATED"; payload: { history: RunRecord[]; selectedHistoryDetail: RunHistoryDetail | null } }
  | { type: "STATE_UPDATED"; payload: AssistantState };
