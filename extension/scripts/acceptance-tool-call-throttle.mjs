import { runVitestSelections } from "./run-vitest-acceptance.mjs";

await runVitestSelections("高频 Tool-Call 事件的“节流”处理", [{
  file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
  testName: "高频 Tool-Call 事件的“节流”处理"
}]);