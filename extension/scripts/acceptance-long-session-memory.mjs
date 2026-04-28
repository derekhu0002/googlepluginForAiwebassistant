import { runVitestSelections } from "./run-vitest-acceptance.mjs";

await runVitestSelections("长会话内存管理与 DOM 负载优化", [{
  file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
  line: 162
}
]);