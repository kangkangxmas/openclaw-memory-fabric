/**
 * V2 Service Facade — Unified entry point for all V2 memory operations.
 *
 * Combines MemoryCoreV2, QueryRouter, AdvancedQuery, SyncEngine,
 * ExportService, MemoryIndex, and MemoryCache into a single API.
 *
 * This is the recommended integration point for OpenClaw sidecar.
 */

import type { SidecarConfig } from "../config/index.js";
import { MemoryCoreV2, type MemoryQuery, type MemoryQueryResult, type RelationGraph, type MemoryStats } from "../core/memory-core-v2.js";
import { QueryRouter } from "../core/query-router.js";
import { AdvancedQuery, type AggregationSpec, type AggregationResult, type GroupResult, type FacetResult, type DedupResult } from "../core/advanced-query.js";
import { SyncEngine, type SyncConfig, type SyncResult, type SyncSnapshot, type ConflictStrategy } from "../core/sync-engine.js";
import { ExportService, type ExportData, type ExportOptions, type ImportOptions, type ImportResult, type BackupData } from "../core/export-service.js";
import { MemoryIndex } from "../core/memory-index.js";
import { MemoryCache } from "../core/memory-cache.js";
import type { MemoryEntryV2, MemoryType } from "../models/schema-v2.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface V2FacadeConfig {
  /** Sidecar openviking config */
  sidecarConfig: SidecarConfig["openviking"];
  /** Sync configuration */
  syncConfig?: Partial<SyncConfig>;
  /** Instance ID for sync */
  instanceId?: string;
  /** Enable query cache */
  enableCache?: boolean;
}

export interface V2QueryOptions {
  /** Text query */
  text?: string;
  /** Filter by types */
  types?: MemoryType[];
  /** Filter by tags */
  tags?: string[];
  /** Filter by agent */
  agentId?: string;
  /** Filter by project */
  projectId?: string;
  /** Filter by scope */
  scope?: string;
  /** Time range */
  timeRange?: { from?: string; to?: string };
  /** Max results */
  limit?: number;
  /** Offset */
  offset?: number;
  /** Include expired */
  includeExpired?: boolean;
  /** Use router to classify query */
  useRouter?: boolean;
}

export interface V2CreateOptions {
  /** Memory content */
  content: string;
  /** Agent ID */
  agentId: string;
  /** Memory type */
  type?: MemoryType;
  /** Tags */
  tags?: string[];
  /** Scope */
  scope?: string;
  /** Project ID */
  projectId?: string;
  /** TTL in ms */
  ttlMs?: number;
}

export interface V2UpdateOptions {
  /** Content */
  content?: string;
  /** Tags */
  tags?: string[];
  /** Type */
  type?: MemoryType;
  /** Priority */
  priority?: number;
  /** Embedding vector */
  embedding?: Float32Array;
}

// ---------------------------------------------------------------------------
// V2ServiceFacade
// ---------------------------------------------------------------------------

export class V2ServiceFacade {
  private readonly core: MemoryCoreV2;
  private readonly router: QueryRouter;
  private readonly advancedQuery: AdvancedQuery;
  private readonly syncEngine: SyncEngine;
  private readonly exportService: ExportService;
  private readonly index: MemoryIndex;
  private readonly cache: MemoryCache;
  private readonly instanceId: string;

  constructor(config: V2FacadeConfig) {
    this.core = new MemoryCoreV2(config.sidecarConfig);
    this.router = new QueryRouter(this.core, undefined);
    this.advancedQuery = new AdvancedQuery();
    this.syncEngine = new SyncEngine(config.syncConfig);
    this.exportService = new ExportService(config.instanceId);
    this.index = new MemoryIndex();
    this.cache = new MemoryCache();
    this.instanceId = config.instanceId ?? `sidecar-${Date.now()}`;
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  /** Create a new memory entry. */
  async create(opts: V2CreateOptions): Promise<MemoryEntryV2> {
    const entry = await this.core.create({
      content: opts.content,
      agentId: opts.agentId,
      type: opts.type ?? "fact",
      scope: opts.scope as any ?? "private",
      visibility: "private",
      projectId: opts.projectId,
      metadata: {
        tags: opts.tags ?? [],
      },
      timeline: opts.ttlMs
        ? { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1, expiresAt: new Date(Date.now() + opts.ttlMs).toISOString() }
        : undefined,
    });

    this.index.add(entry);
    this.cache.setEntry(entry.id, entry);
    this.cache.invalidateQueryCaches();

    return entry;
  }

  /** Read a memory entry by ID. */
  async read(id: string): Promise<MemoryEntryV2 | null> {
    const cached = this.cache.getEntry(id);
    if (cached) return cached;

    const entry = await this.core.read(id);
    if (entry) this.cache.setEntry(id, entry);
    return entry;
  }

  /** Update a memory entry. */
  async update(id: string, opts: V2UpdateOptions): Promise<MemoryEntryV2 | null> {
    const updateData: Record<string, unknown> = {};
    if (opts.content !== undefined) updateData.content = opts.content;
    if (opts.tags !== undefined) updateData.metadata = { tags: opts.tags };
    if (opts.type !== undefined) updateData.type = opts.type;
    if (opts.priority !== undefined) updateData.metadata = { priority: opts.priority, tags: [] };
    if (opts.embedding !== undefined) updateData.embedding = { vector: Array.from(opts.embedding) };

    const entry = await this.core.update(id, updateData);
    if (entry) {
      this.index.update(entry);
      this.cache.setEntry(id, entry);
      this.cache.invalidateQueryCaches();
    }
    return entry;
  }

  /** Delete a memory entry. */
  async delete(id: string): Promise<boolean> {
    const result = await this.core.delete(id);
    if (result) {
      this.index.remove(id);
      this.cache.invalidateEntry(id);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  /** Query memories with optional router classification. */
  async query(opts: V2QueryOptions): Promise<MemoryQueryResult> {
    const query: MemoryQuery = {
      text: opts.text,
      types: opts.types,
      tags: opts.tags,
      agentId: opts.agentId,
      projectId: opts.projectId,
      scope: opts.scope as any,
      timeRange: opts.timeRange,
      limit: opts.limit,
      offset: opts.offset,
      includeExpired: opts.includeExpired,
    };

    // Use router to classify and optimize query
    if (opts.useRouter && opts.text) {
      const routed = await this.router.route(opts.text, query);
      // Convert RoutedResult to MemoryQueryResult
      return {
        entries: routed.results,
        total: routed.results.length,
        strategies: routed.sources.map((s) => s.strategy),
        executionTimeMs: routed.executionTimeMs,
      };
    }

    return this.core.query(query);
  }

  /** Quick text search. */
  async search(text: string, limit?: number): Promise<MemoryEntryV2[]> {
    const result = await this.query({ text, limit, useRouter: true });
    return result.entries;
  }

  // -------------------------------------------------------------------------
  // Advanced Query
  // -------------------------------------------------------------------------

  /** Aggregate over entries. */
  async aggregate(spec: AggregationSpec, opts?: V2QueryOptions): Promise<AggregationResult> {
    const result = await this.query(opts ?? {});
    return this.advancedQuery.aggregate(result.entries, spec);
  }

  /** Group entries. */
  async group(field: string, opts?: V2QueryOptions): Promise<GroupResult[]> {
    const result = await this.query(opts ?? {});
    return this.advancedQuery.group(result.entries, field);
  }

  /** Generate facets. */
  async facets(fields: string[], opts?: V2QueryOptions): Promise<FacetResult[]> {
    const result = await this.query(opts ?? {});
    return this.advancedQuery.facets(result.entries, fields);
  }

  /** Deduplicate entries. */
  async deduplicate(opts?: V2QueryOptions & { similarity?: number; keyField?: string }): Promise<DedupResult> {
    const result = await this.query({ ...opts, limit: 10000 });
    return this.advancedQuery.deduplicate(result.entries, {
      similarity: opts?.similarity,
      keyField: opts?.keyField,
    });
  }

  // -------------------------------------------------------------------------
  // Relations
  // -------------------------------------------------------------------------

  /** Build relation graph. */
  async buildRelationGraph(opts?: V2QueryOptions): Promise<RelationGraph> {
    const result = await this.query(opts ?? { limit: 1000 });
    return this.core.buildRelationGraph(result.entries);
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  /** Get memory statistics. */
  async stats(agentId?: string): Promise<MemoryStats> {
    return this.core.getStats();
  }

  // -------------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------------

  /** Sync with another instance. */
  sync(
    sourceEntries: MemoryEntryV2[],
    targetEntries: MemoryEntryV2[],
    targetId: string
  ): SyncResult {
    return this.syncEngine.sync(sourceEntries, targetEntries, this.instanceId, targetId);
  }

  /** Get last sync snapshot. */
  getLastSync(targetId: string): SyncSnapshot | undefined {
    return this.syncEngine.getLastSnapshot(this.instanceId, targetId);
  }

  // -------------------------------------------------------------------------
  // Export / Import / Backup
  // -------------------------------------------------------------------------

  /** Export memories. */
  async exportEntries(opts?: Partial<ExportOptions>): Promise<ExportData> {
    const allEntries = await this.search("", 10000);
    return this.exportService.export(allEntries, opts);
  }

  /** Import memories. */
  async importEntries(
    data: ExportData,
    existingEntries: MemoryEntryV2[],
    opts?: Partial<ImportOptions>
  ): Promise<ImportResult> {
    return this.exportService.import(data, existingEntries, opts);
  }

  /** Create a backup. */
  async backup(description?: string): Promise<BackupData> {
    const allEntries = await this.search("", 10000);
    return this.exportService.backup(allEntries, description);
  }

  /** Verify a backup. */
  verifyBackup(backup: BackupData): { valid: boolean; errors: string[] } {
    return this.exportService.verifyBackup(backup);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Cleanup expired memories. */
  async cleanup(): Promise<number> {
    return this.core.cleanupExpired();
  }

  /** Compact storage. */
  async compact(): Promise<void> {
    return this.core.compact();
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  /** Subscribe to memory events. */
  on(event: "created" | "updated" | "deleted" | "expired" | "accessed", handler: (event: any) => void | Promise<void>): () => void {
    return this.core.on(event, handler);
  }

  // -------------------------------------------------------------------------
  // Cache / Index Management
  // -------------------------------------------------------------------------

  /** Get cache stats. */
  getCacheStats(): { entryCacheSize: number; queryCacheSize: number; totalCached: number } {
    return this.cache.getStats();
  }

  /** Get index stats. */
  getIndexStats(): { totalEntries: number; types: number; tags: number; agents: number } {
    return this.index.getStats();
  }

  /** Clear all caches. */
  clearCaches(): void {
    this.cache.clear();
  }
}
