import { runVitestAcceptance } from "./run-vitest-acceptance.mjs";

await runVitestAcceptance([
  {
    file: "src/shared/pageAccess.test.ts",
    testName: "returns permission error for non-whitelisted pages"
  },
  {
    file: "src/background/index.test.ts",
    testName: "returns explicit error when no rule matches current page"
  }
]);