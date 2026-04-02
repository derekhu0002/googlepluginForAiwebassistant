import type { AssistantState } from "./types";

export const STORAGE_KEY = "ai-web-assistant-state";

export const initialAssistantState: AssistantState = {
  status: "idle",
  capturedFields: null,
  runPrompt: "请总结当前 SR 的风险与建议下一步动作。",
  runEvents: [],
  currentRun: null,
  history: [],
  selectedHistoryDetail: null,
  answers: [],
  error: null,
  errorMessage: "",
  lastUpdatedAt: null,
  uiMode: "sidepanel",
  matchedRule: null,
  lastCapturedUrl: null,
  usernameContext: null,
  stream: {
    runId: null,
    status: "idle",
    pendingQuestionId: null
  }
};
