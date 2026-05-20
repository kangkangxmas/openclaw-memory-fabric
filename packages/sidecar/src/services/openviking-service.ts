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
  entries: MemoryEntry[];
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
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
function scoreEntryTFIDF(
  entry: MemoryEntry,
  queryTerms: string[],
  idf: Map<string, number>
): number {
  if (queryTerms.length === 0) return 1;
  const docTokens = tokenize(entry.content);
  const tf = computeTF(docTokens);
  let score = 0;
  for (const term of queryTerms) {
    score += (tf.get(term) ?? 0) * (idf.get(term) ?? 1);
  }
  return score;
}

/** Build a corpus-aware TF-IDF scorer for a set of entries and query */
function buildTFIDFScorer(
  entries: MemoryEntry[],
  query: string
): (entry: MemoryEntry) => number {
  if (!query.trim()) return () => 1;
  const queryTerms = tokenize(query);
  const corpus = entries.map((e) => tokenize(e.content));
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
  entries: MemoryEntry[];
  loadedAt: number;
}

/** Cache TTL: 60 seconds */
const INDEX_TTL_MS = 60_000;

export class OpenVikingService {
  /** E1: Per-scope index cache to avoid repeated JSONL full-scan */
  private readonly indexCache = new Map<string, IndexEntry>();

  constructor(
    private readonly cfg: SidecarConfig["openviking"],
    private readonly vectorService?: VectorService
  ) {}

  /** Load entries for a scope, using cache if fresh. */
  private async loadScopeEntries(
    agentId: string,
    scope: MemoryScope,
    projectId?: string,
  ): Promise<MemoryEntry[]> {
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

    try {
      const entries = await readJsonl<MemoryEntry>(memoriesPath);
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
    const allEntries: MemoryEntry[] = [];
    const sourceLabels: string[] = [];

    for (const s of scopesToRead) {
      const entries = await this.loadScopeEntries(agentId, s, projectId);
      if (entries.length > 0) {
        allEntries.push(...entries);
        sourceLabels.push(`openviking:${s}:${depth}`);
      }
    }

    // Score using TF-IDF
    const scorer = buildTFIDFScorer(allEntries, query);
    const tfidfMap = new Map<string, number>();
    for (const e of allEntries) {
      tfidfMap.set(e.id, scorer(e));
    }

    let scored: MemoryEntry[];

    // P2-1: If vector service is available, use hybrid ranking
    if (this.vectorService && query.trim()) {
      const hybrid = await this.vectorService.hybridQuery(query, tfidfMap, maxEntries * 2);
      const entryMap = new Map(allEntries.map((e) => [e.id, e]));
      scored = hybrid
        .map((h) => entryMap.get(h.entryId))
        .filter((e): e is MemoryEntry => e !== undefined)
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
          return new Date(b.entry.createdAt).getTime() - new Date(a.entry.createdAt).getTime();
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

      // P2-1: Async vector index (fire-and-forget)
      if (this.vectorService) {
        void this.vectorService.index(entry.id, agentId, entry.content);
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

    const allEntries: MemoryEntry[] = [];
    for (const s of scopesToRead) {
      const entries = await this.loadScopeEntries(agentId, s, projectId);
      allEntries.push(...entries);
    }

    const normalizedQuery = query.trim().toLowerCase();
    // For inspect: keep substring filter for exact match UX, but also allow TF-IDF partial matches
    const filtered = normalizedQuery
      ? allEntries.filter((entry) => {
          const haystack = `${entry.type} ${entry.content} ${(entry.tags ?? []).join(" ")}`.toLowerCase();
          // Include if exact substring match OR any query token present
          if (haystack.includes(normalizedQuery)) return true;
          const queryTokens = tokenize(normalizedQuery);
          return queryTokens.some((t) => haystack.includes(t));
        })
      : allEntries;

    const sorted = filtered.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return {
      agentId,
      projectId,
      scope,
      entries: sorted.slice(0, limit),
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
    entries: MemoryEntry[],
    ctx: { agentId: string; projectId?: string; scope: MemoryScope; depth: string; taskType?: string }
  ): string {
    const template = getTemplateConfig(ctx.taskType);
    const maxEntries = MAX_ENTRIES_BY_DEPTH[ctx.depth] ?? 5;
    return formatBriefWithTemplate(
      entries.map((e) => ({ type: e.type, content: e.content })),
      ctx,
      template,
      maxEntries
    );
  }
}
