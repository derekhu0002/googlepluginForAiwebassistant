export const NORMALIZED_EVENT_TYPES = ["thinking", "tool_call", "question", "result", "error"] as const;

export type NormalizedEventType = typeof NORMALIZED_EVENT_TYPES[number];

export type UsernameSource =
  | "dom_data_attribute"
  | "dom_text"
  | "meta_tag"
  | "page_global"
  | "unknown_fallback"
  | "unresolved_login_state";

export interface QuestionOption {
  id: string;
  label: string;
  value: string;
}

export interface QuestionPayload {
  questionId: string;
  title: string;
  message: string;
  options: QuestionOption[];
  allowFreeText: boolean;
  placeholder?: string;
}

export interface NormalizedRunEvent {
  id: string;
  runId: string;
  type: NormalizedEventType;
  createdAt: string;
  sequence: number;
  message: string;
  title?: string;
  data?: Record<string, unknown>;
  question?: QuestionPayload;
}

export interface RunStartRequest {
  prompt: string;
  capture: Record<string, string>;
  context: {
    source: string;
    capturedAt: string;
    username: string;
    usernameSource: UsernameSource;
    pageTitle: string;
    pageUrl: string;
  };
}

export interface QuestionAnswerRequest {
  questionId: string;
  answer: string;
  choiceId?: string;
}

export interface RunRecord {
  runId: string;
  prompt: string;
  username: string;
  usernameSource: UsernameSource;
  softwareVersion: string;
  selectedSr: string;
  pageTitle: string;
  pageUrl: string;
  status: "streaming" | "waiting_for_answer" | "done" | "error";
  startedAt: string;
  updatedAt: string;
  finalOutput: string;
  errorMessage?: string;
}

export interface AnswerRecord {
  id: string;
  runId: string;
  questionId: string;
  answer: string;
  choiceId?: string;
  submittedAt: string;
}

export interface RunHistoryDetail {
  run: RunRecord;
  events: NormalizedRunEvent[];
  answers: AnswerRecord[];
}
