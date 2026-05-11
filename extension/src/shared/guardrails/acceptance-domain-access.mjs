/** Guardrail: watches extension/src/shared domain-access policy so restricted pages fail consistently before orchestration proceeds. */
import { runVitestSelections } from "../../../scripts/run-vitest-acceptance.mjs";

await runVitestSelections("域名授权与访问控制逻辑", [
  {
    file: "src/shared/pageAccess.test.ts",
    testName: "returns permission error for non-whitelisted pages"
  },
  {
    file: "src/background/index.test.ts",
    testName: "returns explicit permission error when capture-bearing run start is not authorized"
  },
  {
    file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
    testName: "域名授权与访问控制逻辑"
  }
]);