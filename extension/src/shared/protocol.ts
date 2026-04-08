export const NORMALIZED_EVENT_TYPES = ["thinking", "tool_call", "question", "result", "error"] as const;

export type NormalizedEventType = typeof NORMALIZED_EVENT_TYPES[number];
export const NORMALIZED_EVENT_CHANNELS = ["reasoning", "assistant_text"] as const;
export const NORMALIZED_EVENT_EMISSION_KINDS = ["delta", "snapshot", "final"] as const;

export type NormalizedEventChannel = typeof NORMALIZED_EVENT_CHANNELS[number];
export type NormalizedEventEmissionKind = typeof NORMALIZED_EVENT_EMISSION_KINDS[number];

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
  logData?: Record<string, unknown>;
  question?: QuestionPayload;
  semantic?: {
    channel: NormalizedEventChannel;
    emissionKind: NormalizedEventEmissionKind;
    identity: string;
    messageId?: string;
    partId?: string;
  };
}

export interface RunStreamLifecycle {
  terminalEventsDoNotGuaranteeStreamEnd: true;
}

export const RUN_STREAM_LIFECYCLE: RunStreamLifecycle = {
  terminalEventsDoNotGuaranteeStreamEnd: true
};

export interface RunStartRequest {
  prompt: string;
  capture?: Record<string, string>;
  sessionId?: string;
  context: {
    source: string;
    capturedAt: string;
    username: string;
    usernameSource: UsernameSource;
    pageTitle?: string;
    pageUrl?: string;
  };
}

export interface QuestionAnswerRequest {
  questionId: string;
  answer: string;
  choiceId?: string;
}

export const MESSAGE_FEEDBACK_VALUES = ["like", "dislike"] as const;

export type MessageFeedbackValue = typeof MESSAGE_FEEDBACK_VALUES[number];

export interface MessageFeedbackRequest {
  runId: string;
  messageId: string;
  feedback: MessageFeedbackValue;
}

export interface MessageFeedbackResponse {
  accepted: true;
  runId: string;
  messageId: string;
  feedback: MessageFeedbackValue;
  updatedAt: string;
}

export interface RunRecord {
  runId: string;
  sessionId?: string;
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
