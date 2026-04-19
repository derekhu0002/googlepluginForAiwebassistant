import { describe, expect, it } from "vitest";

import { DEFAULT_MAIN_AGENT, MAIN_AGENT_CONFIGS, MAIN_AGENTS, getMainAgentConfig, isMainAgent, resolveConfiguredMainAgentByAlias } from "./mainAgents";

describe("main agent catalog", () => {
  it("loads the shared catalog and exposes Xagent", () => {
    expect(DEFAULT_MAIN_AGENT).toBe("TARA_analyst");
    expect(MAIN_AGENTS).toContain("Xagent");
    expect(isMainAgent("Xagent")).toBe(true);

    expect(getMainAgentConfig("Xagent")).toMatchObject({
      id: "Xagent",
      label: "Xagent"
    });

    expect(resolveConfiguredMainAgentByAlias("x-agent")).toBe("Xagent");
    expect(MAIN_AGENT_CONFIGS).toHaveLength(3);
  });
});