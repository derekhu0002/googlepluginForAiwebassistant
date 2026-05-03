import { runVitestSelections } from "./run-vitest-acceptance.mjs";

await runVitestSelections("最终大 Markdown 终态保真", [{
  file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
  testName: "最终大 Markdown 终态保真"
}]);