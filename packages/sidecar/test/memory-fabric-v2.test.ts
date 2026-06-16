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
import { CarrierProjectionEngine } from "../src/services/carrier-projection-engine.js";
import { OpenVikingService } from "../src/services/openviking-service.js";
import { registerCommitRoute } from "../src/routes/commit.js";
import { registerV2Routes } from "../src/routes/v2.js";

async function waitForCandidates(
  store: AtomicMemoryStore,
  opts: { agentId: string; projectId?: string; expectedContent: string; timeoutMs?: number }
) {
  const deadline = Date.now() + (opts.timeoutMs ?? 1000);
  let latest = await store.listAll({ agentId: opts.agentId, projectId: opts.projectId, limit: 100 });
  while (Date.now() < deadline) {
    latest = await store.listAll({ agentId: opts.agentId, projectId: opts.projectId, limit: 100 });
    if (latest.some((candidate) => candidate.content === opts.expectedContent)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return latest;
}

const v2ModeEnvKeys = [
  "MEMORY_FABRIC_V2_MODE",
  "MEMORY_FABRIC_V2_OFF_AGENT_IDS",
  "MEMORY_FABRIC_V2_SHADOW_AGENT_IDS",
  "MEMORY_FABRIC_V2_RECALL_AGENT_IDS",
  "MEMORY_FABRIC_V2_WRITE_AGENT_IDS",
] as const;

function snapshotEnv(keys: readonly string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

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
    const distractorEvent = await ledger.append({
      agentId: "development",
      projectId: "openclaw",
      sourceType: "session",
      summary: "v2 card injection decision",
      content: "before_prompt_build 只注入 memory cards，不再直接注入大段 Carrier。",
    });
    await candidateStore.create({
      agentId: "development",
      projectId: "openclaw",
      type: "decision",
      content: "before_prompt_build 只注入 memory cards，不再直接注入大段 Carrier。",
      sourceRefs: [distractorEvent.eventId],
      confidence: 0.9,
    });
    await core.create({
      agentId: "development",
      projectId: "openclaw",
      scope: "project",
      type: "decision",
      content: "Memory Fabric v2 source-less legacy Hy-Memory memory should not become a v2 card.",
      quality: { specificity: 1, actionability: 1, stability: 1, sourceCoverage: 0 },
    });

    const preConsolidationRecall = await planner.recall({
      agentId: "development",
      projectId: "openclaw",
      query: "为什么 Memory Fabric v2 不直接接入 Hy-Memory",
      limit: 5,
    });
    const consolidated = await consolidator.run({ agentId: "development", projectId: "openclaw" });
    const recall = await planner.recall({
      agentId: "development",
      projectId: "openclaw",
      query: "为什么 Memory Fabric v2 不直接接入 Hy-Memory",
      limit: 5,
    });

    expect(preConsolidationRecall.cards).toHaveLength(0);
    expect(consolidated.promoted).toBe(2);
    expect(recall.plan.intent).toBe("decision_history");
    expect(recall.cards.length).toBeGreaterThan(0);
    expect(recall.cards.every((card) => card.evidence.length > 0)).toBe(true);
    expect(recall.cards[0].evidence).toContain(event.eventId);
    expect(recall.cards[0].content).toContain("Hy-Memory");
    expect(recall.cards.some((card) => card.content.includes("source-less legacy"))).toBe(false);
    expect(recall.cards.some((card) => card.evidence.includes(distractorEvent.eventId))).toBe(false);
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

  it("enforces carrier projection ownership before applying direct patches", async () => {
    const carriers = new CarrierRepository(join(tmpRoot, "carriers"));
    const projection = new CarrierProjectionEngine(carriers, cfg);

    const blocked = await projection.apply({
      agentId: "development",
      projectId: "openclaw",
      patches: [
        {
          filename: "self-model.md",
          content: "# Self Model\n\n## Understood\n- unowned profile write\n",
        },
        {
          filename: "unknown.md",
          content: "<!-- memory-fabric projection:v2.0 memory:mem-x -->\nunknown",
        },
      ],
    });

    expect(blocked.merged).toEqual([]);
    expect(blocked.skipped).toContain("self-model.md (missing memory-fabric projection marker)");
    expect(blocked.skipped).toContain("unknown.md (outside projection schema whitelist)");

    const core = new MemoryCoreV2(cfg);
    const memory = await core.create({
      agentId: "development",
      projectId: "openclaw",
      scope: "project",
      type: "profile",
      content: "The development agent should prefer evidence-backed memory cards.",
      sourceRefs: ["evt-profile"],
      quality: { specificity: 0.9, actionability: 0.85, stability: 0.85, sourceCoverage: 1 },
    });
    const applied = await projection.apply({
      agentId: "development",
      projectId: "openclaw",
      entries: [memory],
    });
    const [selfModel] = await carriers.read({
      agentId: "development",
      projectId: "openclaw",
      files: ["self-model.md"],
    });

    expect(applied.merged).toContain("self-model.md");
    expect(selfModel.content).toContain("The development agent should prefer evidence-backed memory cards.");
    expect(selfModel.content).toContain(`memory:${memory.id}`);
  });

  it("auto-starts the consolidation worker when configured by env", async () => {
    const previous = {
      worker: process.env.MEMORY_FABRIC_CONSOLIDATION_WORKER,
      agentId: process.env.MEMORY_FABRIC_CONSOLIDATION_AGENT_ID,
      projectId: process.env.MEMORY_FABRIC_CONSOLIDATION_PROJECT_ID,
      intervalMs: process.env.MEMORY_FABRIC_CONSOLIDATION_INTERVAL_MS,
      limit: process.env.MEMORY_FABRIC_CONSOLIDATION_LIMIT,
    };
    process.env.MEMORY_FABRIC_CONSOLIDATION_WORKER = "auto";
    process.env.MEMORY_FABRIC_CONSOLIDATION_AGENT_ID = "development";
    process.env.MEMORY_FABRIC_CONSOLIDATION_PROJECT_ID = "openclaw";
    process.env.MEMORY_FABRIC_CONSOLIDATION_INTERVAL_MS = "1500";
    process.env.MEMORY_FABRIC_CONSOLIDATION_LIMIT = "7";

    const app = Fastify({ logger: false });
    try {
      registerV2Routes(app, cfg);
      await app.ready();
      const statusRes = await app.inject({
        method: "GET",
        url: "/v2/consolidation/status?agentId=development&projectId=openclaw",
      });
      const statusBody = JSON.parse(statusRes.body);

      expect(statusBody.status.running).toBe(true);
      expect(statusBody.status.agentId).toBe("development");
      expect(statusBody.status.projectId).toBe("openclaw");
      expect(statusBody.status.intervalMs).toBe(1500);
      expect(statusBody.status.limit).toBe(7);
    } finally {
      await app.close();
      if (previous.worker === undefined) delete process.env.MEMORY_FABRIC_CONSOLIDATION_WORKER;
      else process.env.MEMORY_FABRIC_CONSOLIDATION_WORKER = previous.worker;
      if (previous.agentId === undefined) delete process.env.MEMORY_FABRIC_CONSOLIDATION_AGENT_ID;
      else process.env.MEMORY_FABRIC_CONSOLIDATION_AGENT_ID = previous.agentId;
      if (previous.projectId === undefined) delete process.env.MEMORY_FABRIC_CONSOLIDATION_PROJECT_ID;
      else process.env.MEMORY_FABRIC_CONSOLIDATION_PROJECT_ID = previous.projectId;
      if (previous.intervalMs === undefined) delete process.env.MEMORY_FABRIC_CONSOLIDATION_INTERVAL_MS;
      else process.env.MEMORY_FABRIC_CONSOLIDATION_INTERVAL_MS = previous.intervalMs;
      if (previous.limit === undefined) delete process.env.MEMORY_FABRIC_CONSOLIDATION_LIMIT;
      else process.env.MEMORY_FABRIC_CONSOLIDATION_LIMIT = previous.limit;
    }
  });

  it("exposes commit mode preflight status for off, shadow, v2-recall, and v2-write", async () => {
    const previousEnv = snapshotEnv(v2ModeEnvKeys);
    const modes = ["off", "shadow", "v2-recall", "v2-write"] as const;

    try {
      delete process.env.MEMORY_FABRIC_V2_OFF_AGENT_IDS;
      delete process.env.MEMORY_FABRIC_V2_SHADOW_AGENT_IDS;
      delete process.env.MEMORY_FABRIC_V2_RECALL_AGENT_IDS;
      delete process.env.MEMORY_FABRIC_V2_WRITE_AGENT_IDS;

      for (const mode of modes) {
        process.env.MEMORY_FABRIC_V2_MODE = mode;
        const modeRoot = await mkdtemp(join(tmpRoot, `commit-${mode}-`));
        const modeCfg = {
          mode: "local" as const,
          basePath: join(modeRoot, "openviking"),
          targetRoot: "viking://org/test",
        };
        const openviking = new OpenVikingService(modeCfg);
        const ledger = new EventLedgerService(modeCfg);
        const candidates = new AtomicMemoryStore(modeCfg);
        const app = Fastify({ logger: false });
        registerCommitRoute(app, openviking, undefined, ledger, candidates);
        await app.ready();

        const fact = `commit preflight ${mode} fact`;
        const decision = `commit preflight ${mode} decision`;
        const res = await app.inject({
          method: "POST",
          url: "/commit",
          payload: {
            agentId: "development",
            projectId: "openclaw",
            facts: [fact],
            decisions: [decision],
            sessionSummary: `commit preflight ${mode}`,
          },
        });
        const body = JSON.parse(res.body);

        expect(res.statusCode).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.committed).toBe(2);
        expect(body.v2.mode).toBe(mode);

        if (mode === "off") {
          expect(body.v2.status).toBe("off");
          expect((await candidates.listAll({ agentId: "development", projectId: "openclaw" }))).toHaveLength(0);
        } else {
          if (mode === "v2-write") {
            expect(body.v2.status).toBe("written");
            expect(body.v2.candidateCount).toBe(2);
            expect(body.v2.sourceRefs).toEqual([body.v2.eventId]);
          } else {
            expect(body.v2.status).toBe("queued");
          }

          const writtenCandidates = await waitForCandidates(candidates, {
            agentId: "development",
            projectId: "openclaw",
            expectedContent: fact,
          });
          expect(writtenCandidates).toHaveLength(2);
          expect(writtenCandidates.every((candidate) => candidate.sourceRefs.length === 1)).toBe(true);
        }

        const recall = await openviking.recallMemory({
          agentId: "development",
          projectId: "openclaw",
          scope: "project",
          query: decision,
        });
        expect(recall.memoryBrief).toContain(decision);
        await app.close();
      }
    } finally {
      restoreEnv(previousEnv);
    }
  });

  it("allows per-agent v2-write canary while keeping the global mode on v2-recall", async () => {
    const previousEnv = snapshotEnv(v2ModeEnvKeys);
    const modeRoot = await mkdtemp(join(tmpRoot, "commit-agent-canary-"));
    const modeCfg = {
      mode: "local" as const,
      basePath: join(modeRoot, "openviking"),
      targetRoot: "viking://org/test",
    };
    const openviking = new OpenVikingService(modeCfg);
    const ledger = new EventLedgerService(modeCfg);
    const candidates = new AtomicMemoryStore(modeCfg);
    const app = Fastify({ logger: false });

    try {
      process.env.MEMORY_FABRIC_V2_MODE = "v2-recall";
      delete process.env.MEMORY_FABRIC_V2_OFF_AGENT_IDS;
      delete process.env.MEMORY_FABRIC_V2_SHADOW_AGENT_IDS;
      delete process.env.MEMORY_FABRIC_V2_RECALL_AGENT_IDS;
      process.env.MEMORY_FABRIC_V2_WRITE_AGENT_IDS = "product";

      registerCommitRoute(app, openviking, undefined, ledger, candidates);
      registerV2Routes(app, modeCfg);
      await app.ready();

      const productFact = "product canary fact writes v2 first";
      const productRes = await app.inject({
        method: "POST",
        url: "/commit",
        payload: {
          agentId: "product",
          projectId: "Product",
          facts: [productFact],
          decisions: ["product canary decision keeps legacy fallback"],
        },
      });
      const productBody = JSON.parse(productRes.body);

      expect(productRes.statusCode).toBe(200);
      expect(productBody.v2.mode).toBe("v2-write");
      expect(productBody.v2.status).toBe("written");
      expect(productBody.v2.legacyStatus).toBe("written");
      expect(productBody.v2.sourceRefs).toEqual([productBody.v2.eventId]);
      const productCandidates = await waitForCandidates(candidates, {
        agentId: "product",
        projectId: "Product",
        expectedContent: productFact,
      });
      expect(productCandidates).toHaveLength(2);

      const consolidator = new MemoryConsolidator(modeCfg, candidates);
      const consolidated = await consolidator.run({ agentId: "product", projectId: "Product" });
      expect(consolidated.promoted).toBe(2);

      const promotedCandidates = await candidates.listAll({ agentId: "product", projectId: "Product" });
      expect(promotedCandidates.every((candidate) => candidate.status === "promoted")).toBe(true);
      expect(promotedCandidates.every((candidate) => candidate.reviewReason?.startsWith("merged_duplicate:"))).toBe(true);

      const core = new MemoryCoreV2(modeCfg);
      const promotedMemory = await core.read(promotedCandidates[0].promotedMemoryId ?? "");
      expect(promotedMemory?.sourceRefs).toEqual([productBody.v2.eventId]);
      expect(promotedMemory?.quality?.sourceCoverage).toBe(1);

      const developmentRes = await app.inject({
        method: "POST",
        url: "/commit",
        payload: {
          agentId: "development",
          projectId: "openclaw",
          facts: ["development keeps global v2-recall"],
        },
      });
      const developmentBody = JSON.parse(developmentRes.body);
      expect(developmentBody.v2.mode).toBe("v2-recall");
      expect(developmentBody.v2.status).toBe("queued");

      const productStatusRes = await app.inject({
        method: "GET",
        url: "/v2/gray/status?agentId=product&projectId=Product",
      });
      const productStatusBody = JSON.parse(productStatusRes.body);
      expect(productStatusBody.mode).toBe("v2-write");
      expect(productStatusBody.readiness.modeReady).toBe(true);

      const canaryStatusRes = await app.inject({
        method: "GET",
        url: "/v2/canary/status?agentId=product&projectId=Product&expectedMode=v2-write",
      });
      const canaryStatusBody = JSON.parse(canaryStatusRes.body);
      expect(canaryStatusBody.mode).toBe("v2-write");
      expect(canaryStatusBody.status).toBe("warn");
      expect(canaryStatusBody.candidateSourceCoverage).toBe(1);
      expect(canaryStatusBody.checks.find((check: { id: string }) => check.id === "mode")?.status).toBe("pass");
      expect(canaryStatusBody.checks.find((check: { id: string }) => check.id === "candidate_source_refs")?.status).toBe("pass");
      expect(canaryStatusBody.checks.find((check: { id: string }) => check.id === "worker_running")?.status).toBe("warn");

      const developmentStatusRes = await app.inject({
        method: "GET",
        url: "/v2/gray/status?agentId=development&projectId=openclaw",
      });
      const developmentStatusBody = JSON.parse(developmentStatusRes.body);
      expect(developmentStatusBody.mode).toBe("v2-recall");
      expect(developmentStatusBody.readiness.modeReady).toBe(true);

      const rolloutModesRes = await app.inject({
        method: "GET",
        url: "/v2/rollout/modes?scopes=product::Product,development::openclaw,ops::Ops",
      });
      const rolloutModesBody = JSON.parse(rolloutModesRes.body);
      const productRow = rolloutModesBody.modes.find((row: { agentId: string; projectId?: string }) => row.agentId === "product" && row.projectId === "Product");
      const opsRow = rolloutModesBody.modes.find((row: { agentId: string; projectId?: string }) => row.agentId === "ops" && row.projectId === "Ops");

      expect(rolloutModesBody.ok).toBe(true);
      expect(productRow.mode).toBe("v2-write");
      expect(productRow.health.candidateSourceCoverage).toBe(1);
      expect(productRow.health.candidateQueueHealthy).toBe(true);
      expect(productRow.health.warnings).toContain("recall_audit_missing");
      expect(opsRow.mode).toBe("v2-recall");
      expect(opsRow.health.candidateSourceCoverage).toBe(1);
    } finally {
      await app.close();
      restoreEnv(previousEnv);
    }
  });

  it("keeps v2-write commits successful when legacy fallback write fails", async () => {
    const previousEnv = snapshotEnv(v2ModeEnvKeys);
    process.env.MEMORY_FABRIC_V2_MODE = "v2-write";
    delete process.env.MEMORY_FABRIC_V2_OFF_AGENT_IDS;
    delete process.env.MEMORY_FABRIC_V2_SHADOW_AGENT_IDS;
    delete process.env.MEMORY_FABRIC_V2_RECALL_AGENT_IDS;
    delete process.env.MEMORY_FABRIC_V2_WRITE_AGENT_IDS;
    const ledger = new EventLedgerService(cfg);
    const candidates = new AtomicMemoryStore(cfg);
    const app = Fastify({ logger: false });
    const failingOpenViking = {
      async commitSession() {
        throw new Error("legacy unavailable");
      },
    } as unknown as OpenVikingService;

    try {
      registerCommitRoute(app, failingOpenViking, undefined, ledger, candidates);
      await app.ready();
      const res = await app.inject({
        method: "POST",
        url: "/commit",
        payload: {
          agentId: "development",
          projectId: "openclaw",
          decisions: ["v2-write should survive legacy fallback failure"],
        },
      });
      const body = JSON.parse(res.body);
      const writtenCandidates = await candidates.listAll({ agentId: "development", projectId: "openclaw" });

      expect(res.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.v2.status).toBe("written");
      expect(body.v2.legacyStatus).toBe("failed");
      expect(body.v2.error).toContain("legacy fallback failed");
      expect(writtenCandidates).toHaveLength(1);
      expect(writtenCandidates[0].sourceRefs).toEqual([body.v2.eventId]);
    } finally {
      await app.close();
      restoreEnv(previousEnv);
    }
  });

  it("exposes v2 evidence, consolidation, trace, drift, and bench routes", async () => {
    const app = Fastify({ logger: false });
    const carriers = new CarrierRepository(join(tmpRoot, "carriers"));
    registerV2Routes(app, cfg, carriers);
    await app.ready();
    const core = new MemoryCoreV2(cfg);
    await core.create({
      agentId: "development",
      projectId: "openclaw",
      scope: "project",
      type: "fact",
      content: "legacy source-less fact for evidence audit",
    });

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

    const previewRes = await app.inject({
      method: "POST",
      url: "/v2/carriers/projection/preview",
      payload: { agentId: "development", projectId: "openclaw" },
    });
    const previewBody = JSON.parse(previewRes.body);
    expect(previewBody.preview.status).toBe("preview");
    expect(previewBody.preview.summary.changedFiles).toBeGreaterThan(0);
    expect(previewBody.preview.files.some((file: { filename: string; diff: unknown[] }) => file.filename === "decision-log.md" && file.diff.length > 0)).toBe(true);

    const applyRes = await app.inject({
      method: "POST",
      url: "/v2/carriers/projection/apply-preview",
      payload: { previewId: previewBody.preview.previewId },
    });
    const applyBody = JSON.parse(applyRes.body);
    expect(applyBody.projection.status).toBe("applied");
    expect(applyBody.projection.merged).toContain("decision-log.md");

    const projectionHistoryRes = await app.inject({
      method: "GET",
      url: "/v2/carriers/projection/history?agentId=development&projectId=openclaw",
    });
    const projectionHistoryBody = JSON.parse(projectionHistoryRes.body);
    expect(projectionHistoryBody.count).toBe(1);
    expect(projectionHistoryBody.history[0].projectionId).toBe(applyBody.projection.projectionId);

    const projectionPolicyRes = await app.inject({ method: "GET", url: "/v2/carriers/projection/policy" });
    const projectionPolicyBody = JSON.parse(projectionPolicyRes.body);
    expect(projectionPolicyBody.policy.schemaWhitelist).toContain("decision-log.md");
    expect(projectionPolicyBody.policy.ownershipRules.some((rule: { filename: string }) => rule.filename === "self-model.md")).toBe(true);

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
    expect(benchBody.report.status).toBe("complete");
    expect(benchBody.report.recallAt5).toBeGreaterThanOrEqual(0);
    expect(Boolean(benchBody.report.results[0].planIntent)).toBe(true);
    expect(benchBody.report.results[0].matchedTerms).toContain("Hy-Memory");

    const latestBenchRes = await app.inject({ method: "GET", url: "/v2/bench/report" });
    const latestBenchBody = JSON.parse(latestBenchRes.body);
    expect(latestBenchBody.report.cases).toBe(1);

    const benchHistoryRes = await app.inject({ method: "GET", url: "/v2/bench/history?limit=5" });
    const benchHistoryBody = JSON.parse(benchHistoryRes.body);
    expect(benchHistoryBody.count).toBeGreaterThanOrEqual(1);
    expect(benchHistoryBody.history[0].cases).toBe(1);

    const benchStatusRes = await app.inject({ method: "GET", url: "/v2/bench/status" });
    const benchStatusBody = JSON.parse(benchStatusRes.body);
    expect(benchStatusBody.state).toBe("idle");
    expect(benchStatusBody.latestReport.cases).toBe(1);
    expect(benchStatusBody.latestReport.status).toBe("complete");

    const emptyFixtureBenchRes = await app.inject({
      method: "POST",
      url: "/v2/bench/run",
      payload: { useFixtures: true },
    });
    const emptyFixtureBenchBody = JSON.parse(emptyFixtureBenchRes.body);
    expect(emptyFixtureBenchBody.report.cases).toBe(0);

    const latestAfterEmptyBenchRes = await app.inject({ method: "GET", url: "/v2/bench/report" });
    const latestAfterEmptyBenchBody = JSON.parse(latestAfterEmptyBenchRes.body);
    expect(latestAfterEmptyBenchBody.report.cases).toBe(1);

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

    const saveFixturesRes = await app.inject({
      method: "POST",
      url: "/v2/bench/fixtures",
      payload: {
        mode: "replace",
        cases: [
          {
            id: "persisted-fixture-case",
            agentId: "development",
            projectId: "openclaw",
            query: "persisted fixture memory",
            expectedTerms: ["persisted", "fixture"],
          },
        ],
      },
    });
    const saveFixturesBody = JSON.parse(saveFixturesRes.body);
    expect(saveFixturesBody.count).toBe(1);

    const listFixturesRes = await app.inject({ method: "GET", url: "/v2/bench/fixtures" });
    const listFixturesBody = JSON.parse(listFixturesRes.body);
    expect(listFixturesBody.source).toBe("persisted");
    expect(listFixturesBody.cases[0].id).toBe("persisted-fixture-case");

    const seedFixturesRes = await app.inject({
      method: "POST",
      url: "/v2/bench/seed",
      payload: {
        agentId: "development",
        projectId: "openclaw",
        useFixtures: true,
      },
    });
    const seedFixturesBody = JSON.parse(seedFixturesRes.body);
    expect(seedFixturesBody.result.requested).toBe(1);
    expect(seedFixturesBody.result.promoted).toBe(1);

    const fixtureBenchRes = await app.inject({
      method: "POST",
      url: "/v2/bench/run",
      payload: {
        agentId: "development",
        projectId: "openclaw",
        useFixtures: true,
      },
    });
    const fixtureBenchBody = JSON.parse(fixtureBenchRes.body);
    expect(fixtureBenchBody.report.cases).toBe(1);
    expect(fixtureBenchBody.report.status).toBe("complete");

    const saveMixedFixturesRes = await app.inject({
      method: "POST",
      url: "/v2/bench/fixtures",
      payload: {
        mode: "replace",
        cases: [
          {
            id: "mixed-development-fixture",
            agentId: "development",
            projectId: "openclaw",
            query: "mixed development fixture evidence",
            expectedTerms: ["mixed", "development"],
          },
          {
            id: "mixed-product-fixture",
            agentId: "product",
            projectId: "Product",
            query: "mixed product fixture evidence",
            expectedTerms: ["mixed", "product"],
          },
        ],
      },
    });
    const saveMixedFixturesBody = JSON.parse(saveMixedFixturesRes.body);
    expect(saveMixedFixturesBody.count).toBe(2);

    const seedMixedFixturesRes = await app.inject({
      method: "POST",
      url: "/v2/bench/seed",
      payload: {
        useFixtures: true,
        limit: 2,
      },
    });
    const seedMixedFixturesBody = JSON.parse(seedMixedFixturesRes.body);
    expect(seedMixedFixturesBody.result.agentId).toBe("mixed");
    expect(seedMixedFixturesBody.result.scopes).toHaveLength(2);
    expect(seedMixedFixturesBody.result.promoted).toBe(2);

    const mixedFixtureBenchRes = await app.inject({
      method: "POST",
      url: "/v2/bench/run",
      payload: {
        useFixtures: true,
        limit: 2,
      },
    });
    const mixedFixtureBenchBody = JSON.parse(mixedFixtureBenchRes.body);
    expect(mixedFixtureBenchBody.report.cases).toBe(2);
    expect(mixedFixtureBenchBody.report.sourceCoverage).toBe(1);

    const acceptanceStatusRes = await app.inject({ method: "GET", url: "/v2/ops/acceptance/status" });
    const acceptanceStatusBody = JSON.parse(acceptanceStatusRes.body);
    expect(acceptanceStatusBody.fixtures.count).toBe(2);
    expect(acceptanceStatusBody.fixtures.scopes).toHaveLength(2);
    expect(acceptanceStatusBody.seeded.memoryCount).toBeGreaterThanOrEqual(2);

    const acceptanceRunRes = await app.inject({
      method: "POST",
      url: "/v2/ops/acceptance/run",
      payload: { seed: false, limit: 2 },
    });
    const acceptanceRunBody = JSON.parse(acceptanceRunRes.body);
    expect(acceptanceRunBody.report.cases).toBe(2);
    expect(acceptanceRunBody.report.sourceCoverage).toBe(1);

    const sensitiveCandidateRes = await app.inject({
      method: "POST",
      url: "/v2/memories/candidates",
      payload: {
        agentId: "development",
        projectId: "openclaw",
        candidates: [
          {
            type: "fact",
            content: "数据库连接信息: 127.0.0.1:3306/app",
            sourceRefs: [eventId],
            confidence: 0.9,
          },
        ],
      },
    });
    expect(sensitiveCandidateRes.statusCode).toBe(200);

    const sensitivePromotionRes = await app.inject({
      method: "POST",
      url: "/v2/consolidation/run",
      payload: { agentId: "development", projectId: "openclaw" },
    });
    const sensitivePromotionBody = JSON.parse(sensitivePromotionRes.body);
    const sensitivePromotedMemoryId = sensitivePromotionBody.result.entries[0]?.memoryId as string | undefined;
    expect(Boolean(sensitivePromotedMemoryId)).toBe(true);

    const sensitiveReportRes = await app.inject({
      method: "GET",
      url: "/v2/ops/sensitive-candidates?agentId=development&projectId=openclaw",
    });
    const sensitiveReportBody = JSON.parse(sensitiveReportRes.body);
    expect(sensitiveReportBody.count).toBe(1);
    expect(sensitiveReportBody.byReason.database_connection_info).toBe(1);
    expect(sensitiveReportBody.samples[0].content).toBeUndefined();
    expect(sensitiveReportBody.samples[0].promotedMemoryId).toBe(sensitivePromotedMemoryId);

    const rejectSensitiveRes = await app.inject({
      method: "POST",
      url: "/v2/ops/sensitive-candidates/reject",
      payload: { agentId: "development", projectId: "openclaw", retractPromotedMemories: true },
    });
    const rejectSensitiveBody = JSON.parse(rejectSensitiveRes.body);
    expect(rejectSensitiveBody.rejected).toBe(1);
    expect(rejectSensitiveBody.retractedMemories).toBe(1);

    const sensitiveTraceRes = await app.inject({ method: "GET", url: `/v2/memories/${sensitivePromotedMemoryId}/trace` });
    const sensitiveTraceBody = JSON.parse(sensitiveTraceRes.body);
    expect(sensitiveTraceBody.status).toBe("retracted");

    const sensitiveAuditRes = await app.inject({
      method: "GET",
      url: "/v2/ops/sensitive-candidates/audit?agentId=development&projectId=openclaw",
    });
    const sensitiveAuditBody = JSON.parse(sensitiveAuditRes.body);
    expect(sensitiveAuditBody.count).toBeGreaterThanOrEqual(1);
    expect(sensitiveAuditBody.entries.some((entry: { candidateId: string; promotedMemoryId?: string }) => entry.promotedMemoryId === sensitivePromotedMemoryId)).toBe(true);

    const evidenceAuditRes = await app.inject({
      method: "GET",
      url: "/v2/ops/evidence-audit?agentId=development&projectId=openclaw",
    });
    const evidenceAuditBody = JSON.parse(evidenceAuditRes.body);
    expect(evidenceAuditBody.sourceLess).toBeGreaterThan(0);
    expect(evidenceAuditBody.samples.some((sample: { contentPreview: string }) => sample.contentPreview.includes("legacy source-less"))).toBe(true);

    const cleanupFixturesRes = await app.inject({
      method: "POST",
      url: "/v2/bench/fixtures/cleanup",
      payload: { clearFixtures: true },
    });
    const cleanupFixturesBody = JSON.parse(cleanupFixturesRes.body);
    expect(cleanupFixturesBody.memoryDeleted).toBeGreaterThanOrEqual(1);
    expect(cleanupFixturesBody.candidatesRejected).toBeGreaterThanOrEqual(2);
    expect(cleanupFixturesBody.fixturesCleared).toBe(true);

    const fixturesAfterCleanupRes = await app.inject({ method: "GET", url: "/v2/bench/fixtures" });
    const fixturesAfterCleanupBody = JSON.parse(fixturesAfterCleanupRes.body);
    expect(fixturesAfterCleanupBody.count).toBe(0);

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
        legacy: {
          sourceCount: 2,
          budgetUsed: 120,
          memoryBriefChars: 240,
          sources: ["openviking:private", "carrier:self-model.md"],
          memoryBriefPreview: "legacy brief preview",
        },
        v2: {
          intent: "decision_history",
          cardCount: 1,
          evidenceCount: 2,
          renderedChars: 180,
          memoryIds: ["mem-1"],
          evidenceRefs: ["evt-1", "evt-2"],
          cardPreviews: ["Memory Fabric v2 自研，不直接接入 Hy-Memory。"],
        },
      },
    });
    expect(auditRes.statusCode).toBe(200);

    const auditListRes = await app.inject({
      method: "GET",
      url: "/v2/recall/audit?agentId=development&projectId=openclaw",
    });
    const auditListBody = JSON.parse(auditListRes.body);
    expect(auditListBody.count).toBe(1);
    expect(auditListBody.entries[0].legacy.sources).toContain("openviking:private");
    expect(auditListBody.entries[0].v2.memoryIds).toEqual(["mem-1"]);
    expect(auditListBody.entries[0].v2.evidenceRefs).toEqual(["evt-1", "evt-2"]);

    const grayStatusAfterAuditRes = await app.inject({
      method: "GET",
      url: "/v2/gray/status?agentId=development&projectId=openclaw",
    });
    const grayStatusAfterAuditBody = JSON.parse(grayStatusAfterAuditRes.body);
    expect(grayStatusAfterAuditBody.recallAudit.avgV2EvidenceCount).toBe(2);
    expect(grayStatusAfterAuditBody.recallAudit.avgV2RenderedChars).toBe(180);
    expect(grayStatusAfterAuditBody.recallAudit.avgLegacyMemoryBriefChars).toBe(240);

    const workerStopRes = await app.inject({ method: "POST", url: "/v2/consolidation/worker/stop", payload: {} });
    const workerStopBody = JSON.parse(workerStopRes.body);
    expect(workerStopBody.status.running).toBe(false);

    await app.close();
  });
});
