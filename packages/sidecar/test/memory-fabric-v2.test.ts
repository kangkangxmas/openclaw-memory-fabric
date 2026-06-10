import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import Fastify from "fastify";
import { describe, it, expect, beforeEach, afterEach } from "./test-helpers.js";
import type { SidecarConfig } from "../src/config/index.js";
import { AtomicMemoryStore } from "../src/services/atomic-memory-store.js";
import { EventLedgerService } from "../src/services/event-ledger-service.js";
import { MemoryConsolidator } from "../src/services/memory-consolidator.js";
import { MemoryCoreV2 } from "../src/core/memory-core-v2.js";
import { RetrievalPlanner } from "../src/services/retrieval-planner.js";
import { CarrierRepository } from "../src/services/carrier-service.js";
import { registerV2Routes } from "../src/routes/v2.js";

describe("Memory Fabric V2", () => {
  let tmpRoot: string;
  let cfg: SidecarConfig["openviking"];

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "memory-fabric-v2-"));
    cfg = {
      mode: "local",
      basePath: join(tmpRoot, "openviking"),
      targetRoot: "viking://org/test",
    };
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("keeps source-less candidates in review and appends stable L0 events", async () => {
    const ledger = new EventLedgerService(cfg);
    const candidates = new AtomicMemoryStore(cfg);

    const event = await ledger.append({
      agentId: "agent-1",
      projectId: "project-1",
      sourceType: "message",
      content: "用户明确要求 Memory Fabric v2 不引入 Hy-Memory 运行时依赖。",
    });
    const missingSource = await candidates.create({
      agentId: "agent-1",
      projectId: "project-1",
      content: "这条候选没有 sourceRefs，不能进入稳定库。",
    });

    expect(event.eventId).toMatch(/^evt_/);
    expect(event.contentHash).toMatch(/^sha256:/);
    expect(missingSource.status).toBe("needs_review");
    expect(missingSource.reviewReason).toBe("missing_source_refs");

    const events = await ledger.list({ agentId: "agent-1", projectId: "project-1" });
    expect(events).toHaveLength(1);
    expect(events[0].eventId).toBe(event.eventId);
  });

  it("promotes sourced candidates and returns evidence-backed memory cards", async () => {
    const ledger = new EventLedgerService(cfg);
    const candidateStore = new AtomicMemoryStore(cfg);
    const consolidator = new MemoryConsolidator(cfg, candidateStore);
    const core = new MemoryCoreV2(cfg);
    const planner = new RetrievalPlanner(core);

    const event = await ledger.append({
      agentId: "development",
      projectId: "openclaw",
      sourceType: "session",
      summary: "v2 route decision",
      content: "Memory Fabric v2 决定自研，不引入 Hy-Memory 运行时依赖，并保留 shadow 双写回滚路径。",
    });
    await candidateStore.create({
      agentId: "development",
      projectId: "openclaw",
      type: "decision",
      content: "Memory Fabric v2 决定自研，不引入 Hy-Memory 运行时依赖，并保留 shadow 双写回滚路径。",
      sourceRefs: [event.eventId],
      confidence: 0.9,
    });

    const consolidated = await consolidator.run({ agentId: "development", projectId: "openclaw" });
    const recall = await planner.recall({
      agentId: "development",
      projectId: "openclaw",
      query: "为什么 Memory Fabric v2 不直接接入 Hy-Memory",
      limit: 5,
    });

    expect(consolidated.promoted).toBe(1);
    expect(recall.plan.intent).toBe("decision_history");
    expect(recall.cards.length).toBeGreaterThan(0);
    expect(recall.cards[0].evidence).toContain(event.eventId);
    expect(recall.rendered).toContain("Memory Cards");
  });

  it("marks similar older memories as superseded and excludes them from default recall", async () => {
    const ledger = new EventLedgerService(cfg);
    const candidateStore = new AtomicMemoryStore(cfg);
    const consolidator = new MemoryConsolidator(cfg, candidateStore);
    const core = new MemoryCoreV2(cfg);

    const old = await core.create({
      agentId: "development",
      projectId: "openclaw",
      scope: "project",
      type: "decision",
      content: "Memory Fabric v2 uses shadow write before switching primary path",
      sourceRefs: ["evt-old"],
      quality: { specificity: 0.8, actionability: 0.8, stability: 0.8, sourceCoverage: 1 },
    });
    const event = await ledger.append({
      agentId: "development",
      projectId: "openclaw",
      sourceType: "session",
      content: "Memory Fabric v2 uses shadow write before switching the primary path",
    });
    await candidateStore.create({
      agentId: "development",
      projectId: "openclaw",
      type: "decision",
      content: "Memory Fabric v2 uses shadow write before switching the primary path",
      sourceRefs: [event.eventId],
      confidence: 0.9,
    });

    const result = await consolidator.run({ agentId: "development", projectId: "openclaw" });
    const freshCore = new MemoryCoreV2(cfg);
    const superseded = await freshCore.read(old.id);
    const recalled = await freshCore.query({
      agentId: "development",
      projectId: "openclaw",
      text: "shadow write",
      includeExpired: false,
    });

    expect(result.superseded).toBe(1);
    expect(superseded?.status).toBe("superseded");
    expect(superseded?.validUntil).not.toBeNull();
    expect(recalled.entries.some((entry) => entry.id === old.id)).toBe(false);
    expect(recalled.entries.some((entry) => entry.supersedes?.includes(old.id))).toBe(true);
  });

  it("requires explicit or multi-source evidence before promoting profile and intent memories", async () => {
    const ledger = new EventLedgerService(cfg);
    const candidateStore = new AtomicMemoryStore(cfg);
    const consolidator = new MemoryConsolidator(cfg, candidateStore);
    const event = await ledger.append({
      agentId: "development",
      sourceType: "message",
      content: "The agent may prefer concise planning.",
    });

    await candidateStore.create({
      agentId: "development",
      type: "intent",
      content: "The user wants concise planning by default.",
      sourceRefs: [event.eventId],
      confidence: 0.9,
    });
    const blocked = await consolidator.run({ agentId: "development" });

    expect(blocked.promoted).toBe(0);
    expect(blocked.needsReview).toBe(1);
    expect(blocked.entries[0].reason).toBe("profile_intent_requires_explicit_or_multi_source");

    const blockedCandidate = (await candidateStore.list({
      agentId: "development",
      statuses: ["needs_review"],
      limit: 1,
    }))[0];
    const approved = await candidateStore.review({
      candidateId: blockedCandidate.candidateId,
      agentId: "development",
      decision: "approve",
      reviewedBy: "test",
    });
    const promoted = await consolidator.run({ agentId: "development" });

    expect(approved?.tags).toContain("manual_review_approved");
    expect(promoted.promoted).toBe(1);
  });

  it("exposes v2 evidence, consolidation, trace, drift, and bench routes", async () => {
    const app = Fastify({ logger: false });
    const carriers = new CarrierRepository(join(tmpRoot, "carriers"));
    registerV2Routes(app, cfg, carriers);
    await app.ready();

    const eventRes = await app.inject({
      method: "POST",
      url: "/v2/events",
      payload: {
        agentId: "development",
        projectId: "openclaw",
        sourceType: "session",
        content: "Memory Fabric v2 决定自研，不引入 Hy-Memory 运行时依赖。",
      },
    });
    const eventBody = JSON.parse(eventRes.body);
    const eventId = eventBody.event.eventId as string;

    const candidateRes = await app.inject({
      method: "POST",
      url: "/v2/memories/candidates",
      payload: {
        agentId: "development",
        projectId: "openclaw",
        candidates: [
          {
            type: "decision",
            content: "Memory Fabric v2 决定自研，不引入 Hy-Memory 运行时依赖。",
            sourceRefs: [eventId],
            confidence: 0.9,
          },
        ],
      },
    });
    expect(candidateRes.statusCode).toBe(200);
    const candidateBody = JSON.parse(candidateRes.body);
    expect(candidateBody.candidates[0].status).toBe("pending");

    await app.inject({
      method: "POST",
      url: "/v2/memories/candidates",
      payload: {
        agentId: "development",
        projectId: "openclaw",
        candidates: [
          {
            type: "intent",
            content: "This source-less candidate should remain review-only.",
            confidence: 0.9,
          },
        ],
      },
    });

    const candidateListRes = await app.inject({
      method: "GET",
      url: "/v2/memories/candidates?agentId=development&projectId=openclaw",
    });
    const candidateListBody = JSON.parse(candidateListRes.body);
    expect(candidateListBody.count).toBe(2);

    const reviewRes = await app.inject({
      method: "POST",
      url: `/v2/memories/candidates/${candidateListBody.candidates[1].candidateId}/review`,
      payload: { agentId: "development", decision: "reject", reviewedBy: "test" },
    });
    const reviewBody = JSON.parse(reviewRes.body);
    expect(reviewBody.candidate.status).toBe("rejected");

    const workerStartRes = await app.inject({
      method: "POST",
      url: "/v2/consolidation/worker/start",
      payload: { agentId: "development", projectId: "openclaw", intervalMs: 60_000 },
    });
    const workerStartBody = JSON.parse(workerStartRes.body);
    expect(workerStartBody.status.running).toBe(true);

    const statusRes = await app.inject({
      method: "GET",
      url: "/v2/consolidation/status?agentId=development&projectId=openclaw",
    });
    const statusBody = JSON.parse(statusRes.body);
    expect(statusBody.candidateStats.total).toBe(2);

    const consolidationRes = await app.inject({
      method: "POST",
      url: "/v2/consolidation/run",
      payload: { agentId: "development", projectId: "openclaw" },
    });
    const consolidationBody = JSON.parse(consolidationRes.body);
    const memoryId = consolidationBody.result.entries[0].memoryId as string;

    const recallRes = await app.inject({
      method: "POST",
      url: "/v2/recall/plan",
      payload: {
        agentId: "development",
        projectId: "openclaw",
        query: "为什么 Memory Fabric v2 不直接接入 Hy-Memory",
        limit: 5,
      },
    });
    const recallBody = JSON.parse(recallRes.body);
    expect(recallBody.plan.intent).toBe("decision_history");
    expect(recallBody.cards.length).toBeGreaterThan(0);

    const traceRes = await app.inject({ method: "GET", url: `/v2/memories/${memoryId}/trace` });
    const traceBody = JSON.parse(traceRes.body);
    expect(traceBody.sourceRefs).toContain(eventId);
    expect(traceBody.events).toHaveLength(1);
    expect(traceBody.relations.length).toBeGreaterThan(0);

    const relationsRes = await app.inject({
      method: "GET",
      url: "/v2/graph/relations?agentId=development&projectId=openclaw",
    });
    const relationsBody = JSON.parse(relationsRes.body);
    expect(relationsBody.relations.some((relation: { type: string }) => relation.type === "VALIDATES")).toBe(true);

    const driftRes = await app.inject({
      method: "GET",
      url: "/v2/carriers/drift?agentId=development&projectId=openclaw",
    });
    const driftBody = JSON.parse(driftRes.body);
    expect(driftBody.report.projectionVersion).toBe("v2.0");
    expect(driftBody.report.issues.length).toBeGreaterThan(0);

    const applyRes = await app.inject({
      method: "POST",
      url: "/v2/carriers/projection/apply",
      payload: { agentId: "development", projectId: "openclaw" },
    });
    const applyBody = JSON.parse(applyRes.body);
    expect(applyBody.projection.status).toBe("applied");
    expect(applyBody.projection.merged).toContain("decision-log.md");

    const rollbackRes = await app.inject({
      method: "POST",
      url: "/v2/carriers/projection/rollback",
      payload: { projectionId: applyBody.projection.projectionId },
    });
    const rollbackBody = JSON.parse(rollbackRes.body);
    expect(rollbackBody.projection.status).toBe("rolled_back");

    const benchRes = await app.inject({
      method: "POST",
      url: "/v2/bench/run",
      payload: {
        cases: [
          {
            id: "decision-route",
            agentId: "development",
            projectId: "openclaw",
            query: "Hy-Memory 运行时依赖",
            expectedTerms: ["Hy-Memory"],
          },
        ],
      },
    });
    const benchBody = JSON.parse(benchRes.body);
    expect(benchBody.report.cases).toBe(1);
    expect(benchBody.report.recallAt5).toBeGreaterThanOrEqual(0);

    const latestBenchRes = await app.inject({ method: "GET", url: "/v2/bench/report" });
    const latestBenchBody = JSON.parse(latestBenchRes.body);
    expect(latestBenchBody.report.cases).toBe(1);

    const seedRes = await app.inject({
      method: "POST",
      url: "/v2/bench/seed",
      payload: {
        agentId: "development",
        projectId: "openclaw",
        cases: [
          {
            id: "seeded-bench-case",
            agentId: "development",
            projectId: "openclaw",
            query: "seeded bench fixture",
            expectedTerms: ["seeded", "fixture"],
          },
        ],
      },
    });
    const seedBody = JSON.parse(seedRes.body);
    expect(seedBody.result.requested).toBe(1);
    expect(seedBody.result.promoted).toBe(1);

    const seedAgainRes = await app.inject({
      method: "POST",
      url: "/v2/bench/seed",
      payload: {
        agentId: "development",
        projectId: "openclaw",
        cases: [
          {
            id: "seeded-bench-case",
            agentId: "development",
            projectId: "openclaw",
            query: "seeded bench fixture",
            expectedTerms: ["seeded", "fixture"],
          },
        ],
      },
    });
    const seedAgainBody = JSON.parse(seedAgainRes.body);
    expect(seedAgainBody.result.skippedExisting).toBe(1);

    const grayStatusRes = await app.inject({
      method: "GET",
      url: "/v2/gray/status?agentId=development&projectId=openclaw",
    });
    const grayStatusBody = JSON.parse(grayStatusRes.body);
    expect(grayStatusBody.mode).toBe("shadow");
    expect(grayStatusBody.candidateStats.total).toBeGreaterThan(0);
    expect(grayStatusBody.readiness.candidateQueueHealthy).toBe(true);

    const auditRes = await app.inject({
      method: "POST",
      url: "/v2/recall/audit",
      payload: {
        agentId: "development",
        projectId: "openclaw",
        query: "Hy-Memory 运行时依赖",
        mode: "v2-recall",
        v2: { intent: "decision_history", cardCount: 1 },
      },
    });
    expect(auditRes.statusCode).toBe(200);

    const auditListRes = await app.inject({
      method: "GET",
      url: "/v2/recall/audit?agentId=development&projectId=openclaw",
    });
    const auditListBody = JSON.parse(auditListRes.body);
    expect(auditListBody.count).toBe(1);

    const workerStopRes = await app.inject({ method: "POST", url: "/v2/consolidation/worker/stop", payload: {} });
    const workerStopBody = JSON.parse(workerStopRes.body);
    expect(workerStopBody.status.running).toBe(false);

    await app.close();
  });
});
