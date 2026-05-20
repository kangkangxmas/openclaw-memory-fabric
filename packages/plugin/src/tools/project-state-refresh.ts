import type { SidecarClient, StructuralBriefResponse } from "../utils/sidecar-client.js";

export interface ProjectStateRefreshInput {
  projectId: string;
  /** File or directory paths to scan for graph building (defaults to current workspace).
   *  Only used when a rebuild is triggered (stale >24h or no existing graph). */
  paths?: string[];
}

export function createProjectStateRefresh(client: SidecarClient) {
  return async function projectStateRefresh(
    input: ProjectStateRefreshInput
  ): Promise<StructuralBriefResponse> {
    const paths = input.paths ?? [process.cwd()];

    if (paths.length > 0) {
      try {
        await client.graphMaybeRefresh({
          projectId: input.projectId,
          paths,
          autoRefresh: "on-demand"
        });
      } catch {
        // Best-effort: if maybe-refresh fails, still return the current brief
      }
    }

    return client.graphBrief(input.projectId);
  };
}
