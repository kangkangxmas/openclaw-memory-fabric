/**
 * Memory API V2 — RESTful API for Memory Core V2.
 *
 * Endpoints:
 * - POST   /api/v2/memory              Create memory
 * - GET    /api/v2/memory/:id          Read memory
 * - PATCH  /api/v2/memory/:id          Update memory
 * - DELETE /api/v2/memory/:id          Delete memory
 * - POST   /api/v2/memory/query        Query memories
 * - GET    /api/v2/memory/related/:id  Find related memories
 * - GET    /api/v2/memory/graph        Get relation graph
 * - GET    /api/v2/memory/stats        Get statistics
 * - POST   /api/v2/memory/cleanup      Cleanup expired memories
 * - POST   /api/v2/memory/compact      Compact storage
 */

import type { MemoryCoreV2, MemoryQuery } from "../core/memory-core-v2.js";
import type { QueryRouter } from "../core/query-router.js";
import type { MemoryEntryV2, MemoryType } from "../models/schema-v2.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    executionTimeMs?: number;
    total?: number;
    page?: number;
    pageSize?: number;
  };
}

export interface CreateMemoryRequest {
  content: string;
  type?: MemoryType;
  agentId: string;
  projectId?: string;
  scope?: "private" | "project" | "shared";
  visibility?: "private" | "project_shared" | "org_shared";
  tags?: string[];
  relations?: Array<{
    type: string;
    targetId: string;
    strength?: number;
  }>;
  sources?: Array<{
    type: string;
    identifier: string;
  }>;
  blocks?: Array<{
    format: string;
    content: string;
    language?: string;
  }>;
}

export interface UpdateMemoryRequest {
  content?: string;
  type?: MemoryType;
  tags?: string[];
  relations?: Array<{
    type: string;
    targetId: string;
    strength?: number;
  }>;
}

export interface QueryRequest {
  text?: string;
  types?: MemoryType[];
  tags?: string[];
  agentId?: string;
  projectId?: string;
  scope?: "private" | "project" | "shared";
  timeRange?: { from?: string; to?: string };
  includeExpired?: boolean;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// MemoryAPIV2
// ---------------------------------------------------------------------------

export class MemoryAPIV2 {
  constructor(
    private readonly memoryCore: MemoryCoreV2,
    private readonly queryRouter?: QueryRouter
  ) {}

  // -------------------------------------------------------------------------
  // CRUD Operations
  // -------------------------------------------------------------------------

  /** POST /api/v2/memory */
  async create(req: CreateMemoryRequest): Promise<ApiResponse<MemoryEntryV2>> {
    try {
      const entry = await this.memoryCore.create({
        content: req.content,
        type: req.type ?? "fact",
        agentId: req.agentId,
        projectId: req.projectId,
        scope: req.scope ?? "project",
        visibility: req.visibility ?? "private",
        metadata: {
          tags: req.tags ?? [],
        },
        relations: req.relations?.map((r) => ({
          type: r.type as any,
          targetId: r.targetId,
          strength: r.strength ?? 0.5,
        })),
        sources: req.sources?.map((s) => ({
          type: s.type as any,
          identifier: s.identifier,
          timestamp: new Date().toISOString(),
        })),
        blocks: req.blocks?.map((b) => ({
          format: b.format as any,
          content: b.content,
          language: b.language,
        })),
      });

      return {
        success: true,
        data: entry,
        meta: { executionTimeMs: 0 },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** GET /api/v2/memory/:id */
  async read(id: string): Promise<ApiResponse<MemoryEntryV2>> {
    try {
      const entry = await this.memoryCore.read(id);
      if (!entry) {
        return { success: false, error: "Memory not found" };
      }

      return { success: true, data: entry };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** PATCH /api/v2/memory/:id */
  async update(id: string, req: UpdateMemoryRequest): Promise<ApiResponse<MemoryEntryV2>> {
    try {
      const entry = await this.memoryCore.update(id, {
        content: req.content,
        type: req.type,
        metadata: req.tags ? { tags: req.tags } : undefined,
        relations: req.relations?.map((r) => ({
          type: r.type as any,
          targetId: r.targetId,
          strength: r.strength ?? 0.5,
        })),
      });

      if (!entry) {
        return { success: false, error: "Memory not found" };
      }

      return { success: true, data: entry };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** DELETE /api/v2/memory/:id */
  async delete(id: string): Promise<ApiResponse<{ deleted: boolean }>> {
    try {
      const deleted = await this.memoryCore.delete(id);
      return {
        success: true,
        data: { deleted },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // -------------------------------------------------------------------------
  // Query Operations
  // -------------------------------------------------------------------------

  /** POST /api/v2/memory/query */
  async query(req: QueryRequest): Promise<ApiResponse<MemoryEntryV2[]>> {
    try {
      const startTime = Date.now();

      // Use query router if available and text query provided
      if (this.queryRouter && req.text) {
        const routed = await this.queryRouter.route(req.text, {
          types: req.types,
          tags: req.tags,
          agentId: req.agentId,
          projectId: req.projectId,
          scope: req.scope,
          timeRange: req.timeRange,
          includeExpired: req.includeExpired,
          limit: req.limit,
          offset: req.offset,
        });

        return {
          success: true,
          data: routed.results,
          meta: {
            executionTimeMs: Date.now() - startTime,
            total: routed.results.length,
          },
        };
      }

      // Fallback to direct query
      const result = await this.memoryCore.query({
        text: req.text,
        types: req.types,
        tags: req.tags,
        agentId: req.agentId,
        projectId: req.projectId,
        scope: req.scope,
        timeRange: req.timeRange,
        includeExpired: req.includeExpired,
        limit: req.limit ?? 50,
        offset: req.offset ?? 0,
      });

      return {
        success: true,
        data: result.entries,
        meta: {
          executionTimeMs: Date.now() - startTime,
          total: result.total,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** GET /api/v2/memory/related/:id */
  async related(id: string, maxDepth?: number): Promise<ApiResponse<MemoryEntryV2[]>> {
    try {
      const entries = await this.memoryCore.findRelated(id, maxDepth ?? 1);
      return {
        success: true,
        data: entries,
        meta: { total: entries.length },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** GET /api/v2/memory/graph */
  async graph(limit?: number): Promise<ApiResponse<{
    nodes: Array<{ id: string; type: string; content: string }>;
    edges: Array<{ source: string; target: string; type: string; strength: number }>;
  }>> {
    try {
      // Load all entries (with limit)
      const result = await this.memoryCore.query({
        limit: limit ?? 100,
      });

      const graph = this.memoryCore.buildRelationGraph(result.entries);

      return {
        success: true,
        data: {
          nodes: graph.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            content: n.content,
          })),
          edges: graph.edges,
        },
        meta: {
          total: graph.nodes.length,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // -------------------------------------------------------------------------
  // Management
  // -------------------------------------------------------------------------

  /** GET /api/v2/memory/stats */
  async stats(): Promise<ApiResponse<{
    totalEntries: number;
    byType: Record<string, number>;
    byAgent: Record<string, number>;
    byScope: Record<string, number>;
    expiredCount: number;
    avgAgeDays: number;
    totalRelations: number;
  }>> {
    try {
      const stats = await this.memoryCore.getStats();
      return {
        success: true,
        data: stats,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** POST /api/v2/memory/cleanup */
  async cleanup(): Promise<ApiResponse<{ removed: number }>> {
    try {
      const removed = await this.memoryCore.cleanupExpired();
      return {
        success: true,
        data: { removed },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** POST /api/v2/memory/compact */
  async compact(): Promise<ApiResponse<{ success: boolean }>> {
    try {
      await this.memoryCore.compact();
      return {
        success: true,
        data: { success: true },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
