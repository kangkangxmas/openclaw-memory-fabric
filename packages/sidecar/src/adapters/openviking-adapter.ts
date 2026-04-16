import { join } from "path";

export type MemoryScope = "private" | "project" | "shared";

/**
 * Parses a viking:// URI target root to extract the org segment.
 * e.g. "viking://org/acme" → "acme"
 */
function extractOrg(targetRoot: string): string {
  const match = targetRoot.match(/^viking:\/\/org\/([^/]+)/);
  return match?.[1] ?? "default";
}

/**
 * Constructs the local filesystem path for a given memory scope.
 *
 * viking://org/<org>/agents/<agentId>/private/
 * viking://org/<org>/agents/<agentId>/projects/<projectId>/
 * viking://org/<org>/shared/projects/<projectId>/
 */
export function resolveScopePath(opts: {
  basePath: string;
  targetRoot: string;
  agentId: string;
  scope: MemoryScope;
  projectId?: string;
}): string {
  const { basePath, targetRoot, agentId, scope, projectId } = opts;
  const org = extractOrg(targetRoot);

  switch (scope) {
    case "private":
      return join(basePath, org, "agents", agentId, "private");
    case "project":
      if (!projectId) throw new Error("projectId is required for scope=project");
      return join(basePath, org, "agents", agentId, "projects", projectId);
    case "shared":
      if (!projectId) throw new Error("projectId is required for scope=shared");
      return join(basePath, org, "shared", "projects", projectId);
  }
}

/**
 * Returns the canonical viking:// URI for a scope path.
 */
export function buildVikingUri(opts: {
  targetRoot: string;
  agentId: string;
  scope: MemoryScope;
  projectId?: string;
}): string {
  const { targetRoot, agentId, scope, projectId } = opts;
  const base = targetRoot.replace(/\/$/, "");

  switch (scope) {
    case "private":
      return `${base}/agents/${agentId}/private/`;
    case "project":
      if (!projectId) throw new Error("projectId is required for scope=project");
      return `${base}/agents/${agentId}/projects/${projectId}/`;
    case "shared":
      if (!projectId) throw new Error("projectId is required for scope=shared");
      return `${base}/shared/projects/${projectId}/`;
  }
}
