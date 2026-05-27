/**
 * V2 API Routes — New endpoints using V2ServiceFacade.
 *
 * All V2 routes are prefixed with /v2/ to coexist with legacy V1 routes.
 */

import type { FastifyInstance } from "fastify";
import { V2ServiceFacade, type V2FacadeConfig } from "../services/v2-service-facade.js";
import type { SidecarConfig } from "../config/index.js";
import type { VectorService } from "../services/vector-service.js";

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

export function registerV2Routes(
  app: FastifyInstance,
  cfg: SidecarConfig["openviking"],
  vectorService?: VectorService
): void {
  const facade = new V2ServiceFacade({
    sidecarConfig: cfg,
    instanceId: process.env.SIDECAR_INSTANCE_ID ?? `sidecar-${Date.now()}`,
    enableCache: true,
  });

  // -------------------------------------------------------------------------
  // POST /v2/memories — Create a memory
  // -------------------------------------------------------------------------
  app.post<{
    Body: {
      content: string;
      agentId: string;
      type?: string;
      tags?: string[];
      scope?: string;
      projectId?: string;
      ttlMs?: number;
    };
  }>(
    "/v2/memories",
    {
      schema: {
        body: {
          type: "object",
          required: ["content", "agentId"],
          properties: {
            content: { type: "string", minLength: 1 },
            agentId: { type: "string", minLength: 1 },
            type: { type: "string", enum: ["fact", "decision", "entity", "pattern", "unresolved", "code", "api", "lesson"] },
            tags: { type: "array", items: { type: "string" } },
            scope: { type: "string", enum: ["private", "project", "shared"] },
            projectId: { type: "string" },
            ttlMs: { type: "number", minimum: 0 },
          },
        },
      },
    },
    async (request) => {
      const { content, agentId, type, tags, scope, projectId, ttlMs } = request.body;
      const entry = await facade.create({
        content,
        agentId,
        type: type as any,
        tags,
        scope,
        projectId,
        ttlMs,
      });
      return { ok: true, entry };
    }
  );

  // -------------------------------------------------------------------------
  // GET /v2/memories/:id — Read a memory
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/v2/memories/:id",
    async (request) => {
      const entry = await facade.read(request.params.id);
      if (!entry) {
        return { ok: false, error: "Not found" };
      }
      return { ok: true, entry };
    }
  );

  // -------------------------------------------------------------------------
  // PATCH /v2/memories/:id — Update a memory
  // -------------------------------------------------------------------------
  app.patch<{
    Params: { id: string };
    Body: {
      content?: string;
      tags?: string[];
      type?: string;
      priority?: number;
    };
  }>(
    "/v2/memories/:id",
    async (request) => {
      const { content, tags, type, priority } = request.body;
      const entry = await facade.update(request.params.id, {
        content,
        tags,
        type: type as any,
        priority,
      });
      if (!entry) {
        return { ok: false, error: "Not found" };
      }
      return { ok: true, entry };
    }
  );

  // -------------------------------------------------------------------------
  // DELETE /v2/memories/:id — Delete a memory
  // -------------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    "/v2/memories/:id",
    async (request) => {
      const deleted = await facade.delete(request.params.id);
      return { ok: deleted };
    }
  );

  // -------------------------------------------------------------------------
  // POST /v2/query — Query memories
  // -------------------------------------------------------------------------
  app.post<{
    Body: {
      text?: string;
      types?: string[];
      tags?: string[];
      agentId?: string;
      projectId?: string;
      scope?: string;
      timeRange?: { from?: string; to?: string };
      limit?: number;
      offset?: number;
      useRouter?: boolean;
    };
  }>(
    "/v2/query",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            text: { type: "string" },
            types: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            agentId: { type: "string" },
            projectId: { type: "string" },
            scope: { type: "string" },
            limit: { type: "number", minimum: 1, maximum: 1000 },
            offset: { type: "number", minimum: 0 },
            useRouter: { type: "boolean" },
          },
        },
      },
    },
    async (request) => {
      const result = await facade.query({ ...request.body, types: request.body.types as any[] });
      return {
        ok: true,
        entries: result.entries,
        total: result.total,
        executionTimeMs: result.executionTimeMs,
      };
    }
  );

  // -------------------------------------------------------------------------
  // POST /v2/search — Quick text search
  // -------------------------------------------------------------------------
  app.post<{ Body: { text: string; limit?: number } }>(
    "/v2/search",
    {
      schema: {
        body: {
          type: "object",
          required: ["text"],
          properties: {
            text: { type: "string", minLength: 1 },
            limit: { type: "number", minimum: 1, maximum: 1000 },
          },
        },
      },
    },
    async (request) => {
      const entries = await facade.search(request.body.text, request.body.limit);
      return { ok: true, entries, count: entries.length };
    }
  );

  // -------------------------------------------------------------------------
  // POST /v2/aggregate — Aggregation
  // -------------------------------------------------------------------------
  app.post<{
    Body: {
      field: string;
      op: "count" | "sum" | "avg" | "min" | "max";
      groupBy?: string;
      query?: Record<string, unknown>;
    };
  }>("/v2/aggregate", async (request) => {
    const { field, op, groupBy, query } = request.body;
    if (groupBy) {
      const result = await facade.aggregate({ field, op }, query as any);
      return { ok: true, result };
    }
    const result = await facade.aggregate({ field, op }, query as any);
    return { ok: true, result };
  });

  // -------------------------------------------------------------------------
  // POST /v2/facets — Faceted search
  // -------------------------------------------------------------------------
  app.post<{
    Body: {
      fields: string[];
      query?: Record<string, unknown>;
    };
  }>("/v2/facets", async (request) => {
    const { fields, query } = request.body;
    const facets = await facade.facets(fields, query as any);
    return { ok: true, facets };
  });

  // -------------------------------------------------------------------------
  // POST /v2/dedup — Deduplicate
  // -------------------------------------------------------------------------
  app.post<{
    Body: {
      similarity?: number;
      keyField?: string;
      query?: Record<string, unknown>;
    };
  }>("/v2/dedup", async (request) => {
    const result = await facade.deduplicate(request.body);
    return {
      ok: true,
      totalBefore: result.totalBefore,
      totalAfter: result.totalAfter,
      duplicatesRemoved: result.totalBefore - result.totalAfter,
    };
  });

  // -------------------------------------------------------------------------
  // GET /v2/stats — Memory statistics
  // -------------------------------------------------------------------------
  app.get("/v2/stats", async () => {
    const stats = await facade.stats();
    const cacheStats = facade.getCacheStats();
    const indexStats = facade.getIndexStats();
    return { ok: true, stats, cache: cacheStats, index: indexStats };
  });

  // -------------------------------------------------------------------------
  // POST /v2/export — Export memories
  // -------------------------------------------------------------------------
  app.post<{
    Body: {
      format?: "json" | "jsonl";
      agentIds?: string[];
      types?: string[];
    };
  }>("/v2/export", async (request) => {
    const data = await facade.exportEntries(request.body);
    return { ok: true, version: data.version, entryCount: data.entryCount, entries: data.entries, metadata: data.metadata };
  });

  // -------------------------------------------------------------------------
  // POST /v2/backup — Create backup
  // -------------------------------------------------------------------------
  app.post<{
    Body: { description?: string };
  }>("/v2/backup", async (request) => {
    const backup = await facade.backup(request.body.description);
    return { ok: true, backupId: backup.backupId, entryCount: backup.entryCount, checksum: backup.checksum };
  });

  // -------------------------------------------------------------------------
  // POST /v2/backup/verify — Verify backup
  // -------------------------------------------------------------------------
  app.post<{
    Body: Record<string, unknown>;
  }>("/v2/backup/verify", async (request) => {
    const verification = facade.verifyBackup(request.body as any);
    return { ok: true, valid: verification.valid, errors: verification.errors };
  });

  // -------------------------------------------------------------------------
  // POST /v2/sync — Sync with another instance
  // -------------------------------------------------------------------------
  app.post<{
    Body: {
      sourceEntries: Record<string, unknown>[];
      targetEntries: Record<string, unknown>[];
      targetId: string;
    };
  }>("/v2/sync", async (request) => {
    const result = facade.sync(
      request.body.sourceEntries as any[],
      request.body.targetEntries as any[],
      request.body.targetId
    );
    return {
      ok: true,
      created: result.created,
      updated: result.updated,
      deleted: result.deleted,
      conflicts: result.conflicts.length,
      snapshot: result.snapshot,
    };
  });

  // -------------------------------------------------------------------------
  // POST /v2/cleanup — Cleanup expired memories
  // -------------------------------------------------------------------------
  app.post("/v2/cleanup", async () => {
    const count = await facade.cleanup();
    return { ok: true, expiredRemoved: count };
  });

  // -------------------------------------------------------------------------
  // POST /v2/cache/clear — Clear caches
  // -------------------------------------------------------------------------
  app.post("/v2/cache/clear", async () => {
    facade.clearCaches();
    return { ok: true };
  });
}
