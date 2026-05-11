/** Guardrail: watches extension/src/sidepanel long-session rendering so history growth does not trigger runaway memory or full DOM repaint regressions. */
import { runVitestSelections } from "../../../scripts/run-vitest-acceptance.mjs";

await runVitestSelections("长会话内存管理与 DOM 负载优化", [{
  file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
  testName: "长会话内存管理与 DOM 负载优化"
}]);