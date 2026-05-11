/** Guardrail: watches extension/src/sidepanel interruption tolerance so reconnection or fallback handling does not corrupt visible transcript state. */
import { runVitestAcceptance } from "../../../scripts/run-vitest-acceptance.mjs";

await runVitestAcceptance([
  {
    file: "src/shared/api.test.ts",
    testName: "does not report error after stream has already received events"
  },
  {
    file: "src/shared/api.test.ts",
    testName: "returns to streaming after reconnect open event"
  }
]);