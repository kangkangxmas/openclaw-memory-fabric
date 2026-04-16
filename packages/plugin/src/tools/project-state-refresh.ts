import type { SidecarClient, StructuralBriefResponse } from "../utils/sidecar-client.js";

export interface ProjectStateRefreshInput {
  projectId: string;
}

export function createProjectStateRefresh(client: SidecarClient) {
  return async function projectStateRefresh(
    input: ProjectStateRefreshInput
  ): Promise<StructuralBriefResponse> {
    return client.graphBrief(input.projectId);
  };
}
