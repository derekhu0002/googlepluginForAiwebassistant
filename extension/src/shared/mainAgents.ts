import rawMainAgentCatalog from "../../../config/main-agents.json";

export type MainAgent = string;

export interface MainAgentConfig {
  id: MainAgent;
  label: string;
  description: string;
  remoteAliases: string[];
}

interface MainAgentCatalogFile {
  defaultMainAgent: string;
  mainAgents: Array<{
    id: string;
    label?: string;
    description?: string;
    remoteAliases?: string[];
  }>;
}

function normalizeMainAgentAlias(value: string) {
  return value.trim().toLowerCase().replace(/-/gu, "_");
}

function parseMainAgentCatalog(value: unknown): { defaultMainAgent: MainAgent; mainAgents: MainAgentConfig[] } {
  if (!value || typeof value !== "object") {
    throw new Error("Main agent catalog must be an object");
  }

  const { defaultMainAgent, mainAgents } = value as Partial<MainAgentCatalogFile>;
  if (typeof defaultMainAgent !== "string" || !defaultMainAgent.trim()) {
    throw new Error("Main agent catalog must declare a non-empty defaultMainAgent");
  }

  if (!Array.isArray(mainAgents) || !mainAgents.length) {
    throw new Error("Main agent catalog must declare at least one main agent");
  }

  const seenIds = new Set<string>();
  const parsedMainAgents = mainAgents.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Main agent entry at index ${index} must be an object`);
    }

    const id = entry.id?.trim();
    if (!id) {
      throw new Error(`Main agent entry at index ${index} must declare a non-empty id`);
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate main agent id: ${id}`);
    }
    seenIds.add(id);

    const remoteAliases = Array.from(new Set([id, ...(entry.remoteAliases ?? [])]
      .map((alias) => typeof alias === "string" ? alias.trim() : "")
      .filter(Boolean)));
    if (!remoteAliases.length) {
      throw new Error(`Main agent ${id} must declare at least one remote alias`);
    }

    return Object.freeze({
      id,
      label: entry.label?.trim() || id,
      description: entry.description?.trim() || (id === defaultMainAgent ? "默认主 AGENT" : "可切换的备用主 AGENT"),
      remoteAliases
    });
  });

  if (!seenIds.has(defaultMainAgent)) {
    throw new Error(`defaultMainAgent ${defaultMainAgent} is not present in mainAgents`);
  }

  return {
    defaultMainAgent,
    mainAgents: parsedMainAgents
  };
}

const parsedMainAgentCatalog = parseMainAgentCatalog(rawMainAgentCatalog);

export const MAIN_AGENT_CONFIGS = Object.freeze(parsedMainAgentCatalog.mainAgents);
export const MAIN_AGENTS = Object.freeze(MAIN_AGENT_CONFIGS.map((agent) => agent.id));
export const DEFAULT_MAIN_AGENT: MainAgent = parsedMainAgentCatalog.defaultMainAgent;

const MAIN_AGENT_SET = new Set(MAIN_AGENTS);
const MAIN_AGENT_CONFIG_MAP = new Map(MAIN_AGENT_CONFIGS.map((agent) => [agent.id, agent]));
const MAIN_AGENT_ALIAS_MAP = new Map(
  MAIN_AGENT_CONFIGS.flatMap((agent) => agent.remoteAliases.map((alias) => [normalizeMainAgentAlias(alias), agent.id] as const))
);

export function isMainAgent(value: unknown): value is MainAgent {
  return typeof value === "string" && MAIN_AGENT_SET.has(value);
}

export function getMainAgentConfig(agent: string) {
  return MAIN_AGENT_CONFIG_MAP.get(agent) ?? null;
}

export function resolveConfiguredMainAgentByAlias(alias: string) {
  return MAIN_AGENT_ALIAS_MAP.get(normalizeMainAgentAlias(alias)) ?? null;
}