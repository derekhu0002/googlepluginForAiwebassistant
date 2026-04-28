import { runVitestSelections } from "./run-vitest-acceptance.mjs";

await runVitestSelections("SSE 连接意外中断的容错处理", [
  {
    file: "src/shared/api.test.ts",
    testName: "does not report error after stream has already received events"
  },
  {
    file: "src/shared/api.test.ts",
    testName: "returns to streaming after reconnect open event"
  }
]);