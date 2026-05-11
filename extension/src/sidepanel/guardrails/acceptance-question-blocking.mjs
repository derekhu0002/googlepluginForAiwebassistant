/** Guardrail: watches extension/src/sidepanel question interaction so pending-question UI, submit payload, and blocking state remain aligned. */
import { runVitestSelections } from "../../../scripts/run-vitest-acceptance.mjs";

await runVitestSelections("人工追问事件（Question）的阻断性交互", [
  {
    file: "src/shared/api.test.ts",
    testName: "submits question answers"
  },
  {
    file: "src/sidepanel/App.test.tsx",
    testName: "clears the waiting question state immediately after answer submission"
  },
  {
    file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
    testName: "人工追问事件（Question）的阻断性交互"
  }
]);