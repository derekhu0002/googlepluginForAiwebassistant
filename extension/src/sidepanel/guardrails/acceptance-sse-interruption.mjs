/** Guardrail: watches extension/src/sidepanel interrupted streaming behavior so partial assistant Markdown remains visible after transport failure. */
import { runVitestSelections } from "../../../scripts/run-vitest-acceptance.mjs";

await runVitestSelections("SSE 连接意外中断的容错处理", [
  {
    file: "src/shared/api.test.ts",
    testName: "does not report error after stream has already received events"
  },
  {
    file: "src/shared/api.test.ts",
    testName: "returns to streaming after reconnect open event"
  },
  {
    file: "src/sidepanel/missingCriteria.acceptance.test.tsx",
    testName: "SSE 连接意外中断的容错处理"
  }
]);