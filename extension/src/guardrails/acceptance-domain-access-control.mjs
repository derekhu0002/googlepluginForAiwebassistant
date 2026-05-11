/** Guardrail: watches extension/src authorization orchestration so unauthorized pages are rejected before any capture-bearing run is created. */
import { assertDomainAccessDenied, runSmokeAndLoadArtifacts } from "../../scripts/real-smoke-assertions.mjs";

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