import { describe, expect, it } from "vitest";

import { DEFAULT_MAIN_AGENT, MAIN_AGENT_CONFIGS, MAIN_AGENTS, getMainAgentConfig, isMainAgent, resolveConfiguredMainAgentByAlias } from "./mainAgents";

describe("main agent catalog", () => {
  it("loads the shared catalog and exposes the single supported agent", () => {
    expect(DEFAULT_MAIN_AGENT).toBe("ThreatIntelAnalyst");
    expect(MAIN_AGENTS).toEqual(["ThreatIntelAnalyst"]);
    expect(isMainAgent("ThreatIntelAnalyst")).toBe(true);

    expect(getMainAgentConfig("ThreatIntelAnalyst")).toMatchObject({
      id: "ThreatIntelAnalyst",
      label: "ThreatIntelAnalyst"
    });

    expect(resolveConfiguredMainAgentByAlias("threat-intel-analyst")).toBe("ThreatIntelAnalyst");
    expect(MAIN_AGENT_CONFIGS).toHaveLength(1);
  });
});