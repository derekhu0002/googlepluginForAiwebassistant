"""Guardrail: watches python_adapter/app main-agent catalog loading so default agent, aliases, and whitelist mappings remain canonical."""

from python_adapter.app.main_agents import ALLOWED_MAIN_AGENTS, DEFAULT_MAIN_AGENT, MAIN_AGENT_CONFIGS, REMOTE_AGENT_WHITELIST


def test_shared_main_agent_catalog_exposes_default_and_secondary_main_agents() -> None:
    assert DEFAULT_MAIN_AGENT == "ThreatIntelAnalyst"
    assert ALLOWED_MAIN_AGENTS == frozenset({"ThreatIntelAnalyst", "ThreatIntelAttributionAnalyst"})
    assert REMOTE_AGENT_WHITELIST["ThreatIntelAnalyst"] == frozenset({
        "tara_analyst",
        "threatintelanalyst",
        "threat_intel_analyst",
    })
    assert REMOTE_AGENT_WHITELIST["ThreatIntelAttributionAnalyst"] == frozenset({
        "threatintelattributionanalyst",
        "threat_intel_attribution_analyst",
        "tara_attribution_analyst",
    })
    assert MAIN_AGENT_CONFIGS == (
        {
            "id": "ThreatIntelAnalyst",
            "label": "ThreatIntelAnalyst",
            "description": "威胁情报分析 AGENT",
            "remoteAliases": [
                "ThreatIntelAnalyst",
                "threatintelanalyst",
                "threat_intel_analyst",
                "threat-intel-analyst",
                "TARA_analyst",
                "TARA-analyst",
                "tara_analyst",
                "tara-analyst",
            ],
        },
        {
            "id": "ThreatIntelAttributionAnalyst",
            "label": "ThreatIntelAttributionAnalyst",
            "description": "威胁溯源 AGENT",
            "remoteAliases": [
                "ThreatIntelAttributionAnalyst",
                "threatintelattributionanalyst",
                "threat_intel_attribution_analyst",
                "threat-intel-attribution-analyst",
                "TARA_attribution_analyst",
                "TARA-attribution-analyst",
                "tara_attribution_analyst",
                "tara-attribution-analyst",
            ],
        },
    )