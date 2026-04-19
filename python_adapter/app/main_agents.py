from __future__ import annotations

import json
from pathlib import Path

from .config import ADAPTER_ROOT


MainAgent = str
MAIN_AGENT_CONFIG_PATH = ADAPTER_ROOT.parent / "config" / "main-agents.json"


def _normalize_main_agent_alias(value: str) -> str:
    return value.strip().lower().replace("-", "_")


def _load_main_agent_catalog(config_path: Path) -> tuple[MainAgent, tuple[dict[str, object], ...]]:
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("Main agent catalog must be an object")

    default_main_agent = payload.get("defaultMainAgent")
    main_agents = payload.get("mainAgents")

    if not isinstance(default_main_agent, str) or not default_main_agent.strip():
        raise RuntimeError("Main agent catalog must declare a non-empty defaultMainAgent")
    if not isinstance(main_agents, list) or not main_agents:
        raise RuntimeError("Main agent catalog must declare at least one main agent")

    seen_ids: set[str] = set()
    parsed_main_agents: list[dict[str, object]] = []
    for index, entry in enumerate(main_agents):
        if not isinstance(entry, dict):
            raise RuntimeError(f"Main agent entry at index {index} must be an object")

        agent_id = entry.get("id")
        if not isinstance(agent_id, str) or not agent_id.strip():
            raise RuntimeError(f"Main agent entry at index {index} must declare a non-empty id")
        agent_id = agent_id.strip()
        if agent_id in seen_ids:
            raise RuntimeError(f"Duplicate main agent id: {agent_id}")
        seen_ids.add(agent_id)

        remote_aliases = entry.get("remoteAliases")
        aliases: list[str] = [agent_id]
        if isinstance(remote_aliases, list):
            aliases.extend(alias for alias in remote_aliases if isinstance(alias, str) and alias.strip())
        aliases = list(dict.fromkeys(alias.strip() for alias in aliases if alias.strip()))
        if not aliases:
            raise RuntimeError(f"Main agent {agent_id} must declare at least one remote alias")

        parsed_main_agents.append(
            {
                "id": agent_id,
                "label": entry.get("label", agent_id),
                "description": entry.get(
                    "description",
                    "默认主 AGENT" if agent_id == default_main_agent else "可切换的备用主 AGENT",
                ),
                "remoteAliases": aliases,
            }
        )

    if default_main_agent not in seen_ids:
        raise RuntimeError(f"defaultMainAgent {default_main_agent} is not present in mainAgents")

    return default_main_agent, tuple(parsed_main_agents)


DEFAULT_MAIN_AGENT, MAIN_AGENT_CONFIGS = _load_main_agent_catalog(MAIN_AGENT_CONFIG_PATH)
ALLOWED_MAIN_AGENTS = frozenset(str(agent["id"]) for agent in MAIN_AGENT_CONFIGS)
REMOTE_AGENT_WHITELIST: dict[MainAgent, frozenset[str]] = {
    str(agent["id"]): frozenset(_normalize_main_agent_alias(alias) for alias in list(agent["remoteAliases"]))
    for agent in MAIN_AGENT_CONFIGS
}