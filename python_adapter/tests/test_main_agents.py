from python_adapter.app.main_agents import ALLOWED_MAIN_AGENTS, DEFAULT_MAIN_AGENT, MAIN_AGENT_CONFIGS, REMOTE_AGENT_WHITELIST


def test_shared_main_agent_catalog_exposes_xagent() -> None:
    assert DEFAULT_MAIN_AGENT == "TARA_analyst"
    assert "Xagent" in ALLOWED_MAIN_AGENTS
    assert REMOTE_AGENT_WHITELIST["Xagent"] == frozenset({"xagent", "x_agent"})
    assert any(agent["id"] == "Xagent" for agent in MAIN_AGENT_CONFIGS)