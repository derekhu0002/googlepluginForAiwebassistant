/** Guardrail: watches extension/src/sidepanel large Markdown rendering so expensive tables and long code blocks do not cause visible freezes. */
import { runVitestSelections } from "../../../scripts/run-vitest-acceptance.mjs";

await runVitestSelections("大数据量 Markdown 解析性能基准", [{
  file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
  testName: "大数据量 Markdown 解析性能基准"
}]);