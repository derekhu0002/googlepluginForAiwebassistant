/** Guardrail: watches extension/src/sidepanel tool-call burst handling so throttling reduces churn without leaking tool transcript to the main stage. */
import { runVitestSelections } from "../../../scripts/run-vitest-acceptance.mjs";

await runVitestSelections("高频 Tool-Call 事件的“节流”处理", [{
  file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
  testName: "高频 Tool-Call 事件的“节流”处理"
}]);