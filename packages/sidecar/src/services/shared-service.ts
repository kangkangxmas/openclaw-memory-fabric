import { mkdir } from "fs/promises";
import { join } from "path";
import { readJsonl, writeJsonl, appendJsonl } from "../utils/jsonl.js";
import { validateId } from "../utils/path-guard.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SharedVisibility = "project_shared" | "org_shared";
export type SharedStatus = "active" | "retracted";

export interface SharedEntry {
  id: string;
  sourceAgent: string;
  projectId: string;
  visibility: SharedVisibility;
  type: "fact" | "decision" | "entity" | "pattern" | "note";
  content: string;
  createdAt: string;
  status: SharedStatus;
  tags: string[];
}

export interface PublishResult {
  published: number;
  ids: string[];
  targetPath: string;
}

export interface ForgetResult {
  retracted: number;
  notFound: number;
}

export interface SharedRecallResult {
  entries: SharedEntry[];
  source: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(): string {
  return `pub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function scoreEntries(
  active: SharedEntry[],
  query: string,
  limit: number
): SharedEntry[] {
  const q = query.toLowerCase();
  return active
    .map((e) => {
      const score = q
        ? (e.content.toLowerCase().includes(q) ? 2 : 0) +
          e.tags.filter((t) => t.toLowerCase().includes(q)).length
        : 1;
      return { e, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.e);
}

// ---------------------------------------------------------------------------
// SharedService
// ---------------------------------------------------------------------------

export class SharedService {
  constructor(private readonly carriersRoot: string) {}

  /**
   * Resolve the storage directory based on visibility:
   * - project_shared → carriers/shared/projects/<projectId>/
   * - org_shared     → carriers/shared/org/
   */
  private sharedDir(projectId: string, visibility: SharedVisibility): string {
    if (visibility === "org_shared") {
      return join(this.carriersRoot, "shared", "org");
    }
    return join(this.carriersRoot, "shared", "projects", projectId);
  }

  private sharedFilePath(projectId: string, visibility: SharedVisibility): string {
    return join(this.sharedDir(projectId, visibility), "published-memory.jsonl");
  }

  // -------------------------------------------------------------------------
  // Publish
  // -------------------------------------------------------------------------

  async publish(opts: {
    sourceAgent: string;
    projectId: string;
    visibility: SharedVisibility;
    items: Array<{ type: SharedEntry["type"]; content: string; tags?: string[] }>;
  }): Promise<PublishResult> {
    const { sourceAgent, projectId, visibility, items } = opts;
    validateId(projectId, "projectId");
    validateId(sourceAgent, "sourceAgent");
    const dir = this.sharedDir(projectId, visibility);
    await mkdir(dir, { recursive: true });

    const filePath = this.sharedFilePath(projectId, visibility);
    const now = new Date().toISOString();
    const ids: string[] = [];

    for (const item of items) {
      const entry: SharedEntry = {
        id: uid(),
        sourceAgent,
        projectId,
        visibility,
        type: item.type,
        content: item.content,
        createdAt: now,
        status: "active",
        tags: item.tags ?? []
      };
      await appendJsonl(filePath, entry);
      ids.push(entry.id);
    }

    return { published: ids.length, ids, targetPath: filePath };
  }

  // -------------------------------------------------------------------------
  // Forget (retract) — audit-safe: marks as retracted, never deletes
  // Searches both project_shared and org_shared files for the projectId.
  // -------------------------------------------------------------------------

  async forget(opts: {
    projectId: string;
    query: string;
    sourceAgent?: string;
  }): Promise<ForgetResult> {
    validateId(opts.projectId, "projectId");
    let totalRetracted = 0;
    let totalNotFound = 0;

    for (const vis of ["project_shared", "org_shared"] as SharedVisibility[]) {
      const filePath = this.sharedFilePath(opts.projectId, vis);
      const entries = await readJsonl<SharedEntry>(filePath);
      if (entries.length === 0) continue;

      const q = opts.query.toLowerCase();
      let retracted = 0;
      let notFound = 0;

      const updated = entries.map((e) => {
        if (e.status === "retracted") return e;
        const matches = e.id === opts.query || e.content.toLowerCase().includes(q);
        if (!matches) {
          notFound++;
          return e;
        }
        retracted++;
        return { ...e, status: "retracted" as SharedStatus };
      });

      if (retracted > 0) {
        await writeJsonl(filePath, updated);
      }
      totalRetracted += retracted;
      totalNotFound += notFound;
    }

    return { retracted: totalRetracted, notFound: totalNotFound };
  }

  // -------------------------------------------------------------------------
  // Recall shared entries — merges project_shared + org_shared results
  // -------------------------------------------------------------------------

  async recall(opts: {
    projectId: string;
    query?: string;
    limit?: number;
  }): Promise<SharedRecallResult> {
    validateId(opts.projectId, "projectId");
    const limit = opts.limit ?? 20;
    const q = opts.query ?? "";

    const [projectEntries, orgEntries] = await Promise.all([
      readJsonl<SharedEntry>(this.sharedFilePath(opts.projectId, "project_shared")),
      readJsonl<SharedEntry>(this.sharedFilePath(opts.projectId, "org_shared"))
    ]);

    const active = [...projectEntries, ...orgEntries].filter((e) => e.status === "active");
    const scored = scoreEntries(active, q, limit);

    return {
      entries: scored,
      source: `shared:projects/${opts.projectId}+org`
    };
  }

}
