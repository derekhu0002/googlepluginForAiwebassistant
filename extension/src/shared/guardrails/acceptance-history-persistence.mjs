/** Guardrail: watches extension/src/shared history persistence so stored runs, events, and answers can be restored without breaking transcript projection. */
import { runVitestSelections } from "../../../scripts/run-vitest-acceptance.mjs";

await runVitestSelections("会话历史（History）的本地持久化读取", [
  {
    file: "src/shared/history.test.ts",
    testName: "persists run, events and answers"
  },
  {
    file: "src/sidepanel/App.test.tsx",
    testName: "shows final answer in history detail with projected reasoning steps"
  },
  {
    file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
    testName: "会话历史（History）的本地持久化读取"
  }
]);