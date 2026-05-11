/** Guardrail: watches extension/src/sidepanel live Markdown degradation so incomplete syntax does not block rendering before final stabilization. */
import { runVitestSelections } from "../../../scripts/run-vitest-acceptance.mjs";

await runVitestSelections("未完成 Markdown 在 streaming 阶段的降级渲染策略", [{
  file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
  testName: "未完成 Markdown 在 streaming 阶段的降级渲染策略"
}]);