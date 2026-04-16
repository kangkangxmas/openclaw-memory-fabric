import type { SidecarClient } from "../utils/sidecar-client.js";

// ---------------------------------------------------------------------------
// project_graph_query
// ---------------------------------------------------------------------------

export interface ProjectGraphQueryInput {
  projectId: string;
  query: string;
  budget?: number;
}

export function createProjectGraphQuery(client: SidecarClient) {
  return async function projectGraphQuery(
    input: ProjectGraphQueryInput
  ): Promise<{ nodes: unknown[] }> {
    return client.graphQuery({
      projectId: input.projectId,
      query: input.query,
      budget: input.budget
    });
  };
}

// ---------------------------------------------------------------------------
// project_graph_path
// ---------------------------------------------------------------------------

export interface ProjectGraphPathInput {
  projectId: string;
  from: string;
  to: string;
}

export function createProjectGraphPath(client: SidecarClient) {
  return async function projectGraphPath(
    input: ProjectGraphPathInput
  ): Promise<{ path: string[]; found: boolean }> {
    return client.graphPath({
      projectId: input.projectId,
      from: input.from,
      to: input.to
    });
  };
}

// ---------------------------------------------------------------------------
// project_graph_explain
// ---------------------------------------------------------------------------

export interface ProjectGraphExplainInput {
  projectId: string;
  query: string;
}

export function createProjectGraphExplain(client: SidecarClient) {
  return async function projectGraphExplain(
    input: ProjectGraphExplainInput
  ): Promise<{ explanation: string }> {
    return client.graphExplain({
      projectId: input.projectId,
      query: input.query
    });
  };
}
