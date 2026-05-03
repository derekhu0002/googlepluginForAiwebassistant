import { runVitestSelections } from "./run-vitest-acceptance.mjs";

await runVitestSelections("从 streaming 降级态收敛到最终 Markdown 后，语义与交互不变", [{
  file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
  testName: "从 streaming 降级态收敛到最终 Markdown 后，语义与交互不变"
}]);