/** Guardrail: watches extension/src/sidepanel final Markdown rendering so headings, tables, code fences, links, and raw-HTML policy stay stable. */
import { runVitestSelections } from "../../../scripts/run-vitest-acceptance.mjs";

await runVitestSelections("最终大 Markdown 终态保真", [{
  file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
  testName: "最终大 Markdown 终态保真"
}]);