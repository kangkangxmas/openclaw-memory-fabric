import type { SidecarClient, SharedForgetResponse } from "../utils/sidecar-client.js";

export interface MemoryForgetScopedInput {
  projectId: string;
  agentId?: string;
  query: string;
}

export function createMemoryForgetScoped(client: SidecarClient) {
  return async function memoryForgetScoped(
    input: MemoryForgetScopedInput
  ): Promise<SharedForgetResponse> {
    return client.sharedForget({
      projectId: input.projectId,
      query: input.query,
      sourceAgent: input.agentId
    });
  };
}
