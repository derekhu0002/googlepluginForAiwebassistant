import { assertDomainAccessDenied, runSmokeAndLoadArtifacts } from "./real-smoke-assertions.mjs";

const artifacts = await runSmokeAndLoadArtifacts({
  env: {
    REAL_SMOKE_REQUIRE_REPO_STUB: "1",
    REAL_SMOKE_SCENARIO: "domain-access-control"
  }
});

assertDomainAccessDenied(artifacts);

console.log(JSON.stringify({
  testcase: "RealDomainAccessControl",
  result: "passed"
}, null, 2));