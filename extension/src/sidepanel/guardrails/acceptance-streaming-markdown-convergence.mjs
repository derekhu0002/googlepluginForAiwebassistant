/** Guardrail: watches extension/src/sidepanel streaming-to-final Markdown convergence so degraded live rendering still settles to the canonical transcript. */
import { runVitestSelections } from "../../../scripts/run-vitest-acceptance.mjs";

await runVitestSelections("从 streaming 降级态收敛到最终 Markdown 后，语义与交互不变", [{
  file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
  testName: "从 streaming 降级态收敛到最终 Markdown 后，语义与交互不变"
}]);