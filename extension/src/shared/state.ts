import type { AssistantState } from "./types";

export const STORAGE_KEY = "ai-web-assistant-state";

export const initialAssistantState: AssistantState = {
  status: "idle",
  capturedFields: null,
  analysisMarkdown: "",
  error: null,
  errorMessage: "",
  lastUpdatedAt: null,
  uiMode: "sidepanel"
};
