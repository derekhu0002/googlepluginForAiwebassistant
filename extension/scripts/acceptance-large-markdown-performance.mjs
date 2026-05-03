import { runVitestSelections } from "./run-vitest-acceptance.mjs";

await runVitestSelections("大数据量 Markdown 解析性能基准", [{
  file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
  testName: "大数据量 Markdown 解析性能基准"
}]);