import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import {
  resolveScopePath,
  buildVikingUri,
  type MemoryScope
} from "../adapters/openviking-adapter.js";
import type { SidecarConfig } from "../config/index.js";
import { readJsonl, appendJsonl, ensureDir } from "../utils/jsonl.js";
import type { VectorService } from "./vector-service.js";
import { computeDecayScore, readSummaryVersion, updateSummaryWithVersion } from "./lifecycle-service.js";
import { getTemplateConfig, formatBriefWithTemplate } from "./brief-templates.js";
import {
  type MemoryEntryV2,
  type MemoryType,
  MemoryEntryBuilder,
  generateMemoryId,
  getMemoryText,
  touchMemory
} from "../models/schema-v2.js";
import { MigrationService } from "./migration-service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @deprecated Use MemoryEntryV2 from schema-v2.ts
 * 保留以向后兼容，新代码应使用 MemoryEntryV2
 */
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

/** 内部使用 V2 类型 */
type InternalMemoryEntry = MemoryEntryV2;

export interface RecallResult {
  memoryBrief: string;
  sources: string[];
  budgetUsed: number;
  taskType?: string;
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
  /** V2: Task type for metadata tagging */
  taskType?: string;
}

export interface CommitResult {
  committed: number;
  publishCandidates: string[];
  uri: string;
}

export interface MemoryInspectResult {
  agentId: string;
  projectId?: string;
  scope: MemoryScope;
  /** @deprecated 返回 V2 条目 */
  entries: MemoryEntry[];
  totalEntries: number;
  scopesRead: MemoryScope[];
}

/** V2 版本的检查结果 */
export interface MemoryInspectResultV2 {
  agentId: string;
  projectId?: string;
  scope: MemoryScope;
  entries: MemoryEntryV2[];
  totalEntries: number;
  scopesRead: MemoryScope[];
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
  return generateMemoryId();
}

// ---------------------------------------------------------------------------
// TF-IDF scoring
// ---------------------------------------------------------------------------

/** Tokenize text into lowercase word tokens, removing punctuation */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/** Build term-frequency map for a token list */
function computeTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  // Normalise by document length
  for (const [t, cnt] of tf) tf.set(t, cnt / tokens.length);
  return tf;
}

/**
 * Compute IDF for query terms given a corpus of documents.
 * idf(t) = ln( (N + 1) / (df(t) + 1) ) + 1  (smooth variant)
 */
function computeIDF(
  queryTerms: string[],
  corpus: string[][]
): Map<string, number> {
  const N = corpus.length;
  const idf = new Map<string, number>();
  for (const term of queryTerms) {
    const df = corpus.filter((tokens) => tokens.includes(term)).length;
    idf.set(term, Math.log((N + 1) / (df + 1)) + 1);
  }
  return idf;
}

/**
 * Score an entry against a query using TF-IDF.
 * Falls back gracefully: returns 1 when query is empty (treat all equal).
 */
/**
 * Score an entry against a query using TF-IDF.
 * Supports both V1 (MemoryEntry) and V2 (MemoryEntryV2) entries.
 */
function scoreEntryTFIDF(
  entry: MemoryEntry | MemoryEntryV2,
  queryTerms: string[],
  idf: Map<string, number>
): number {
  if (queryTerms.length === 0) return 1;
  // V2 entries may have blocks - use getMemoryText for full text
  const text = "timeline" in entry ? getMemoryText(entry as MemoryEntryV2) : entry.content;
  const docTokens = tokenize(text);
  const tf = computeTF(docTokens);
  let score = 0;
  for (const term of queryTerms) {
    score += (tf.get(term) ?? 0) * (idf.get(term) ?? 1);
  }
  return score;
}

/** Build a corpus-aware TF-IDF scorer for a set of entries and query */
function buildTFIDFScorer(
  entries: Array<MemoryEntry | MemoryEntryV2>,
  query: string
): (entry: MemoryEntry | MemoryEntryV2) => number {
  if (!query.trim()) return () => 1;
  const queryTerms = tokenize(query);
  const corpus = entries.map((e) => {
    const text = "timeline" in e ? getMemoryText(e as MemoryEntryV2) : e.content;
    return tokenize(text);
  });
  const idf = computeIDF(queryTerms, corpus);
  return (entry) => scoreEntryTFIDF(entry, queryTerms, idf);
}

function resolveScope(raw: string | undefined): MemoryScope {
  if (raw === "private" || raw === "project" || raw === "shared") return raw;
  return "project"; // default for "auto" or undefined
}

// ---------------------------------------------------------------------------
// OpenVikingService
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// E1: In-memory index cache for fast recall
// ---------------------------------------------------------------------------

interface IndexEntry {
  entries: MemoryEntryV2[];
  loadedAt: number;
}

/** Cache TTL: 60 seconds */
const INDEX_TTL_MS = 60_000;

export class OpenVikingService {
  /** E1: Per-scope index cache to avoid repeated JSONL full-scan */
  private readonly indexCache = new Map<string, IndexEntry>();
  /** Schema V2 migration service */
  private readonly migrationService: MigrationService;

  constructor(
    private readonly cfg: SidecarConfig["openviking"],
    private readonly vectorService?: VectorService
  ) {
    this.migrationService = new MigrationService(cfg);
  }

  /** Load entries for a scope, using cache if fresh. Auto-migrates V1 to V2. */
  private async loadScopeEntries(
    agentId: string,
    scope: MemoryScope,
    projectId?: string,
  ): Promise<MemoryEntryV2[]> {
    const dir = resolveScopePath({
      basePath: this.cfg.basePath,
      targetRoot: this.cfg.targetRoot,
      agentId,
      scope,
      projectId,
    });
    const memoriesPath = join(dir, "memories.jsonl");
    const cacheKey = memoriesPath;

    const cached = this.indexCache.get(cacheKey);
    if (cached && Date.now() - cached.loadedAt < INDEX_TTL_MS) {
      return cached.entries;
    }

    // Auto-migration: check if migration is needed
    if (await this.migrationService.needsMigration(dir)) {
      await this.migrationService.migrateFile(memoriesPath);
    }

    try {
      const entries = await readJsonl<MemoryEntryV2>(memoriesPath);
      this.indexCache.set(cacheKey, { entries, loadedAt: Date.now() });
      return entries;
    } catch {
      return [];
    }
  }

  /** Invalidate cache for a scope (call after writes). */
  private invalidateCache(
    agentId: string,
    scope: MemoryScope,
    projectId?: string,
  ): void {
    const dir = resolveScopePath({
      basePath: this.cfg.basePath,
      targetRoot: this.cfg.targetRoot,
      agentId,
      scope,
      projectId,
    });
    this.indexCache.delete(join(dir, "memories.jsonl"));
  }

  // -------------------------------------------------------------------------
  // recallMemory
  // -------------------------------------------------------------------------

  async recallMemory(opts: {
    agentId: string;
    projectId?: string;
    scope?: string;
    depth?: string;
    query?: string;
    taskType?: string;
  }): Promise<RecallResult> {
    const { agentId, projectId, query = "", taskType } = opts;
    const scope = resolveScope(opts.scope);
    const depth = opts.depth ?? "l0";
    const maxEntries = MAX_ENTRIES_BY_DEPTH[depth] ?? 5;

    const scopesToRead: MemoryScope[] = this.buildReadScopes(scope, !!projectId);
    const allEntries: MemoryEntryV2[] = [];
    const sourceLabels: string[] = [];

    for (const s of scopesToRead) {
      const entries = await this.loadScopeEntries(agentId, s, projectId);
      if (entries.length > 0) {
        allEntries.push(...entries);
        sourceLabels.push(`openviking:${s}:${depth}`);
      }
    }

    // Score using TF-IDF (supports V2 with blocks)
    const scorer = buildTFIDFScorer(allEntries, query);
    const tfidfMap = new Map<string, number>();
    for (const e of allEntries) {
      tfidfMap.set(e.id, scorer(e));
    }

    let scored: MemoryEntryV2[];

    // P2-1: If vector service is available, use hybrid ranking
    if (this.vectorService && query.trim()) {
      const hybrid = await this.vectorService.hybridQuery(query, tfidfMap, maxEntries * 2);
      const entryMap = new Map(allEntries.map((e) => [e.id, e]));
      scored = hybrid
        .map((h) => entryMap.get(h.entryId))
        .filter((e): e is MemoryEntryV2 => e !== undefined)
        .slice(0, maxEntries);
    } else {
      // D1: Combine TF-IDF relevance with decay freshness
      const now = Date.now();
      scored = allEntries
        .map((e) => ({
          entry: e,
          score: (tfidfMap.get(e.id) ?? 0) * (0.7 + 0.3 * computeDecayScore(e, now)),
        }))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return new Date(b.entry.timeline.createdAt).getTime() - new Date(a.entry.timeline.createdAt).getTime();
        })
        .slice(0, maxEntries)
        .map((s) => s.entry);
    }

    const brief = this.formatBrief(scored, { agentId, projectId, scope, depth, taskType });
    const budgetUsed = Math.min(brief.length, DEPTH_BUDGET[depth] ?? 600);

    return {
      memoryBrief: brief,
      sources: sourceLabels.length > 0 ? sourceLabels : [`openviking:empty`],
      budgetUsed,
      taskType
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

    const toWrite: Array<{ type: MemoryType; content: string }> = [
      ...facts.map((c) => ({ type: "fact" as const, content: c })),
      ...decisions.map((c) => ({ type: "decision" as const, content: c })),
      ...entities.map((c) => ({ type: "entity" as const, content: c })),
      ...patterns.map((c) => ({ type: "pattern" as const, content: c })),
      ...unresolved.map((c) => ({ type: "unresolved" as const, content: c }))
    ];

    for (const item of toWrite) {
      // V2: Use builder for structured entry
      const entry = new MemoryEntryBuilder()
        .id(uid())
        .type(item.type)
        .content(item.content)
        .agentId(agentId)
        .projectId(projectId)
        .scope(scope)
        .visibility(visibility)
        .timeline({ createdAt: now, updatedAt: now, version: 1 })
        .metadata({ tags: [], taskType: payload.taskType })
        .build();

      await appendJsonl(memoriesPath, entry);

      // P2-1: Async vector index (fire-and-forget)
      if (this.vectorService) {
        void this.vectorService.index(entry.id, agentId, getMemoryText(entry));
      }
    }

    // E1: Invalidate index cache after write
    this.invalidateCache(agentId, scope, projectId);

    // D3: Update summary with optimistic version locking
    const summaryPath = join(dir, "summary.json");
    const currentVersion = await readSummaryVersion(summaryPath);
    const updated = await updateSummaryWithVersion(
      summaryPath,
      { lastCommit: now, agentId, projectId, scope },
      currentVersion,
    );
    if (!updated) {
      // Conflict detected — retry once with fresh version
      const freshVersion = await readSummaryVersion(summaryPath);
      await updateSummaryWithVersion(
        summaryPath,
        { lastCommit: now, agentId, projectId, scope },
        freshVersion,
      );
    }

    const uri = buildVikingUri({
      targetRoot: this.cfg.targetRoot,
      agentId,
      scope,
      projectId
    });

    // Items tagged as unresolved + decisions bubble up as publish candidates for human review
    const publishCandidates = [
      ...decisions.slice(0, 2).map((d) => d.slice(0, 80)),
      ...unresolved.slice(0, 2).map((u) => u.slice(0, 80))
    ];

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

  async inspectMemory(opts: {
    agentId: string;
    projectId?: string;
    scope?: string;
    query?: string;
    limit?: number;
  }): Promise<MemoryInspectResult> {
    const { agentId, projectId, query = "" } = opts;
    const scope = resolveScope(opts.scope);
    const limit = Math.max(1, Math.min(opts.limit ?? 100, 500));
    const scopesToRead = this.buildReadScopes(scope, !!projectId);

    const allEntries: MemoryEntryV2[] = [];
    for (const s of scopesToRead) {
      const entries = await this.loadScopeEntries(agentId, s, projectId);
      allEntries.push(...entries);
    }

    const normalizedQuery = query.trim().toLowerCase();
    // For inspect: keep substring filter for exact match UX, but also allow TF-IDF partial matches
    const filtered = normalizedQuery
      ? allEntries.filter((entry) => {
          const text = getMemoryText(entry);
          const haystack = `${entry.type} ${text} ${(entry.metadata.tags ?? []).join(" ")}`.toLowerCase();
          // Include if exact substring match OR any query token present
          if (haystack.includes(normalizedQuery)) return true;
          const queryTokens = tokenize(normalizedQuery);
          return queryTokens.some((t) => haystack.includes(t));
        })
      : allEntries;

    const sorted = filtered.sort(
      (a, b) => new Date(b.timeline.createdAt).getTime() - new Date(a.timeline.createdAt).getTime()
    );

    // V2: Update access stats for inspected entries
    const touched = sorted.slice(0, limit).map(e => touchMemory(e));

    return {
      agentId,
      projectId,
      scope,
      // Return V1-compatible format for backward compatibility
      entries: touched.map(e => ({
        id: e.id,
        type: e.type as MemoryEntry["type"],
        content: e.content,
        agentId: e.agentId,
        projectId: e.projectId,
        scope: e.scope,
        visibility: e.visibility,
        createdAt: e.timeline.createdAt,
        tags: e.metadata.tags
      })),
      totalEntries: filtered.length,
      scopesRead: scopesToRead
    };
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
    entries: MemoryEntryV2[],
    ctx: { agentId: string; projectId?: string; scope: MemoryScope; depth: string; taskType?: string }
  ): string {
    const template = getTemplateConfig(ctx.taskType);
    const maxEntries = MAX_ENTRIES_BY_DEPTH[ctx.depth] ?? 5;
    return formatBriefWithTemplate(
      entries.map((e) => ({ type: e.type, content: getMemoryText(e) })),
      ctx,
      template,
      maxEntries
    );
  }

  // -------------------------------------------------------------------------
  // V2 API - New methods for Schema V2
  // -------------------------------------------------------------------------

  /** V2: Inspect memory with full V2 entries */
  async inspectMemoryV2(opts: {
    agentId: string;
    projectId?: string;
    scope?: string;
    query?: string;
    limit?: number;
  }): Promise<MemoryInspectResultV2> {
    const { agentId, projectId, query = "" } = opts;
    const scope = resolveScope(opts.scope);
    const limit = Math.max(1, Math.min(opts.limit ?? 100, 500));
    const scopesToRead = this.buildReadScopes(scope, !!projectId);

    const allEntries: MemoryEntryV2[] = [];
    for (const s of scopesToRead) {
      const entries = await this.loadScopeEntries(agentId, s, projectId);
      allEntries.push(...entries);
    }

    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
      ? allEntries.filter((entry) => {
          const text = getMemoryText(entry);
          const haystack = `${entry.type} ${text} ${(entry.metadata.tags ?? []).join(" ")}`.toLowerCase();
          if (haystack.includes(normalizedQuery)) return true;
          const queryTokens = tokenize(normalizedQuery);
          return queryTokens.some((t) => haystack.includes(t));
        })
      : allEntries;

    const sorted = filtered.sort(
      (a, b) => new Date(b.timeline.createdAt).getTime() - new Date(a.timeline.createdAt).getTime()
    );

    // Update access stats
    const touched = sorted.slice(0, limit).map(e => touchMemory(e));

    return {
      agentId,
      projectId,
      scope,
      entries: touched,
      totalEntries: filtered.length,
      scopesRead: scopesToRead
    };
  }

  /** V2: Get migration status for an agent */
  async getMigrationStatus(agentId: string): Promise<{
    private: boolean;
    projects: Record<string, boolean>;
  }> {
    const result = { private: false, projects: {} as Record<string, boolean> };
    
    result.private = await this.migrationService.needsMigration(
      resolveScopePath({
        basePath: this.cfg.basePath,
        targetRoot: this.cfg.targetRoot,
        agentId,
        scope: "private"
      })
    );

    const projectsDir = join(this.cfg.basePath, "org", "default", "agents", agentId, "projects");
    if (existsSync(projectsDir)) {
      const { readdir } = await import("fs/promises");
      const dirs = await readdir(projectsDir, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;
        const projectPath = resolveScopePath({
          basePath: this.cfg.basePath,
          targetRoot: this.cfg.targetRoot,
          agentId,
          scope: "project",
          projectId: dir.name
        });
        result.projects[dir.name] = await this.migrationService.needsMigration(projectPath);
      }
    }

    return result;
  }
}
