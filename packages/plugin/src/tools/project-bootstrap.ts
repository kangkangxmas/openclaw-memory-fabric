import type { SidecarClient, BootstrapResponse } from "../utils/sidecar-client.js";

export interface ProjectBootstrapInput {
  projectId: string;
  paths: string[];
  mode?: "auto" | "full";
}

export function createProjectBootstrap(client: SidecarClient) {
  return async function projectBootstrap(input: ProjectBootstrapInput): Promise<BootstrapResponse> {
    return client.bootstrap({
      projectId: input.projectId,
      paths: input.paths,
      mode: input.mode ?? "auto"
    });
  };
}
