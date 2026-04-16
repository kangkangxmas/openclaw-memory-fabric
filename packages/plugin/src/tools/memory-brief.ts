import type { SidecarClient, RecallResponse } from "../utils/sidecar-client.js";

export interface MemoryBriefInput {
  agentId: string;
  projectId?: string;
  scope?: "private" | "project" | "shared" | "auto";
  depth?: "l0" | "l1" | "l2";
  query?: string;
}

export function createMemoryBrief(client: SidecarClient) {
  return async function memoryBrief(input: MemoryBriefInput): Promise<RecallResponse> {
    return client.recall({
      agentId: input.agentId,
      projectId: input.projectId,
      scope: input.scope ?? "auto",
      depth: input.depth ?? "l1",
      query: input.query
    });
  };
}
