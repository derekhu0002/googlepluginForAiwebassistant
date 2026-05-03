import { runVitestSelections } from "./run-vitest-acceptance.mjs";

await runVitestSelections("诊断日志（Diagnostics）的导出完整性", [
  {
    file: "src/sidepanel/diagnostics.test.ts",
    testName: "formats a human-readable diagnostics log"
  },
  {
    file: "src/sidepanel/App.test.tsx",
    testName: "exports diagnostics for the selected run"
  },
  {
    file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
    testName: "诊断日志（Diagnostics）的导出完整性"
  }
]);