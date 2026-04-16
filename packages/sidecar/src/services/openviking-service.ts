import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import {
  resolveScopePath,
  buildVikingUri,
  type MemoryScope
} from "../adapters/openviking-adapter.js";
import type { SidecarConfig } from "../config/index.js";
import { readJsonl, appendJsonl, ensureDir } from "../utils/jsonl.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  id: string;
  type: "fact" | "decision" | "entity" | "pattern" | "unresolved";
  content: string;
  agentId: string;
  projectId?: string;
  scope: MemoryScope;
  visibility: "private" | "project_shared" | "org_shared";
  createdAt: string;
  tags: string[];
}

export interface RecallResult {
  memoryBrief: string;
  sources: string[];
  budgetUsed: number;
}

export interface CommitPayload {
  agentId: string;
  projectId?: string;
  scope?: MemoryScope;
  visibility?: "private" | "project_shared" | "org_shared";
  facts?: string[];
  decisions?: string[];
  entities?: string[];
  patterns?: string[];
  unresolved?: string[];
}

export interface CommitResult {
  committed: number;
  publishCandidates: string[];
  uri: string;
}

// ---------------------------------------------------------------------------
// Depth token budget
// ---------------------------------------------------------------------------

const DEPTH_BUDGET: Record<string, number> = {
  l0: 600,
  l1: 1800,
  l2: 5000
};

const MAX_ENTRIES_BY_DEPTH: Record<string, number> = {
  l0: 5,
  l1: 20,
  l2: 60
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(): string {
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Simple relevance: score by keyword overlap between query and entry content */
function scoreEntry(entry: MemoryEntry, query: string): number {
  if (!query) return 1;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const content = entry.content.toLowerCase();
  return words.filter((w) => content.includes(w)).length;
}

function resolveScope(raw: string | undefined): MemoryScope {
  if (raw === "private" || raw === "project" || raw === "shared") return raw;
  return "project"; // default for "auto" or undefined
}

// ---------------------------------------------------------------------------
// OpenVikingService
// ---------------------------------------------------------------------------

export class OpenVikingService {
  constructor(private readonly cfg: SidecarConfig["openviking"]) {}

  // -------------------------------------------------------------------------
  // recallMemory
  // -------------------------------------------------------------------------

  async recallMemory(opts: {
    agentId: string;
    projectId?: string;
    scope?: string;
    depth?: string;
    query?: string;
  }): Promise<RecallResult> {
    const { agentId, projectId, query = "" } = opts;
    const scope = resolveScope(opts.scope);
    const depth = opts.depth ?? "l0";
    const maxEntries = MAX_ENTRIES_BY_DEPTH[depth] ?? 5;

    const scopesToRead: MemoryScope[] = this.buildReadScopes(scope, !!projectId);
    const allEntries: MemoryEntry[] = [];
    const sourceLabels: string[] = [];

    for (const s of scopesToRead) {
      try {
        const dir = resolveScopePath({
          basePath: this.cfg.basePath,
          targetRoot: this.cfg.targetRoot,
          agentId,
          scope: s,
          projectId
        });
        const memoriesPath = join(dir, "memories.jsonl");
        const entries = await readJsonl<MemoryEntry>(memoriesPath);
        if (entries.length > 0) {
          allEntries.push(...entries);
          sourceLabels.push(`openviking:${s}:${depth}`);
        }
      } catch {
        // scope path may not exist yet — skip gracefully
      }
    }

    // Score and take top N
    const scored = allEntries
      .map((e) => ({ entry: e, score: scoreEntry(e, query) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return new Date(b.entry.createdAt).getTime() - new Date(a.entry.createdAt).getTime();
      })
      .slice(0, maxEntries)
      .map((s) => s.entry);

    const brief = this.formatBrief(scored, { agentId, projectId, scope, depth });
    const budgetUsed = Math.min(brief.length, DEPTH_BUDGET[depth] ?? 600);

    return {
      memoryBrief: brief,
      sources: sourceLabels.length > 0 ? sourceLabels : [`openviking:empty`],
      budgetUsed
    };
  }

  // -------------------------------------------------------------------------
  // commitSession
  // -------------------------------------------------------------------------

  async commitSession(payload: CommitPayload): Promise<CommitResult> {
    const {
      agentId,
      projectId,
      facts = [],
      decisions = [],
      entities = [],
      patterns = [],
      unresolved = [],
      visibility = "private"
    } = payload;

    const scope = resolveScope(payload.scope);
    const dir = resolveScopePath({
      basePath: this.cfg.basePath,
      targetRoot: this.cfg.targetRoot,
      agentId,
      scope,
      projectId
    });

    await ensureDir(dir);
    const memoriesPath = join(dir, "memories.jsonl");
    const now = new Date().toISOString();

    const toWrite: Array<{ type: MemoryEntry["type"]; content: string }> = [
      ...facts
        .map((c) => ({ type: "fact" as const, c }))
        .map(({ c }) => ({ type: "fact" as const, content: c })),
      ...decisions.map((c) => ({ type: "decision" as const, content: c })),
      ...entities.map((c) => ({ type: "entity" as const, content: c })),
      ...patterns.map((c) => ({ type: "pattern" as const, content: c })),
      ...unresolved.map((c) => ({ type: "unresolved" as const, content: c }))
    ];

    for (const item of toWrite) {
      const entry: MemoryEntry = {
        id: uid(),
        type: item.type,
        content: item.content,
        agentId,
        projectId,
        scope,
        visibility,
        createdAt: now,
        tags: []
      };
      await appendJsonl(memoriesPath, entry);
    }

    // Update summary file (last-write-wins for now)
    const summaryPath = join(dir, "summary.json");
    const existingSummary = existsSync(summaryPath)
      ? (JSON.parse(await readFile(summaryPath, "utf8")) as object)
      : {};
    await writeFile(
      summaryPath,
      JSON.stringify({ ...existingSummary, lastCommit: now, agentId, projectId, scope }, null, 2),
      "utf8"
    );

    const uri = buildVikingUri({
      targetRoot: this.cfg.targetRoot,
      agentId,
      scope,
      projectId
    });

    // Items tagged as unresolved bubble up as publish candidates for human review
    const publishCandidates = unresolved.slice(0, 3).map((u) => u.slice(0, 80));

    return {
      committed: toWrite.length,
      publishCandidates,
      uri
    };
  }

  // -------------------------------------------------------------------------
  // readScopeSummary — returns a one-liner summary for L0 injection
  // -------------------------------------------------------------------------

  async readScopeSummary(opts: {
    agentId: string;
    projectId?: string;
    scope?: string;
  }): Promise<string> {
    const scope = resolveScope(opts.scope);
    try {
      const dir = resolveScopePath({
        basePath: this.cfg.basePath,
        targetRoot: this.cfg.targetRoot,
        agentId: opts.agentId,
        scope,
        projectId: opts.projectId
      });
      const summaryPath = join(dir, "summary.json");
      if (!existsSync(summaryPath)) return "";
      const raw = await readFile(summaryPath, "utf8");
      const obj = JSON.parse(raw) as { lastCommit?: string };
      return obj.lastCommit ? `Last commit: ${obj.lastCommit}` : "";
    } catch {
      return "";
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildReadScopes(scope: MemoryScope, hasProject: boolean): MemoryScope[] {
    // Always read private; add project/shared when context is available
    if (scope === "private") return ["private"];
    if (scope === "project" && hasProject) return ["private", "project"];
    if (scope === "shared" && hasProject) return ["private", "project", "shared"];
    return ["private"];
  }

  private formatBrief(
    entries: MemoryEntry[],
    ctx: { agentId: string; projectId?: string; scope: MemoryScope; depth: string }
  ): string {
    if (entries.length === 0) {
      return `## Memory Brief\nNo memories found for agent=${ctx.agentId} scope=${ctx.scope} depth=${ctx.depth}.\n`;
    }

    const byType = new Map<string, string[]>();
    for (const e of entries) {
      const arr = byType.get(e.type) ?? [];
      arr.push(e.content);
      byType.set(e.type, arr);
    }

    const lines: string[] = [
      `## Memory Brief`,
      `Agent: ${ctx.agentId}${ctx.projectId ? ` | Project: ${ctx.projectId}` : ""} | Scope: ${ctx.scope} | Depth: ${ctx.depth}`,
      ""
    ];

    for (const [type, items] of byType) {
      lines.push(`### ${type.charAt(0).toUpperCase() + type.slice(1)}s`);
      items.forEach((item) => lines.push(`- ${item}`));
      lines.push("");
    }

    return lines.join("\n");
  }
}
