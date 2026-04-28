import { runVitestSelections } from "./run-vitest-acceptance.mjs";

await runVitestSelections("会话历史（History）的本地持久化读取", [
  {
    file: "src/shared/history.test.ts",
    testName: "persists run, events and answers"
  },
  {
    file: "src/sidepanel/App.test.tsx",
    testName: "shows final answer in history detail with projected reasoning steps"
  }
]);