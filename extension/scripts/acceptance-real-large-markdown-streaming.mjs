import { runVitestSelections } from "./run-vitest-acceptance.mjs";

await runVitestSelections("真实浏览器下的大 Markdown 流式交互无卡死", [{
  file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
  testName: "真实浏览器下的大 Markdown 流式交互无卡死"
}]);