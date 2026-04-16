import type {
  SidecarClient,
  SharedPublishItem,
  SharedPublishResponse
} from "../utils/sidecar-client.js";

export interface MemoryPublishSharedInput {
  projectId: string;
  agentId: string;
  items: SharedPublishItem[];
  visibility?: "project_shared" | "org_shared";
}

export function createMemoryPublishShared(client: SidecarClient) {
  return async function memoryPublishShared(
    input: MemoryPublishSharedInput
  ): Promise<SharedPublishResponse> {
    return client.sharedPublish({
      sourceAgent: input.agentId,
      projectId: input.projectId,
      visibility: input.visibility ?? "project_shared",
      items: input.items
    });
  };
}
