import { runVitestSelections } from "./run-vitest-acceptance.mjs";

await runVitestSelections("流式消息渲染的 UI 线程隔离 (防止卡死)", [{
  file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
  line: 96
}
]);