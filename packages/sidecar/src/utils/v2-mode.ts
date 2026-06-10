export type V2Mode = "off" | "shadow" | "v2-recall" | "v2-write";

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
  const baseMode = parseV2Mode(process.env.MEMORY_FABRIC_V2_MODE);

  if (includesAgent(process.env.MEMORY_FABRIC_V2_OFF_AGENT_IDS, agentId)) return "off";
  if (includesAgent(process.env.MEMORY_FABRIC_V2_SHADOW_AGENT_IDS, agentId)) return "shadow";
  if (includesAgent(process.env.MEMORY_FABRIC_V2_WRITE_AGENT_IDS, agentId)) return "v2-write";
  if (includesAgent(process.env.MEMORY_FABRIC_V2_RECALL_AGENT_IDS, agentId)) return "v2-recall";

  return baseMode;
}

export function isV2RecallReady(mode: V2Mode): boolean {
  return mode === "v2-recall" || mode === "v2-write";
}
