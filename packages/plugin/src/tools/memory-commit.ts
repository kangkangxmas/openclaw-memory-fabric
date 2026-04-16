import type { SidecarClient, CommitResponse } from "../utils/sidecar-client.js";

export interface MemoryCommitInput {
  agentId: string;
  projectId?: string;
  facts?: string[];
  decisions?: string[];
  entities?: string[];
  patterns?: string[];
  visibility?: "private" | "project_shared" | "org_shared";
}

export function createMemoryCommit(client: SidecarClient) {
  return async function memoryCommit(input: MemoryCommitInput): Promise<CommitResponse> {
    return client.commit({
      agentId: input.agentId,
      projectId: input.projectId,
      facts: input.facts,
      decisions: input.decisions,
      entities: input.entities,
      patterns: input.patterns,
      visibility: input.visibility ?? "private"
    });
  };
}
