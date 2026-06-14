/**
 * Memory Core V2 — The central memory engine for Schema V2.
 *
 * Features:
 * - Unified CRUD operations for MemoryEntryV2
 * - Relation graph traversal
 * - Multi-strategy querying (exact, semantic, hybrid, temporal, relational)
 * - Lifecycle management (decay, expiration, compaction)
 * - Event-driven architecture
 * - Batch operations
 */

import { join } from "path";
import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import type { SidecarConfig } from "../config/index.js";
import { readJsonl, writeJsonl, appendJsonl, ensureDir } from "../utils/jsonl.js";
import {
  type MemoryEntryV2,
  type MemoryType,
  type MemoryRelation,
  type MemoryEmbedding,
  MemoryEntryBuilder,
  generateMemoryId,
  getMemoryText,
  getMemoryAgeDays,
  isMemoryExpired,
  touchMemory,
  validateMemoryEntryV2,
} from "../models/schema-v2.js";
import type { VectorServiceV2 } from "../services/vector-service-v2.js";
import type { EmbeddingServiceV2 } from "../services/embedding-service-v2.js";
import { MigrationService } from "../services/migration-service.js";
import {
  resolveScopePath,
  type MemoryScope,
} from "../adapters/openviking-adapter.js";
import { MemoryIndex } from "./memory-index.js";
import { MemoryCache } from "./memory-cache.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape special regex characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryQuery {
  /** Text query for semantic/keyword search */
  text?: string;
  /** Filter by type */
  types?: MemoryType[];
  /** Filter by tags */
  tags?: string[];
  /** Filter by agent */
  agentId?: string;
  /** Filter by project */
  projectId?: string;
  /** Filter by scope */
  scope?: MemoryScope;
  /** Time range filter */
  timeRange?: { from?: string; to?: string };
  /** Include expired entries */
  includeExpired?: boolean;
  /** Maximum results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

export interface MemoryQueryResult {
  entries: MemoryEntryV2[];
  total: number;
  query?: MemoryQuery;
  /** Which strategies were used */
  strategies: string[];
  /** Execution time in ms */
  executionTimeMs: number;
}

export interface RelationGraph {
  nodes: Array<{
    id: string;
    type: MemoryType;
    content: string;
    agentId: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    type: MemoryRelation["type"];
    strength: number;
  }>;
}

export interface MemoryStats {
  totalEntries: number;
  byType: Record<MemoryType, number>;
  byAgent: Record<string, number>;
  byScope: Record<string, number>;
  expiredCount: number;
  avgAgeDays: number;
  totalRelations: number;
}

export interface MemoryEvent {
  type: "created" | "updated" | "deleted" | "expired" | "accessed";
  entryId: string;
  agentId: string;
  timestamp: string;
  payload?: unknown;
}

type EventHandler = (event: MemoryEvent) => void | Promise<void>;

// ---------------------------------------------------------------------------
// MemoryCoreV2
// ---------------------------------------------------------------------------

export class MemoryCoreV2 {
  private readonly eventHandlers = new Map<string, EventHandler[]>();
  private readonly migrationService: MigrationService;
  private readonly index: MemoryIndex;
  private readonly cache: MemoryCache;
  private indexBuilt = false;

  constructor(
    private readonly cfg: SidecarConfig["openviking"],
    private readonly vectorService?: VectorServiceV2,
    private readonly embedder?: EmbeddingServiceV2
  ) {
    this.migrationService = new MigrationService(cfg);
    this.index = new MemoryIndex();
    this.cache = new MemoryCache();
  }

  // -------------------------------------------------------------------------
  // CRUD Operations
  // -------------------------------------------------------------------------

  /** Create a new memory entry. */
  async create(entry: Partial<MemoryEntryV2> & Pick<MemoryEntryV2, "content" | "agentId">): Promise<MemoryEntryV2> {
    const now = new Date().toISOString();
    const builder = new MemoryEntryBuilder()
      .id(entry.id ?? generateMemoryId())
      .type(entry.type ?? "fact")
      .content(entry.content)
      .agentId(entry.agentId)
      .scope(entry.scope ?? "private")
      .visibility(entry.visibility ?? "private")
      .timeline({
        createdAt: entry.timeline?.createdAt ?? now,
        updatedAt: now,
        version: 1,
        expiresAt: entry.timeline?.expiresAt,
      });

    if (entry.projectId) builder.projectId(entry.projectId);
    if (entry.metadata) builder.metadata(entry.metadata);
    if (entry.metadata?.tags) entry.metadata.tags.forEach((t: string) => builder.tag(t));
    if (entry.relations) entry.relations.forEach((r) => builder.relation(r));
    if (entry.sources) entry.sources.forEach((s) => builder.source(s));
    if (entry.sourceRefs) entry.sourceRefs.forEach((s) => builder.sourceRef(s));
    if (entry.validFrom) builder.validFrom(entry.validFrom);
    if (entry.validUntil !== undefined) builder.validUntil(entry.validUntil);
    if (entry.supersedes) entry.supersedes.forEach((id) => builder.supersedes(id));
    if (entry.status) builder.status(entry.status);
    if (entry.quality) builder.quality(entry.quality);
    if (entry.blocks) entry.blocks.forEach((b) => builder.block(b.format, b.content, b.language));

    const newEntry = builder.build();
    await this.persist(newEntry);

    // Update index and cache
    this.index.add(newEntry);
    this.cache.setEntry(newEntry.id, newEntry);
    this.cache.invalidateQueryCaches();

    // Generate embedding if embedder available
    if (this.embedder) {
      const embedding = await this.embedder.embed(getMemoryText(newEntry));
      if (embedding) {
        newEntry.embedding = embedding;
        await this.update(newEntry.id, { embedding });
      }
    }

    // Index in vector store
    if (this.vectorService) {
      await this.vectorService.indexEntry(newEntry);
    }

    await this.emit("created", { entryId: newEntry.id, agentId: newEntry.agentId });
    return newEntry;
  }

  /** Read a single entry by ID. */
  async read(entryId: string): Promise<MemoryEntryV2 | null> {
    // Check cache first
    const cached = this.cache.getEntry(entryId);
    if (cached) {
      return cached;
    }

    // Search across all scopes
    const scopes: MemoryScope[] = ["private", "project", "shared"];
    for (const scope of scopes) {
      const entries = await this.loadScope(scope);
      const entry = entries.find((e) => e.id === entryId);
      if (entry) {
        // Update access stats (only if not already touched recently to avoid loops)
        const touched = touchMemory(entry);
        // Use setImmediate pattern to avoid recursive update issues
        Promise.resolve().then(() => {
          this.updateEntryDirect(touched).catch(() => {});
          this.emit("accessed", { entryId, agentId: entry.agentId }).catch(() => {});
        });
        // Cache the result
        this.cache.setEntry(entryId, touched);
        return touched;
      }
    }
    return null;
  }

  /** Update an entry by ID. */
  async update(entryId: string, updates: Partial<MemoryEntryV2>): Promise<MemoryEntryV2 | null> {
    const entry = await this.read(entryId);
    if (!entry) return null;

    // Apply updates
    if (updates.content) entry.content = updates.content;
    if (updates.type) entry.type = updates.type;
    if (updates.metadata) entry.metadata = { ...entry.metadata, ...updates.metadata };
    if (updates.metadata?.tags) entry.metadata.tags = [...new Set([...entry.metadata.tags, ...updates.metadata.tags])];
    if (updates.relations) entry.relations = [...(entry.relations ?? []), ...updates.relations];
    if (updates.sources) {
      const sources = [...(entry.sources ?? []), ...updates.sources];
      entry.sources = Array.from(new Map(sources.map((source) => [`${source.type}:${source.identifier}`, source])).values());
    }
    if (updates.embedding) entry.embedding = updates.embedding;
    if (updates.blocks) entry.blocks = updates.blocks;
    if (updates.sourceRefs) entry.sourceRefs = updates.sourceRefs;
    if (updates.validFrom) entry.validFrom = updates.validFrom;
    if (updates.validUntil !== undefined) entry.validUntil = updates.validUntil;
    if (updates.supersedes) entry.supersedes = updates.supersedes;
    if (updates.status) entry.status = updates.status;
    if (updates.quality) entry.quality = updates.quality;

    entry.timeline.updatedAt = new Date().toISOString();
    entry.timeline.version = (entry.timeline.version ?? 1) + 1;

    await this.updateEntryDirect(entry);
    await this.emit("updated", { entryId, agentId: entry.agentId });
    return entry;
  }

  /** Delete an entry by ID. */
  async delete(entryId: string): Promise<boolean> {
    const entry = await this.read(entryId);
    if (!entry) return false;

    const scope = entry.scope;
    const entries = await this.loadScope(scope);
    const filtered = entries.filter((e) => e.id !== entryId);

    if (filtered.length === entries.length) return false;

    await this.saveScope(scope, filtered);

    // Remove from index and cache
    this.index.remove(entryId);
    this.cache.invalidateEntry(entryId);

    // Remove from vector store
    if (this.vectorService) {
      await this.vectorService.remove(entryId);
    }

    await this.emit("deleted", { entryId, agentId: entry.agentId });
    return true;
  }

  // -------------------------------------------------------------------------
  // Query Operations
  // -------------------------------------------------------------------------

  /** Multi-strategy query. */
  async query(opts: MemoryQuery): Promise<MemoryQueryResult> {
    const startTime = Date.now();
    const strategies: string[] = [];

    // Check query cache first
    const cacheKey = MemoryCache.generateQueryKey(opts as Record<string, unknown>);
    const cached = this.cache.getQuery(cacheKey);
    if (cached) {
      return {
        entries: cached,
        total: cached.length,
        strategies: ["cache"],
        executionTimeMs: Date.now() - startTime,
      };
    }

    // Build index if not already built
    if (!this.indexBuilt) {
      const allEntries: MemoryEntryV2[] = [];
      const scopes: MemoryScope[] = ["private", "project", "shared"];
      for (const scope of scopes) {
        const entries = await this.loadScope(scope);
        allEntries.push(...entries);
      }
      this.index.build(allEntries);
      this.indexBuilt = true;
    }

    // Use index for fast filtering when possible
    let candidateIds: string[] | undefined;
    if (opts.text || opts.types || opts.tags || opts.agentId || opts.projectId || opts.timeRange) {
      candidateIds = this.index.query({
        text: opts.text,
        types: opts.types,
        tags: opts.tags,
        agentId: opts.agentId,
        projectId: opts.projectId,
        timeRange: opts.timeRange,
      });
    }

    // Load all candidate entries
    let candidates: MemoryEntryV2[] = [];
    if (candidateIds !== undefined && candidateIds.length > 0) {
      candidates = this.index.entriesByIds(candidateIds);
      this.cache.preload(candidates);
    } else if (candidateIds !== undefined) {
      candidates = [];
    } else if (opts.scope) {
      candidates = await this.loadScope(opts.scope);
    } else {
      const scopes: MemoryScope[] = ["private", "project", "shared"];
      for (const scope of scopes) {
        const entries = await this.loadScope(scope);
        candidates.push(...entries);
      }
    }

    // Filter by agent (if not already indexed)
    if (opts.agentId && !candidateIds) {
      candidates = candidates.filter((e) => e.agentId === opts.agentId);
    }

    // Filter by project (if not already indexed)
    if (opts.projectId && !candidateIds) {
      candidates = candidates.filter((e) => e.projectId === opts.projectId);
    }

    // Filter by type (if not already indexed)
    if (opts.types && opts.types.length > 0 && !candidateIds) {
      candidates = candidates.filter((e) => opts.types!.includes(e.type));
    }

    // Filter by tags (if not already indexed)
    if (opts.tags && opts.tags.length > 0 && !candidateIds) {
      candidates = candidates.filter((e) =>
        opts.tags!.some((t) => e.metadata.tags?.includes(t))
      );
    }

    // Filter expired
    if (!opts.includeExpired) {
      candidates = candidates.filter((e) => {
        if (isMemoryExpired(e)) return false;
        if (e.status === "superseded" || e.status === "retracted" || e.status === "rejected") return false;
        if (e.validUntil && new Date(e.validUntil).getTime() < Date.now()) return false;
        return true;
      });
    }

    // Time range filter (if not already indexed)
    if (opts.timeRange && !candidateIds) {
      if (opts.timeRange.from) {
        const from = new Date(opts.timeRange.from).getTime();
        candidates = candidates.filter((e) => new Date(e.timeline.createdAt).getTime() >= from);
      }
      if (opts.timeRange.to) {
        const to = new Date(opts.timeRange.to).getTime();
        candidates = candidates.filter((e) => new Date(e.timeline.createdAt).getTime() <= to);
      }
    }

    let results = candidates;

    // Text search: use semantic + keyword hybrid
    if (opts.text && opts.text.trim()) {
      strategies.push("text");

      // Semantic search via vector service
      if (this.vectorService) {
        strategies.push("semantic");
        const semanticResults = await this.vectorService.semanticQuery(opts.text, opts.limit ?? 50);
        const semanticIds = new Set(semanticResults.map((r) => r.entryId));
        results = candidates.filter((e) => semanticIds.has(e.id));
      }

      // Fallback: keyword search with TF-IDF-like scoring if no semantic results
      if (results.length === 0) {
        strategies.push("keyword");
        const queryTerms = opts.text.toLowerCase().split(/\s+/).filter(Boolean);
        results = candidates
          .map((e) => {
            const text = getMemoryText(e).toLowerCase();
            // Score: count how many query terms appear in the text
            let score = 0;
            for (const term of queryTerms) {
              const count = (text.match(new RegExp(escapeRegex(term), "g")) ?? []).length;
              score += count;
            }
            return { entry: e, score };
          })
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((r) => r.entry);
      }
    }

    // Sort by recency for non-text queries. Text queries preserve index/keyword relevance order.
    if (!opts.text?.trim()) {
      results.sort((a, b) =>
        new Date(b.timeline.createdAt).getTime() - new Date(a.timeline.createdAt).getTime()
      );
    }

    // Pagination
    const total = results.length;
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 50;
    results = results.slice(offset, offset + limit);

    const executionTimeMs = Date.now() - startTime;

    // Cache query results
    this.cache.setQuery(cacheKey, results);

    return {
      entries: results,
      total,
      strategies,
      executionTimeMs,
    };
  }

  // -------------------------------------------------------------------------
  // Relation Graph
  // -------------------------------------------------------------------------

  /** Build relation graph for a set of entries. */
  buildRelationGraph(entries: MemoryEntryV2[]): RelationGraph {
    const nodes = entries.map((e) => ({
      id: e.id,
      type: e.type,
      content: e.content.slice(0, 100),
      agentId: e.agentId,
    }));

    const edges: RelationGraph["edges"] = [];
    const entryIds = new Set(entries.map((e) => e.id));

    for (const entry of entries) {
      if (!entry.relations) continue;
      for (const rel of entry.relations) {
        if (entryIds.has(rel.targetId)) {
          edges.push({
            source: entry.id,
            target: rel.targetId,
            type: rel.type,
            strength: rel.strength ?? 0.5,
          });
        }
      }
    }

    return { nodes, edges };
  }

  /** Find related entries (1-hop traversal). */
  async findRelated(entryId: string, maxDepth = 1): Promise<MemoryEntryV2[]> {
    const visited = new Set<string>();
    const result: MemoryEntryV2[] = [];
    let current = [entryId];

    for (let depth = 0; depth < maxDepth; depth++) {
      const next: string[] = [];
      for (const id of current) {
        if (visited.has(id)) continue;
        visited.add(id);

        const entry = await this.read(id);
        if (entry) {
          result.push(entry);
          if (entry.relations) {
            for (const rel of entry.relations) {
              if (!visited.has(rel.targetId)) {
                next.push(rel.targetId);
              }
            }
          }
        }
      }
      current = next;
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Lifecycle Management
  // -------------------------------------------------------------------------

  /** Get memory statistics. */
  async getStats(): Promise<MemoryStats> {
    const scopes: MemoryScope[] = ["private", "project", "shared"];
    let totalEntries = 0;
    let expiredCount = 0;
    let totalAge = 0;
    let totalRelations = 0;
    const byType: Partial<Record<MemoryType, number>> = {};
    const byAgent: Record<string, number> = {};
    const byScope: Record<string, number> = {};

    for (const scope of scopes) {
      const entries = await this.loadScope(scope);
      totalEntries += entries.length;
      byScope[scope] = entries.length;

      for (const entry of entries) {
        byType[entry.type] = (byType[entry.type] ?? 0) + 1;
        byAgent[entry.agentId] = (byAgent[entry.agentId] ?? 0) + 1;

        if (isMemoryExpired(entry)) expiredCount++;
        totalAge += getMemoryAgeDays(entry);
        totalRelations += entry.relations?.length ?? 0;
      }
    }

    return {
      totalEntries,
      byType: byType as Record<MemoryType, number>,
      byAgent,
      byScope,
      expiredCount,
      avgAgeDays: totalEntries > 0 ? totalAge / totalEntries : 0,
      totalRelations,
    };
  }

  /** Remove expired memories. */
  async cleanupExpired(): Promise<number> {
    const scopes: MemoryScope[] = ["private", "project", "shared"];
    let removed = 0;

    for (const scope of scopes) {
      const entries = await this.loadScope(scope);
      const valid = entries.filter((e) => {
        if (isMemoryExpired(e)) {
          removed++;
          return false;
        }
        return true;
      });

      if (valid.length !== entries.length) {
        await this.saveScope(scope, valid);
      }
    }

    return removed;
  }

  /** Compact all scopes (remove duplicates, sort). */
  async compact(): Promise<void> {
    const scopes: MemoryScope[] = ["private", "project", "shared"];
    for (const scope of scopes) {
      const entries = await this.loadScope(scope);
      // Remove duplicates by ID (keep latest)
      const seen = new Map<string, MemoryEntryV2>();
      for (const entry of entries) {
        const existing = seen.get(entry.id);
        if (!existing || new Date(entry.timeline.updatedAt) > new Date(existing.timeline.updatedAt)) {
          seen.set(entry.id, entry);
        }
      }
      const unique = Array.from(seen.values());
      unique.sort((a, b) =>
        new Date(b.timeline.createdAt).getTime() - new Date(a.timeline.createdAt).getTime()
      );
      await this.saveScope(scope, unique);
    }
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  /** Subscribe to memory events. */
  on(event: MemoryEvent["type"], handler: EventHandler): () => void {
    const handlers = this.eventHandlers.get(event) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);

    return () => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    };
  }

  private async emit(
    type: MemoryEvent["type"],
    payload: { entryId: string; agentId: string }
  ): Promise<void> {
    const handlers = this.eventHandlers.get(type) ?? [];
    const event: MemoryEvent = {
      type,
      entryId: payload.entryId,
      agentId: payload.agentId,
      timestamp: new Date().toISOString(),
    };

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private async persist(entry: MemoryEntryV2): Promise<void> {
    const basePath = this.resolveBaseDir();
    const dir = join(basePath, "agents", entry.agentId, entry.scope);
    await ensureDir(dir);
    const memoriesPath = join(dir, "memories.jsonl");
    await appendJsonl(memoriesPath, entry);
  }

  private async updateEntryDirect(entry: MemoryEntryV2): Promise<void> {
    const scope = entry.scope;
    const entries = await this.loadScope(scope);
    const idx = entries.findIndex((e) => e.id === entry.id);
    if (idx >= 0) {
      entries[idx] = entry;
      await this.saveScope(scope, entries);
      this.index.update(entry);
      this.cache.setEntry(entry.id, entry);
      this.cache.invalidateQueryCaches();
    }
  }

  /** Resolve the filesystem base directory using the viking:// URI convention. */
  private resolveBaseDir(): string {
    // Parse viking://org/<org> to extract org segment
    const match = this.cfg.targetRoot.match(/^viking:\/\/org\/([^/]+)/);
    const org = match?.[1] ?? "default";
    return join(this.cfg.basePath, org);
  }

  private async loadScope(scope: MemoryScope): Promise<MemoryEntryV2[]> {
    const entries: MemoryEntryV2[] = [];

    // Resolve base directory using viking:// URI convention
    const basePath = this.resolveBaseDir();
    const { readdir } = await import("fs/promises");

    try {
      const agentsDir = join(basePath, "agents");
      if (!existsSync(agentsDir)) return [];

      const agentDirs = await readdir(agentsDir, { withFileTypes: true });

      for (const agentDir of agentDirs) {
        if (!agentDir.isDirectory()) continue;

        // V2 path: agents/{agentId}/{scope}/memories.jsonl
        const scopeDir = join(agentsDir, agentDir.name, scope);
        const memoriesPath = join(scopeDir, "memories.jsonl");

        if (existsSync(memoriesPath)) {
          const raw = await readJsonl<MemoryEntryV2>(memoriesPath);

          for (const entry of raw) {
            if (validateMemoryEntryV2(entry)) {
              entries.push(entry);
            } else if ((entry as any).id && (entry as any).type && (entry as any).content) {
              const { migrateV1ToV2 } = await import("../models/schema-v2.js");
              entries.push(migrateV1ToV2(entry as any));
            }
          }
        }

        // V1 compat: also scan agents/{agentId}/projects/*/memories.jsonl
        // V1 stores memories under project directories, which map to 'project' scope in V2
        if (scope === "project" || scope === "shared") {
          const projectsDir = join(agentsDir, agentDir.name, "projects");
          if (existsSync(projectsDir)) {
            try {
              const projectDirs = await readdir(projectsDir, { withFileTypes: true });
              for (const pDir of projectDirs) {
                if (!pDir.isDirectory()) continue;
                const v1Path = join(projectsDir, pDir.name, "memories.jsonl");
                if (!existsSync(v1Path)) continue;

                const raw = await readJsonl<MemoryEntryV2>(v1Path);
                for (const entry of raw) {
                  // Skip duplicates (same ID already loaded from V2 path)
                  if (entries.some((e) => e.id === entry.id)) continue;

                  if (validateMemoryEntryV2(entry)) {
                    entries.push(entry);
                  } else if ((entry as any).id && (entry as any).type && (entry as any).content) {
                    const { migrateV1ToV2 } = await import("../models/schema-v2.js");
                    entries.push(migrateV1ToV2(entry as any));
                  }
                }
              }
            } catch {
              // Project scan failure is non-fatal
            }
          }
        }
      }
    } catch {
      // Directory may not exist
    }

    return entries;
  }

  private async saveScope(scope: MemoryScope, entries: MemoryEntryV2[]): Promise<void> {
    // Group by agent and save
    const byAgent = new Map<string, MemoryEntryV2[]>();
    for (const entry of entries) {
      const list = byAgent.get(entry.agentId) ?? [];
      list.push(entry);
      byAgent.set(entry.agentId, list);
    }

    const basePath = this.resolveBaseDir();
    const agentsDir = join(basePath, "agents");
    const { readdir } = await import("fs/promises");
    if (existsSync(agentsDir)) {
      const existingAgents = await readdir(agentsDir, { withFileTypes: true });
      for (const agentDir of existingAgents) {
        if (agentDir.isDirectory() && !byAgent.has(agentDir.name)) {
          byAgent.set(agentDir.name, []);
        }
      }
    }

    for (const [agentId, agentEntries] of byAgent) {
      const dir = join(basePath, "agents", agentId, scope);
      await ensureDir(dir);
      const memoriesPath = join(dir, "memories.jsonl");
      await writeJsonl(memoriesPath, agentEntries);
    }
  }
}
