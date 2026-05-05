import { describe, expect, it } from "vitest";

import { DEFAULT_MAIN_AGENT, MAIN_AGENT_CONFIGS, MAIN_AGENTS, getMainAgentConfig, isMainAgent, resolveConfiguredMainAgentByAlias } from "./mainAgents";

describe("main agent catalog", () => {
  it("loads the shared catalog and exposes both configured main agents", () => {
    expect(DEFAULT_MAIN_AGENT).toBe("ThreatIntelAnalyst");
    expect(MAIN_AGENTS).toEqual(["ThreatIntelAnalyst", "ThreatIntelAttributionAnalyst"]);
    expect(isMainAgent("ThreatIntelAnalyst")).toBe(true);
    expect(isMainAgent("ThreatIntelAttributionAnalyst")).toBe(true);

    expect(getMainAgentConfig("ThreatIntelAnalyst")).toMatchObject({
      id: "ThreatIntelAnalyst",
      label: "ThreatIntelAnalyst"
    });
    expect(getMainAgentConfig("ThreatIntelAttributionAnalyst")).toMatchObject({
      id: "ThreatIntelAttributionAnalyst",
      label: "ThreatIntelAttributionAnalyst"
    });

    expect(resolveConfiguredMainAgentByAlias("threat-intel-analyst")).toBe("ThreatIntelAnalyst");
    expect(resolveConfiguredMainAgentByAlias("threat-intel-attribution-analyst")).toBe("ThreatIntelAttributionAnalyst");
    expect(MAIN_AGENT_CONFIGS).toHaveLength(2);
  });
});