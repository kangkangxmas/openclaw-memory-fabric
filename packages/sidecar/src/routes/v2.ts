/**
 * V2 API Routes — New endpoints using V2ServiceFacade.
 *
 * All V2 routes are prefixed with /v2/ to coexist with legacy V1 routes.
 */

import type { FastifyInstance } from "fastify";
import { V2ServiceFacade, type V2FacadeConfig } from "../services/v2-service-facade.js";
import type { SidecarConfig } from "../config/index.js";
import type { MemoryEntryV2 } from "../models/schema-v2.js";
import type { VectorService } from "../services/vector-service.js";
import { MemoryCoreV2 } from "../core/memory-core-v2.js";
import { EventLedgerService, type EventSourceType } from "../services/event-ledger-service.js";
import { AtomicMemoryStore, type AtomicMemoryCandidate } from "../services/atomic-memory-store.js";
import { MemoryConsolidator } from "../services/memory-consolidator.js";
import { ConsolidationWorker } from "../services/consolidation-worker.js";
import { RetrievalPlanner } from "../services/retrieval-planner.js";
import { CarrierProjectionEngine } from "../services/carrier-projection-engine.js";
import {
  MemoryBenchAlreadyRunningError,
  MemoryBenchRunner,
  type MemoryBenchCase,
  type MemoryBenchRunOptions,
} from "../services/memory-bench-runner.js";
import { MemoryBenchFixtureSeeder } from "../services/memory-bench-fixture-seeder.js";
import { V2RelationGraphService, type V2RelationType } from "../services/v2-relation-graph-service.js";
import { RecallAuditLogService } from "../services/recall-audit-log-service.js";
import { V2RolloutConfigService } from "../services/v2-rollout-config-service.js";
import { ContextHealthReporter } from "../services/context-health-reporter.js";
import type { CarrierRepository } from "../services/carrier-service.js";
import { isV2RecallReady, parseV2Mode, resolveV2ModeFromEnv, type V2Mode } from "../utils/v2-mode.js";

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

export function registerV2Routes(
  app: FastifyInstance,
  cfg: SidecarConfig["openviking"],
  carriers?: CarrierRepository,
  vectorService?: VectorService,
  rolloutConfig = new V2RolloutConfigService(cfg)
): void {
  const facade = new V2ServiceFacade({
    sidecarConfig: cfg,
    instanceId: process.env.SIDECAR_INSTANCE_ID ?? `sidecar-${Date.now()}`,
    enableCache: true,
  });
  const core = new MemoryCoreV2(cfg);
  const eventLedger = new EventLedgerService(cfg);
  const atomicStore = new AtomicMemoryStore(cfg);
  const relationGraph = new V2RelationGraphService(cfg);
  const recallAudit = new RecallAuditLogService(cfg);
  const contextHealth = new ContextHealthReporter();
  const consolidator = new MemoryConsolidator(cfg, atomicStore, relationGraph);
  const consolidationWorker = new ConsolidationWorker(atomicStore, consolidator);
  const retrievalPlanner = new RetrievalPlanner(core, relationGraph);
  const benchRunner = new MemoryBenchRunner(retrievalPlanner, cfg);
  const benchSeeder = new MemoryBenchFixtureSeeder(cfg, eventLedger, atomicStore, consolidator);
  const projection = carriers ? new CarrierProjectionEngine(carriers, cfg) : undefined;
  const memoryTypes = [
    "fact",
    "decision",
    "entity",
    "pattern",
    "unresolved",
    "code",
    "api",
    "lesson",
    "risk",
    "todo",
    "preference",
    "episode",
    "profile",
    "intent",
  ];
  const candidateStatuses: AtomicMemoryCandidate["status"][] = ["pending", "needs_review", "rejected", "promoted"];
  const relationTypes: V2RelationType[] = ["DECIDES", "IMPLEMENTS", "SUPERSEDES", "CAUSES", "VALIDATES", "CONSTRAINS"];
  const rolloutModes: V2Mode[] = ["off", "shadow", "v2-recall", "v2-write"];
  const benchTargets = {
    minCases: 30,
    recallAt5: 0.85,
    injectionPrecision: 0.8,
    staleRate: 0.05,
    sourceCoverage: 0.98,
    p95LatencyMs: 300,
  };
  const sensitivePatterns: Array<{ id: string; pattern: RegExp }> = [
    { id: "credential_keyword", pattern: /DB_PASS|DB_PASSWORD|PASSWORD|PASSWD|SECRET|TOKEN|密钥|口令|密码|access[_-]?key|api[_-]?key/i },
    { id: "dsn_with_credentials", pattern: /\b(?:mysql|postgres(?:ql)?|mongodb|redis):\/\/[^/\s:@]+:[^@\s]+@/i },
    { id: "host_port_database_login", pattern: /\b(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}\/[\w.-]+[,，]\s*[\w.-]+\/\S+/i },
    { id: "user_password_pair", pattern: /\b(?:user|username|db_user|账号|用户名)\s*[:=]\s*\S+.*(?:pass|password|db_pass|密码|口令)\s*[:=]\s*\S+/i },
    { id: "database_connection_info", pattern: /(?:数据库连接信息|database connection|db connection)/i },
  ];
  const parseStatuses = (value?: string): AtomicMemoryCandidate["status"][] | undefined =>
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter((item): item is AtomicMemoryCandidate["status"] => candidateStatuses.includes(item as AtomicMemoryCandidate["status"]));
  const parseOptionalNumber = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const parseNumberWithDefault = (value: string | undefined, fallback: number): number => parseOptionalNumber(value) ?? fallback;
  const splitList = (value?: string): string[] =>
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  const scopeKey = (agentId: string, projectId?: string): string => `${agentId}::${projectId ?? ""}`;
  const addScope = (scopes: Map<string, { agentId: string; projectId?: string }>, agentId?: string, projectId?: string): void => {
    if (!agentId) return;
    scopes.set(scopeKey(agentId, projectId), { agentId, projectId });
  };
  const parseScopeList = (value?: string): Array<{ agentId: string; projectId?: string }> =>
    splitList(value).map((item) => {
      const [agentId, projectId] = item.includes("::") ? item.split("::", 2) : item.split("/", 2);
      return { agentId, projectId: projectId || undefined };
    }).filter((scope) => Boolean(scope.agentId));
  const sensitiveReason = (content: string): string | null => sensitivePatterns.find((item) => item.pattern.test(content))?.id ?? null;
  const benchFailures = (report: Awaited<ReturnType<MemoryBenchRunner["latest"]>>): string[] => {
    if (!report) return ["no_latest_report"];
    const failures: string[] = [];
    if (report.status !== "complete") failures.push(`status:${report.status}`);
    if (report.cases < benchTargets.minCases) failures.push(`cases:${report.cases}<${benchTargets.minCases}`);
    if (report.recallAt5 < benchTargets.recallAt5) failures.push(`recallAt5:${report.recallAt5}<${benchTargets.recallAt5}`);
    if (report.injectionPrecision < benchTargets.injectionPrecision) failures.push(`injectionPrecision:${report.injectionPrecision}<${benchTargets.injectionPrecision}`);
    if (report.staleRate > benchTargets.staleRate) failures.push(`staleRate:${report.staleRate}>${benchTargets.staleRate}`);
    if (report.sourceCoverage < benchTargets.sourceCoverage) failures.push(`sourceCoverage:${report.sourceCoverage}<${benchTargets.sourceCoverage}`);
    if (report.p95LatencyMs > benchTargets.p95LatencyMs) failures.push(`p95LatencyMs:${report.p95LatencyMs}>${benchTargets.p95LatencyMs}`);
    return failures;
  };
  const fixtureScopes = (cases: MemoryBenchCase[]): Array<{ agentId: string; projectId?: string; cases: number }> => {
    const scopes = new Map<string, { agentId: string; projectId?: string; cases: number }>();
    for (const benchCase of cases) {
      const agentId = benchCase.agentId ?? "development";
      const projectId = benchCase.projectId;
      const key = scopeKey(agentId, projectId);
      const current = scopes.get(key) ?? { agentId, projectId, cases: 0 };
      current.cases++;
      scopes.set(key, current);
    }
    return [...scopes.values()].sort((a, b) => a.agentId.localeCompare(b.agentId) || (a.projectId ?? "").localeCompare(b.projectId ?? ""));
  };
  const collectRolloutScopes = async (opts: { agentIds?: string; projectIds?: string; agentId?: string; projectId?: string; scopes?: string }) => {
    const scopes = new Map<string, { agentId: string; projectId?: string }>();
    const requestedAgents = splitList(opts.agentIds);
    const requestedProjects = splitList(opts.projectIds);

    addScope(scopes, opts.agentId, opts.projectId);
    for (const scope of parseScopeList(opts.scopes)) addScope(scopes, scope.agentId, scope.projectId);
    for (const agentId of requestedAgents) {
      if (requestedProjects.length > 0) {
        for (const projectId of requestedProjects) addScope(scopes, agentId, projectId);
      } else {
        addScope(scopes, agentId);
      }
    }

    for (const override of await rolloutConfig.listOverrides()) {
      addScope(scopes, override.agentId, override.projectId);
    }

    const [candidates, auditEntries] = await Promise.all([
      atomicStore.listAll({ limit: 10_000 }),
      recallAudit.list({ limit: 10_000 }),
    ]);
    for (const candidate of candidates) addScope(scopes, candidate.agentId, candidate.projectId);
    for (const entry of auditEntries) addScope(scopes, entry.agentId, entry.projectId);

    return [...scopes.values()].sort((a, b) => a.agentId.localeCompare(b.agentId) || (a.projectId ?? "").localeCompare(b.projectId ?? ""));
  };
  const buildRolloutRows = async (scopes: Array<{ agentId: string; projectId?: string }>) => {
    const worker = consolidationWorker.status();
    return Promise.all(scopes.map(async (scope) => {
      const [effective, candidateStats, candidates, audits] = await Promise.all([
        rolloutConfig.resolveMode(scope.agentId, scope.projectId),
        atomicStore.stats({ agentId: scope.agentId, projectId: scope.projectId, limit: 10_000 }),
        atomicStore.listAll({ agentId: scope.agentId, projectId: scope.projectId, limit: 200 }),
        recallAudit.list({ agentId: scope.agentId, projectId: scope.projectId, limit: 50 }),
      ]);
      const sourceLessCandidates = candidates.filter((candidate) => candidate.sourceRefs.length === 0).length;
      const candidateSourceCoverage = candidates.length > 0 ? (candidates.length - sourceLessCandidates) / candidates.length : 1;
      const candidateQueueHealthy = candidateStats.byStatus.pending < 100 && candidateStats.byStatus.needs_review < 50;
      const modeAllowsV2Recall = isV2RecallReady(effective.mode);
      const recallAuditPresent = audits.length > 0;
      const warnings = [
        ...(!modeAllowsV2Recall && effective.mode !== "off" ? ["mode_not_v2_ready"] : []),
        ...(!candidateQueueHealthy ? ["candidate_queue_unhealthy"] : []),
        ...(candidateSourceCoverage < 0.98 ? ["candidate_source_refs_low"] : []),
        ...(modeAllowsV2Recall && !recallAuditPresent ? ["recall_audit_missing"] : []),
      ];
      const status = !candidateQueueHealthy || candidateSourceCoverage < 0.98 ? "fail" : warnings.length > 0 ? "warn" : "ready";
      return {
        ...effective,
        candidateStats,
        recallAudit: {
          count: audits.length,
          lastAt: audits[0]?.createdAt,
        },
        workerActive: worker.running && worker.agentId === scope.agentId && worker.projectId === scope.projectId,
        health: {
          status,
          warnings,
          candidateSourceCoverage,
          sourceLessCandidates,
          candidateQueueHealthy,
          modeAllowsV2Recall,
          recallAuditPresent,
        },
      };
    }));
  };
  const shouldAutoStartWorker = (): boolean => {
    const raw = process.env.MEMORY_FABRIC_CONSOLIDATION_WORKER?.toLowerCase();
    return raw === "auto" || raw === "on" || raw === "true" || raw === "1";
  };

  if (shouldAutoStartWorker()) {
    consolidationWorker.start({
      agentId: process.env.MEMORY_FABRIC_CONSOLIDATION_AGENT_ID,
      projectId: process.env.MEMORY_FABRIC_CONSOLIDATION_PROJECT_ID,
      intervalMs: parseOptionalNumber(process.env.MEMORY_FABRIC_CONSOLIDATION_INTERVAL_MS),
      limit: parseOptionalNumber(process.env.MEMORY_FABRIC_CONSOLIDATION_LIMIT),
    });
  }

  app.addHook("onClose", () => {
    consolidationWorker.stop();
  });

  // -------------------------------------------------------------------------
  // POST /v2/events — Append L0 evidence event
  // -------------------------------------------------------------------------
  app.post<{
    Body: {
      agentId: string;
      projectId?: string;
      sourceType: EventSourceType;
      sourceUri?: string;
      occurredAt?: string;
      summary?: string;
      content?: string;
      payload?: unknown;
      retention?: "standard" | "short" | "long";
    };
  }>(
    "/v2/events",
    {
      schema: {
        body: {
          type: "object",
          required: ["agentId", "sourceType"],
          properties: {
            agentId: { type: "string", minLength: 1 },
            projectId: { type: "string" },
            sourceType: { type: "string", enum: ["session", "message", "tool_call", "file", "diff", "attachment", "runtime", "error"] },
            sourceUri: { type: "string" },
            occurredAt: { type: "string" },
            summary: { type: "string" },
            content: { type: "string" },
            payload: {},
            retention: { type: "string", enum: ["standard", "short", "long"] },
          },
        },
      },
    },
    async (request) => {
      const event = await eventLedger.append(request.body);
      return { ok: true, event };
    }
  );

  app.get<{
    Querystring: { agentId?: string; projectId?: string; status?: string; limit?: number };
  }>("/v2/memories/candidates", async (request) => {
    const candidates = await atomicStore.listAll({
      agentId: request.query.agentId,
      projectId: request.query.projectId,
      statuses: parseStatuses(request.query.status),
      limit: Number(request.query.limit ?? 100),
    });
    return { ok: true, candidates, count: candidates.length };
  });

  app.get<{
    Querystring: { agentId?: string; projectId?: string; status?: string; limit?: number };
  }>("/v2/memories/candidates/stats", async (request) => {
    const stats = await atomicStore.stats({
      agentId: request.query.agentId,
      projectId: request.query.projectId,
      statuses: parseStatuses(request.query.status),
      limit: Number(request.query.limit ?? 10_000),
    });
    return { ok: true, stats };
  });

  app.post<{
    Body: { agentId?: string; projectId?: string; statuses?: AtomicMemoryCandidate["status"][]; limit?: number };
  }>("/v2/memories/candidates/retry", async (request) => {
    const candidates = await atomicStore.retry({
      agentId: request.body.agentId,
      projectId: request.body.projectId,
      statuses: request.body.statuses,
      limit: request.body.limit,
    });
    return { ok: true, candidates, count: candidates.length };
  });

  app.post<{
    Params: { id: string };
    Body: { agentId?: string; decision: "approve" | "reject"; reviewedBy?: string; reason?: string };
  }>("/v2/memories/candidates/:id/review", async (request) => {
    const candidate = await atomicStore.review({
      candidateId: request.params.id,
      agentId: request.body.agentId,
      decision: request.body.decision,
      reviewedBy: request.body.reviewedBy ?? "inspector",
      reason: request.body.reason,
    });
    if (!candidate) return { ok: false, error: "Candidate not found" };
    return { ok: true, candidate };
  });

  // -------------------------------------------------------------------------
  // POST /v2/memories/candidates — Write pending L1 candidates
  // -------------------------------------------------------------------------
  app.post<{
    Body: {
      agentId: string;
      projectId?: string;
      candidates: Array<{
        type?: string;
        content: string;
        sourceRefs?: string[];
        confidence?: number;
        tags?: string[];
      }>;
    };
  }>(
    "/v2/memories/candidates",
    {
      schema: {
        body: {
          type: "object",
          required: ["agentId", "candidates"],
          properties: {
            agentId: { type: "string", minLength: 1 },
            projectId: { type: "string" },
            candidates: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["content"],
                properties: {
                  type: { type: "string", enum: memoryTypes },
                  content: { type: "string", minLength: 1 },
                  sourceRefs: { type: "array", items: { type: "string" } },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  tags: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const candidates = [];
      for (const item of request.body.candidates) {
        candidates.push(
          await atomicStore.create({
            agentId: request.body.agentId,
            projectId: request.body.projectId,
            type: item.type as any,
            content: item.content,
            sourceRefs: item.sourceRefs,
            confidence: item.confidence,
            tags: item.tags,
          })
        );
      }
      return { ok: true, candidates, count: candidates.length };
    }
  );

  app.post<{
    Body: { intervalMs?: number; limit?: number; agentId?: string; projectId?: string };
  }>("/v2/consolidation/worker/start", async (request) => {
    const status = consolidationWorker.start(request.body ?? {});
    return { ok: true, status };
  });

  app.post("/v2/consolidation/worker/stop", async () => {
    const status = consolidationWorker.stop();
    return { ok: true, status };
  });

  app.get<{
    Querystring: { agentId?: string; projectId?: string };
  }>("/v2/consolidation/status", async (request) => {
    const stats = await atomicStore.stats({
      agentId: request.query.agentId,
      projectId: request.query.projectId,
      limit: 10_000,
    });
    return { ok: true, status: consolidationWorker.status(), candidateStats: stats };
  });

  // -------------------------------------------------------------------------
  // POST /v2/consolidation/run — Promote pending candidates
  // -------------------------------------------------------------------------
  app.post<{
    Body: { agentId: string; projectId?: string; limit?: number };
  }>(
    "/v2/consolidation/run",
    {
      schema: {
        body: {
          type: "object",
          required: ["agentId"],
          properties: {
            agentId: { type: "string", minLength: 1 },
            projectId: { type: "string" },
            limit: { type: "number", minimum: 1, maximum: 1000 },
          },
        },
      },
    },
    async (request) => {
      const result = await consolidator.run(request.body);
      return { ok: true, result };
    }
  );

  // -------------------------------------------------------------------------
  // POST /v2/recall/plan — Explain retrieval and return memory cards
  // -------------------------------------------------------------------------
  app.post<{
    Body: { query: string; agentId?: string; projectId?: string; scope?: "private" | "project" | "shared"; limit?: number };
  }>(
    "/v2/recall/plan",
    {
      schema: {
        body: {
          type: "object",
          required: ["query"],
          properties: {
            query: { type: "string", minLength: 1 },
            agentId: { type: "string" },
            projectId: { type: "string" },
            scope: { type: "string", enum: ["private", "project", "shared"] },
            limit: { type: "number", minimum: 1, maximum: 20 },
          },
        },
      },
    },
    async (request) => {
      const result = await retrievalPlanner.recall(request.body);
      return { ok: true, ...result };
    }
  );

  app.post<{
    Body: {
      agentId?: string;
      projectId?: string;
      query: string;
      mode: string;
      legacy?: {
        sourceCount?: number;
        budgetUsed?: number;
        memoryBriefChars?: number;
        sources?: string[];
        memoryBriefPreview?: string;
      };
      v2?: {
        intent?: string;
        cardCount?: number;
        evidenceCount?: number;
        renderedChars?: number;
        executionTimeMs?: number;
        memoryIds?: string[];
        evidenceRefs?: string[];
        cardPreviews?: string[];
      };
    };
  }>("/v2/recall/audit", async (request) => {
    const entry = await recallAudit.append(request.body);
    return { ok: true, entry };
  });

  app.get<{
    Querystring: { agentId?: string; projectId?: string; limit?: number };
  }>("/v2/recall/audit", async (request) => {
    const entries = await recallAudit.list({
      agentId: request.query.agentId,
      projectId: request.query.projectId,
      limit: Number(request.query.limit ?? 100),
    });
    return { ok: true, entries, count: entries.length };
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
            type: { type: "string", enum: memoryTypes },
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
  // GET /v2/memories/:id/trace — Source trace for a memory
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/v2/memories/:id/trace",
    async (request) => {
      const entry = await core.read(request.params.id);
      if (!entry) {
        return { ok: false, error: "Not found" };
      }
      const sourceRefs = entry.sourceRefs ?? [];
      const events = [];
      for (const ref of sourceRefs) {
        const agentEvents = await eventLedger.list({ agentId: entry.agentId, projectId: entry.projectId, limit: 500 });
        const event = agentEvents.find((item) => item.eventId === ref);
        if (event) events.push(event);
      }
      return {
        ok: true,
        memoryId: entry.id,
        status: entry.status ?? "active",
        sourceRefs,
        sources: entry.sources ?? [],
        events,
        relations: await relationGraph.list({ memoryId: entry.id, agentId: entry.agentId, projectId: entry.projectId, limit: 100 }),
      };
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

  app.get<{
    Querystring: { agentId?: string; projectId?: string };
  }>("/v2/rollout/effective", async (request) => {
    const agentId = request.query.agentId ?? "development";
    const effective = await rolloutConfig.resolveMode(agentId, request.query.projectId);
    return { ok: true, ...effective };
  });

  app.get<{
    Querystring: { agentIds?: string; projectIds?: string; scopes?: string; agentId?: string; projectId?: string };
  }>("/v2/rollout/modes", async (request) => {
    const scopes = await collectRolloutScopes(request.query);
    const rows = await buildRolloutRows(scopes.length > 0 ? scopes : [{ agentId: "development" }]);
    const overrides = await rolloutConfig.listOverrides();
    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      defaultMode: resolveV2ModeFromEnv(undefined).mode,
      modes: rows,
      overrides,
    };
  });

  app.post<{
    Body: { agentId: string; projectId?: string; mode: string; updatedBy?: string; reason?: string };
  }>(
    "/v2/rollout/modes",
    {
      schema: {
        body: {
          type: "object",
          required: ["agentId", "mode"],
          properties: {
            agentId: { type: "string", minLength: 1 },
            projectId: { type: "string" },
            mode: { type: "string", enum: rolloutModes },
            updatedBy: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
    },
    async (request) => {
      const effective = await rolloutConfig.setMode({
        agentId: request.body.agentId,
        projectId: request.body.projectId,
        mode: parseV2Mode(request.body.mode),
        updatedBy: request.body.updatedBy ?? "inspector",
        reason: request.body.reason,
      });
      return { ok: true, effective };
    }
  );

  app.post<{
    Body: { agentId: string; projectId?: string; updatedBy?: string; reason?: string };
  }>(
    "/v2/rollout/modes/rollback",
    {
      schema: {
        body: {
          type: "object",
          required: ["agentId"],
          properties: {
            agentId: { type: "string", minLength: 1 },
            projectId: { type: "string" },
            updatedBy: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
    },
    async (request) => {
      const effective = await rolloutConfig.rollback({
        agentId: request.body.agentId,
        projectId: request.body.projectId,
        updatedBy: request.body.updatedBy ?? "inspector",
        reason: request.body.reason,
      });
      return { ok: true, effective };
    }
  );

  app.get<{
    Querystring: { agentId?: string; projectId?: string };
  }>("/v2/gray/status", async (request) => {
    const agentId = request.query.agentId ?? "development";
    const projectId = request.query.projectId;
    const [candidateStats, latestBench, auditEntries] = await Promise.all([
      atomicStore.stats({ agentId, projectId, limit: 10_000 }),
      benchRunner.latest(),
      recallAudit.list({ agentId, projectId, limit: 50 }),
    ]);
    const v2CardCounts = auditEntries.map((entry) => entry.v2?.cardCount ?? 0);
    const v2EvidenceCounts = auditEntries.map((entry) => entry.v2?.evidenceCount ?? 0);
    const v2RenderedChars = auditEntries.map((entry) => entry.v2?.renderedChars ?? 0);
    const legacySourceCounts = auditEntries.map((entry) => entry.legacy?.sourceCount ?? 0);
    const legacyBriefChars = auditEntries.map((entry) => entry.legacy?.memoryBriefChars ?? 0);
    const avg = (values: number[]): number => values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const mode = (await rolloutConfig.resolveMode(agentId, projectId)).mode;

    return {
      ok: true,
      mode,
      agentId,
      projectId,
      worker: consolidationWorker.status(),
      candidateStats,
      recallAudit: {
        count: auditEntries.length,
        lastAt: auditEntries[0]?.createdAt,
        avgV2CardCount: avg(v2CardCounts),
        avgV2EvidenceCount: avg(v2EvidenceCounts),
        avgV2RenderedChars: avg(v2RenderedChars),
        avgLegacySourceCount: avg(legacySourceCounts),
        avgLegacyMemoryBriefChars: avg(legacyBriefChars),
      },
      bench: latestBench,
      readiness: {
        modeReady: isV2RecallReady(mode),
        sourceCoverageReady: latestBench ? latestBench.sourceCoverage >= 0.98 : false,
        latencyReady: latestBench ? latestBench.p95LatencyMs <= 300 : false,
        candidateQueueHealthy: candidateStats.byStatus.pending < 100 && candidateStats.byStatus.needs_review < 50,
      },
    };
  });

  app.get<{
    Querystring: {
      agentId?: string;
      projectId?: string;
      expectedMode?: string;
      maxPending?: string;
      maxNeedsReview?: string;
      minCandidateSourceCoverage?: string;
      maxP95LatencyMs?: string;
      candidateLimit?: string;
      auditLimit?: string;
    };
  }>("/v2/canary/status", async (request) => {
    const agentId = request.query.agentId ?? "product";
    const projectId = request.query.projectId ?? "Product";
    const mode = (await rolloutConfig.resolveMode(agentId, projectId)).mode;
    const expectedMode = request.query.expectedMode;
    const maxPending = parseNumberWithDefault(request.query.maxPending, 25);
    const maxNeedsReview = parseNumberWithDefault(request.query.maxNeedsReview, 10);
    const minCandidateSourceCoverage = parseNumberWithDefault(request.query.minCandidateSourceCoverage, 0.98);
    const maxP95LatencyMs = parseNumberWithDefault(request.query.maxP95LatencyMs, 300);
    const candidateLimit = parseNumberWithDefault(request.query.candidateLimit, 200);
    const auditLimit = parseNumberWithDefault(request.query.auditLimit, 50);

    const [candidateStats, candidates, latestBench, auditEntries] = await Promise.all([
      atomicStore.stats({ agentId, projectId, limit: 10_000 }),
      atomicStore.listAll({ agentId, projectId, limit: candidateLimit }),
      benchRunner.latest(),
      recallAudit.list({ agentId, projectId, limit: auditLimit }),
    ]);
    const worker = consolidationWorker.status();
    const candidatesWithSourceRefs = candidates.filter((candidate) => candidate.sourceRefs.length > 0).length;
    const candidateSourceCoverage = candidates.length > 0 ? candidatesWithSourceRefs / candidates.length : 1;
    const auditEvidenceCounts = auditEntries.map((entry) => entry.v2?.evidenceCount ?? 0);
    const auditCardCounts = auditEntries.map((entry) => entry.v2?.cardCount ?? 0);
    const auditLatencyValues = auditEntries
      .map((entry) => entry.v2?.executionTimeMs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const avg = (values: number[]): number => values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const checks: Array<{ id: string; status: "pass" | "warn" | "fail"; message: string; value?: unknown }> = [];

    checks.push({
      id: "mode",
      status: expectedMode ? (mode === expectedMode ? "pass" : "fail") : isV2RecallReady(mode) ? "pass" : "warn",
      message: expectedMode ? `mode should be ${expectedMode}` : "mode should allow v2 recall",
      value: mode,
    });
    checks.push({
      id: "worker_running",
      status: worker.running ? "pass" : "warn",
      message: "ConsolidationWorker should be running for v2-write canary",
      value: worker.running,
    });
    checks.push({
      id: "worker_scope",
      status:
        !worker.running || (worker.agentId === agentId && worker.projectId === projectId)
          ? "pass"
          : "fail",
      message: "ConsolidationWorker should target the canary agent/project",
      value: { agentId: worker.agentId, projectId: worker.projectId },
    });
    checks.push({
      id: "candidate_queue",
      status:
        candidateStats.byStatus.pending <= maxPending && candidateStats.byStatus.needs_review <= maxNeedsReview
          ? "pass"
          : "fail",
      message: "candidate queue should stay below canary thresholds",
      value: {
        pending: candidateStats.byStatus.pending,
        needsReview: candidateStats.byStatus.needs_review,
        maxPending,
        maxNeedsReview,
      },
    });
    checks.push({
      id: "candidate_source_refs",
      status: candidateSourceCoverage >= minCandidateSourceCoverage ? "pass" : "fail",
      message: "recent candidates should carry sourceRefs",
      value: {
        coverage: candidateSourceCoverage,
        checked: candidates.length,
        required: minCandidateSourceCoverage,
        sourceLessCandidateIds: candidates
          .filter((candidate) => candidate.sourceRefs.length === 0)
          .slice(0, 10)
          .map((candidate) => candidate.candidateId),
      },
    });
    checks.push({
      id: "recall_audit",
      status: auditEntries.length > 0 ? "pass" : "warn",
      message: "recall audit should appear after real v2 recall traffic",
      value: {
        count: auditEntries.length,
        avgV2CardCount: avg(auditCardCounts),
        avgV2EvidenceCount: avg(auditEvidenceCounts),
        avgV2ExecutionTimeMs: avg(auditLatencyValues),
      },
    });
    checks.push({
      id: "bench_latency",
      status: !latestBench ? "warn" : latestBench.p95LatencyMs <= maxP95LatencyMs ? "pass" : "fail",
      message: "latest bench P95 latency should stay below threshold when a bench exists",
      value: latestBench ? { p95LatencyMs: latestBench.p95LatencyMs, maxP95LatencyMs } : null,
    });
    checks.push({
      id: "bench_source_coverage",
      status: !latestBench ? "warn" : latestBench.sourceCoverage >= 0.98 ? "pass" : "fail",
      message: "latest bench source coverage should meet the rollout threshold when a bench exists",
      value: latestBench ? { sourceCoverage: latestBench.sourceCoverage, required: 0.98 } : null,
    });

    const hasFail = checks.some((check) => check.status === "fail");
    const hasWarn = checks.some((check) => check.status === "warn");

    return {
      ok: true,
      status: hasFail ? "fail" : hasWarn ? "warn" : "ready",
      mode,
      expectedMode,
      agentId,
      projectId,
      worker,
      candidateStats,
      candidateSourceCoverage,
      recallAudit: {
        count: auditEntries.length,
        lastAt: auditEntries[0]?.createdAt,
        avgV2CardCount: avg(auditCardCounts),
        avgV2EvidenceCount: avg(auditEvidenceCounts),
        avgV2ExecutionTimeMs: avg(auditLatencyValues),
      },
      bench: latestBench,
      checks,
    };
  });

  // -------------------------------------------------------------------------
  // GET /v2/carriers/drift — Audit carrier projection drift
  // -------------------------------------------------------------------------
  app.get<{
    Querystring: { agentId?: string; projectId?: string; limit?: number };
  }>("/v2/carriers/drift", async (request) => {
    if (!projection) {
      return { ok: false, error: "Carrier repository is not configured" };
    }
    if (!request.query.agentId) {
      return { ok: false, error: "agentId is required" };
    }
    const result = await core.query({
      agentId: request.query.agentId,
      projectId: request.query.projectId,
      includeExpired: false,
      limit: Math.max(1, Math.min(Number(request.query.limit ?? 100), 500)),
    });
    const report = await projection.audit({
      agentId: request.query.agentId,
      projectId: request.query.projectId,
      entries: result.entries,
    });
    return { ok: true, report };
  });

  app.post<{
    Body: { agentId: string; projectId?: string; memoryIds?: string[]; limit?: number };
  }>("/v2/carriers/projection/apply", async (request) => {
    if (!projection) {
      return { ok: false, error: "Carrier repository is not configured" };
    }
    const entries = request.body.memoryIds && request.body.memoryIds.length > 0
      ? (await Promise.all(request.body.memoryIds.map((id) => core.read(id)))).filter((entry): entry is MemoryEntryV2 => !!entry)
      : (await core.query({
          agentId: request.body.agentId,
          projectId: request.body.projectId,
          includeExpired: false,
          limit: Math.max(1, Math.min(Number(request.body.limit ?? 100), 500)),
        })).entries;
    const record = await projection.apply({
      agentId: request.body.agentId,
      projectId: request.body.projectId,
      entries,
    });
    return { ok: true, projection: record };
  });

  app.post<{
    Body: { projectionId: string };
  }>("/v2/carriers/projection/rollback", async (request) => {
    if (!projection) {
      return { ok: false, error: "Carrier repository is not configured" };
    }
    const record = await projection.rollback({ projectionId: request.body.projectionId });
    if (!record) return { ok: false, error: "Projection not found" };
    return { ok: true, projection: record };
  });

  app.get<{
    Querystring: { agentId?: string; projectId?: string; limit?: number };
  }>("/v2/carriers/projection/history", async (request) => {
    if (!projection) {
      return { ok: false, error: "Carrier repository is not configured" };
    }
    const history = await projection.history({
      agentId: request.query.agentId,
      projectId: request.query.projectId,
      limit: Number(request.query.limit ?? 50),
    });
    return { ok: true, history, count: history.length };
  });

  app.get("/v2/carriers/projection/policy", async () => {
    if (!projection) {
      return { ok: false, error: "Carrier repository is not configured" };
    }
    return { ok: true, policy: projection.policy() };
  });

  app.get<{
    Querystring: { agentId?: string; projectId?: string; type?: V2RelationType; memoryId?: string; limit?: number };
  }>("/v2/graph/relations", async (request) => {
    const type = relationTypes.includes(request.query.type as V2RelationType) ? request.query.type : undefined;
    const relations = await relationGraph.list({
      agentId: request.query.agentId,
      projectId: request.query.projectId,
      type,
      memoryId: request.query.memoryId,
      limit: Number(request.query.limit ?? 100),
    });
    return { ok: true, relations, count: relations.length };
  });

  app.get("/v2/context/health", async () => {
    const report = await contextHealth.report();
    return { ok: true, report };
  });

  app.get<{
    Querystring: { agentId?: string; projectId?: string; limit?: number };
  }>("/v2/ops/evidence-audit", async (request) => {
    const limit = Math.max(1, Math.min(Number(request.query.limit ?? 500), 2000));
    const result = await core.query({
      agentId: request.query.agentId,
      projectId: request.query.projectId,
      includeExpired: false,
      limit,
    });
    const sourceLess = result.entries.filter((entry) => (entry.sourceRefs?.length ?? 0) === 0 && (entry.sources?.length ?? 0) === 0);
    const sourceBacked = result.entries.length - sourceLess.length;
    const byType: Record<string, { total: number; sourceLess: number }> = {};
    for (const entry of result.entries) {
      byType[entry.type] ??= { total: 0, sourceLess: 0 };
      byType[entry.type].total++;
      if (sourceLess.includes(entry)) byType[entry.type].sourceLess++;
    }
    return {
      ok: true,
      agentId: request.query.agentId,
      projectId: request.query.projectId,
      checked: result.entries.length,
      sourceBacked,
      sourceLess: sourceLess.length,
      sourceCoverage: result.entries.length > 0 ? sourceBacked / result.entries.length : 1,
      byType,
      samples: sourceLess.slice(0, 20).map((entry) => ({
        memoryId: entry.id,
        agentId: entry.agentId,
        projectId: entry.projectId,
        type: entry.type,
        status: entry.status ?? "active",
        contentPreview: entry.content.slice(0, 120),
      })),
    };
  });

  app.get<{
    Querystring: { agentId?: string; projectId?: string; status?: string; limit?: number };
  }>("/v2/ops/sensitive-candidates", async (request) => {
    const candidates = await atomicStore.listAll({
      agentId: request.query.agentId,
      projectId: request.query.projectId,
      statuses: parseStatuses(request.query.status),
      limit: Number(request.query.limit ?? 10_000),
    });
    const matches = candidates
      .map((candidate) => ({ candidate, reason: sensitiveReason(candidate.content) }))
      .filter((item): item is { candidate: AtomicMemoryCandidate; reason: string } => !!item.reason);
    const byReason: Record<string, number> = {};
    const byStatus: Partial<Record<AtomicMemoryCandidate["status"], number>> = {};
    for (const match of matches) {
      byReason[match.reason] = (byReason[match.reason] ?? 0) + 1;
      byStatus[match.candidate.status] = (byStatus[match.candidate.status] ?? 0) + 1;
    }
    return {
      ok: true,
      checked: candidates.length,
      count: matches.length,
      byReason,
      byStatus,
      samples: matches.slice(0, 25).map((match) => ({
        candidateId: match.candidate.candidateId,
        agentId: match.candidate.agentId,
        projectId: match.candidate.projectId,
        status: match.candidate.status,
        type: match.candidate.type,
        reason: match.reason,
        promotedMemoryId: match.candidate.promotedMemoryId,
      })),
    };
  });

  app.post<{
    Body: { agentId?: string; projectId?: string; status?: string[]; limit?: number; deletePromotedMemories?: boolean };
  }>("/v2/ops/sensitive-candidates/reject", async (request) => {
    const statuses = request.body.status?.filter((item): item is AtomicMemoryCandidate["status"] =>
      candidateStatuses.includes(item as AtomicMemoryCandidate["status"])
    );
    const candidates = await atomicStore.listAll({
      agentId: request.body.agentId,
      projectId: request.body.projectId,
      statuses,
      limit: request.body.limit ?? 10_000,
    });
    let rejected = 0;
    let deletedMemories = 0;
    const affected: Array<{ candidateId: string; reason: string; promotedMemoryId?: string }> = [];
    for (const candidate of candidates) {
      const reason = sensitiveReason(candidate.content);
      if (!reason) continue;
      const updated = await atomicStore.review({
        candidateId: candidate.candidateId,
        agentId: candidate.agentId,
        decision: "reject",
        reviewedBy: "inspector",
        reason: `sensitive_candidate:${reason}`,
      });
      if (updated) rejected++;
      if (request.body.deletePromotedMemories && candidate.promotedMemoryId && await core.delete(candidate.promotedMemoryId)) {
        deletedMemories++;
      }
      affected.push({ candidateId: candidate.candidateId, reason, promotedMemoryId: candidate.promotedMemoryId });
    }
    return { ok: true, checked: candidates.length, rejected, deletedMemories, affected };
  });

  app.get("/v2/ops/acceptance/status", async () => {
    const freshCore = new MemoryCoreV2(cfg);
    const [fixtures, latestBench, fixtureCandidates, fixtureMemories] = await Promise.all([
      benchRunner.fixtures(),
      benchRunner.latest(),
      atomicStore.listAll({ limit: 10_000 }),
      freshCore.query({ tags: ["bench_fixture"], includeExpired: false, limit: 2000 }),
    ]);
    const benchFixtureCandidates = fixtureCandidates.filter((candidate) => candidate.tags.some((tag) => tag.startsWith("bench_fixture")));
    const promotedFixtureMemoryIds = new Set(
      benchFixtureCandidates
        .map((candidate) => candidate.promotedMemoryId)
        .filter((memoryId): memoryId is string => !!memoryId)
    );
    const failures = benchFailures(latestBench);
    return {
      ok: true,
      targets: benchTargets,
      ready: failures.length === 0,
      failures,
      latestReport: latestBench,
      fixtures: {
        source: fixtures.source,
        count: fixtures.count,
        scopes: fixtureScopes(fixtures.cases),
        sampleIds: fixtures.cases.slice(0, 20).map((benchCase) => benchCase.id),
      },
      seeded: {
        candidateCount: benchFixtureCandidates.length,
        memoryCount: Math.max(promotedFixtureMemoryIds.size, fixtureMemories.entries.length),
        promotedCandidates: benchFixtureCandidates.filter((candidate) => candidate.status === "promoted").length,
      },
    };
  });

  app.post<{
    Body: { seed?: boolean; limit?: number; caseTimeoutMs?: number; totalTimeoutMs?: number };
  }>("/v2/ops/acceptance/run", async (request, reply) => {
    try {
      const fixtures = await benchRunner.fixtures();
      const requestedLimit = request.body.limit ?? (fixtures.count > 0 ? fixtures.count : 50);
      const limit = Math.max(1, Math.min(Number(requestedLimit), 500));
      const seed = request.body.seed
        ? await benchSeeder.seed({
            cases: fixtures.cases,
            limit,
          })
        : undefined;
      const report = await benchRunner.run({
        useFixtures: true,
        limit,
        persist: true,
        caseTimeoutMs: request.body.caseTimeoutMs,
        totalTimeoutMs: request.body.totalTimeoutMs,
      });
      return { ok: true, seed, report, failures: benchFailures(report) };
    } catch (error) {
      if (error instanceof MemoryBenchAlreadyRunningError) {
        return reply.status(409).send({
          ok: false,
          error: error.message,
          activeRun: error.activeRun,
        });
      }
      throw error;
    }
  });

  app.post<{
    Body: { agentId?: string; projectId?: string; clearFixtures?: boolean; rejectCandidates?: boolean; deleteMemories?: boolean; limit?: number };
  }>("/v2/bench/fixtures/cleanup", async (request) => {
    const limit = Math.max(1, Math.min(Number(request.body.limit ?? 2000), 10_000));
    let memoryDeleted = 0;
    let candidatesRejected = 0;
    let fixturesCleared = false;
    const candidates = await atomicStore.listAll({
      agentId: request.body.agentId,
      projectId: request.body.projectId,
      limit,
    });
    const fixtureCandidates = candidates.filter((candidate) => candidate.tags.some((tag) => tag.startsWith("bench_fixture")));
    if (request.body.deleteMemories ?? true) {
      const freshCore = new MemoryCoreV2(cfg);
      const deletedMemoryIds = new Set<string>();
      for (const candidate of fixtureCandidates) {
        if (!candidate.promotedMemoryId || deletedMemoryIds.has(candidate.promotedMemoryId)) continue;
        if (await freshCore.delete(candidate.promotedMemoryId)) {
          deletedMemoryIds.add(candidate.promotedMemoryId);
          memoryDeleted++;
        }
      }
      const entries = await freshCore.query({
        agentId: request.body.agentId,
        projectId: request.body.projectId,
        tags: ["bench_fixture"],
        includeExpired: false,
        limit,
      });
      for (const entry of entries.entries) {
        if (deletedMemoryIds.has(entry.id)) continue;
        if (await freshCore.delete(entry.id)) memoryDeleted++;
      }
    }
    if (request.body.rejectCandidates ?? true) {
      for (const candidate of fixtureCandidates) {
        const updated = await atomicStore.review({
          candidateId: candidate.candidateId,
          agentId: candidate.agentId,
          decision: "reject",
          reviewedBy: "inspector",
          reason: "bench_fixture_cleanup",
        });
        if (updated) candidatesRejected++;
      }
    }
    if (request.body.clearFixtures) {
      await benchRunner.saveFixtures({ cases: [], mode: "replace" });
      fixturesCleared = true;
    }
    return { ok: true, memoryDeleted, candidatesRejected, fixturesCleared };
  });

  // -------------------------------------------------------------------------
  // POST /v2/bench/run — Run Memory Bench v0
  // -------------------------------------------------------------------------
  app.post<{
    Body: MemoryBenchRunOptions;
  }>("/v2/bench/run", async (request, reply) => {
    try {
      const report = await benchRunner.run(request.body ?? {});
      return { ok: true, report };
    } catch (error) {
      if (error instanceof MemoryBenchAlreadyRunningError) {
        return reply.status(409).send({
          ok: false,
          error: error.message,
          activeRun: error.activeRun,
        });
      }
      throw error;
    }
  });

  app.get("/v2/bench/status", async () => {
    const status = await benchRunner.status();
    return { ok: true, ...status };
  });

  app.get("/v2/bench/report", async () => {
    const report = await benchRunner.latest();
    return { ok: true, report };
  });

  app.get("/v2/bench/fixtures", async () => {
    const fixtures = await benchRunner.fixtures();
    return { ok: true, ...fixtures };
  });

  app.post<{
    Body: { cases: MemoryBenchCase[]; mode?: "replace" | "append" };
  }>("/v2/bench/fixtures", async (request) => {
    const fixtures = await benchRunner.saveFixtures({
      cases: request.body.cases,
      mode: request.body.mode ?? "replace",
    });
    return { ok: true, ...fixtures };
  });

  app.post<{
    Body: { agentId?: string; projectId?: string; cases?: MemoryBenchCase[]; limit?: number; useFixtures?: boolean };
  }>("/v2/bench/seed", async (request) => {
    const persistedFixtures = request.body?.useFixtures ? await benchRunner.fixtures() : undefined;
    const result = await benchSeeder.seed({
      ...(request.body ?? {}),
      cases: request.body?.cases ?? persistedFixtures?.cases,
    });
    return { ok: true, result };
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
