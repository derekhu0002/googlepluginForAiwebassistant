/** Guardrail: watches extension/src/sidepanel render scheduling so high-frequency streaming updates do not freeze input or agent switching. */
import { runVitestSelections } from "../../../scripts/run-vitest-acceptance.mjs";

await runVitestSelections("流式消息渲染的 UI 线程隔离 (防止卡死)", [{
  file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
  testName: "流式消息渲染的 UI 线程隔离 \\(防止卡死\\)"
}]);