export type V2Mode = "off" | "shadow" | "v2-recall" | "v2-write";
export type V2ModeSource =
  | "env_global"
  | "env_agent_off"
  | "env_agent_shadow"
  | "env_agent_recall"
  | "env_agent_write";

const modes: V2Mode[] = ["off", "shadow", "v2-recall", "v2-write"];

export function parseV2Mode(raw: string | undefined, fallback: V2Mode = "shadow"): V2Mode {
  return modes.includes(raw as V2Mode) ? (raw as V2Mode) : fallback;
}

function parseAgentIds(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function includesAgent(raw: string | undefined, agentId: string | undefined): boolean {
  if (!agentId) return false;
  return parseAgentIds(raw).has(agentId);
}

export function resolveV2Mode(agentId?: string): V2Mode {
  return resolveV2ModeFromEnv(agentId).mode;
}

export function resolveV2ModeFromEnv(agentId?: string): { mode: V2Mode; source: V2ModeSource } {
  const baseMode = parseV2Mode(process.env.MEMORY_FABRIC_V2_MODE);

  if (includesAgent(process.env.MEMORY_FABRIC_V2_OFF_AGENT_IDS, agentId)) return { mode: "off", source: "env_agent_off" };
  if (includesAgent(process.env.MEMORY_FABRIC_V2_SHADOW_AGENT_IDS, agentId)) return { mode: "shadow", source: "env_agent_shadow" };
  if (includesAgent(process.env.MEMORY_FABRIC_V2_WRITE_AGENT_IDS, agentId)) return { mode: "v2-write", source: "env_agent_write" };
  if (includesAgent(process.env.MEMORY_FABRIC_V2_RECALL_AGENT_IDS, agentId)) return { mode: "v2-recall", source: "env_agent_recall" };

  return { mode: baseMode, source: "env_global" };
}

export function isV2RecallReady(mode: V2Mode): boolean {
  return mode === "v2-recall" || mode === "v2-write";
}
