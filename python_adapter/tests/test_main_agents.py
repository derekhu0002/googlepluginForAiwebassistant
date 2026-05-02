from python_adapter.app.main_agents import ALLOWED_MAIN_AGENTS, DEFAULT_MAIN_AGENT, MAIN_AGENT_CONFIGS, REMOTE_AGENT_WHITELIST


def test_shared_main_agent_catalog_exposes_single_threat_intel_analyst() -> None:
    assert DEFAULT_MAIN_AGENT == "ThreatIntelAnalyst"
    assert ALLOWED_MAIN_AGENTS == frozenset({"ThreatIntelAnalyst"})
    assert REMOTE_AGENT_WHITELIST["ThreatIntelAnalyst"] == frozenset({
        "tara_analyst",
        "threatintelanalyst",
        "threat_intel_analyst",
    })
    assert MAIN_AGENT_CONFIGS == (
        {
            "id": "ThreatIntelAnalyst",
            "label": "ThreatIntelAnalyst",
            "description": "唯一主 AGENT",
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
    )