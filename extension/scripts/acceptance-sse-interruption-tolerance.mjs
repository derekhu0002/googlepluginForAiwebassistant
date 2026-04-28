import { runVitestAcceptance } from "./run-vitest-acceptance.mjs";

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