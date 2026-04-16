/**
 * Integration tests for sidecar HTTP routes.
 * Uses Fastify's inject() — no real network, no port binding.
 * Each suite creates its own tmp dir so tests are fully isolated.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import type { FastifyInstance, FastifyError } from "fastify";
import { OpenVikingService } from "../src/services/openviking-service.js";
import { CarrierRepository } from "../src/services/carrier-service.js";
import { DistillService } from "../src/services/distill-service.js";
import { SharedService } from "../src/services/shared-service.js";
import { registerHealthRoute } from "../src/routes/health.js";
import { registerRecallRoute } from "../src/routes/recall.js";
import { registerCommitRoute } from "../src/routes/commit.js";
import { registerCarrierRoutes } from "../src/routes/carrier.js";
import { registerDistillRoute } from "../src/routes/distill.js";
import { registerSharedRoutes } from "../src/routes/shared.js";
import type { ErrorResponse } from "../src/models/index.js";

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------

async function buildTestApp(tmpDir: string): Promise<FastifyInstance> {
  const cfg = {
    mode: "local" as const,
    basePath: join(tmpDir, "openviking"),
    targetRoot: "viking://org/test"
  };

  const openviking = new OpenVikingService(cfg);
  const carriers = new CarrierRepository(join(tmpDir, "carriers"));
  const distill = new DistillService();
  const shared = new SharedService(join(tmpDir, "carriers"));

  const app = Fastify({ logger: false });

  app.setErrorHandler((error: FastifyError, _req, reply) => {
    const statusCode = error.statusCode ?? 500;
    const body: ErrorResponse = {
      error: {
        code: statusCode === 400 ? "BAD_REQUEST" : "SIDECAR_ERROR",
        message: error.message,
        details: {}
      }
    };
    void reply.status(statusCode).send(body);
  });

  registerHealthRoute(app, {
    port: 7811,
    host: "127.0.0.1",
    openviking: { mode: "local", basePath: join(tmpDir, "openviking"), targetRoot: "viking://org/test" },
    carriers: { root: join(tmpDir, "carriers") },
    graphify: { basePath: join(tmpDir, "graphs") }
  });
  registerRecallRoute(app, openviking, shared);
  registerCommitRoute(app, openviking);
  registerCarrierRoutes(app, carriers);
  registerDistillRoute(app, distill);
  registerSharedRoutes(app, shared);

  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  let app: FastifyInstance;
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sidecar-health-"));
    app = await buildTestApp(tmpDir);
  });
  after(async () => {
    await app.close();
    await rm(tmpDir, { recursive: true });
  });

  it("returns 200 with ok:true", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { ok: boolean };
    assert.equal(body.ok, true);
  });

  it("returns components object with openviking, graphify, carriers fields", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as {
      components: {
        openviking: { reachable: boolean };
        graphify: { available: boolean };
        carriers: { writable: boolean };
      };
    };
    assert.ok(typeof body.components === "object", "components should be an object");
    assert.ok("reachable" in body.components.openviking, "openviking.reachable should exist");
    assert.ok("available" in body.components.graphify, "graphify.available should exist");
    assert.ok("writable" in body.components.carriers, "carriers.writable should exist");
  });

  it("returns uptimeSeconds and lastRefreshTime", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    const body = JSON.parse(res.body) as { uptimeSeconds: number; lastRefreshTime: string };
    assert.ok(typeof body.uptimeSeconds === "number");
    assert.ok(typeof body.lastRefreshTime === "string");
  });
});

// ---------------------------------------------------------------------------
// POST /recall
// ---------------------------------------------------------------------------

describe("POST /recall", () => {
  let app: FastifyInstance;
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sidecar-recall-"));
    app = await buildTestApp(tmpDir);
  });
  after(async () => {
    await app.close();
    await rm(tmpDir, { recursive: true });
  });

  it("returns 200 with memoryBrief for a fresh agent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/recall",
      payload: { agentId: "agent-r1", depth: "l0" }
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { memoryBrief: string; sources: string[] };
    assert.ok(typeof body.memoryBrief === "string");
    assert.ok(Array.isArray(body.sources));
  });

  it("returns 400 when agentId is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/recall",
      payload: { depth: "l0" }
    });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body) as ErrorResponse;
    assert.ok(body.error.code === "BAD_REQUEST");
  });

  it("commit then recall returns the committed content", async () => {
    // Commit with projectId so scope resolves to project correctly
    await app.inject({
      method: "POST",
      url: "/commit",
      payload: {
        agentId: "agent-rc",
        projectId: "proj-rc",
        facts: ["the sidecar listens on port 7811"],
        decisions: ["use Fastify 5"]
      }
    });

    const res = await app.inject({
      method: "POST",
      url: "/recall",
      payload: { agentId: "agent-rc", projectId: "proj-rc", scope: "project", depth: "l2" }
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { memoryBrief: string };
    assert.ok(body.memoryBrief.includes("port 7811") || body.memoryBrief.includes("Fastify"));
  });
});

// ---------------------------------------------------------------------------
// POST /commit
// ---------------------------------------------------------------------------

describe("POST /commit", () => {
  let app: FastifyInstance;
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sidecar-commit-"));
    app = await buildTestApp(tmpDir);
  });
  after(async () => {
    await app.close();
    await rm(tmpDir, { recursive: true });
  });

  it("returns 200 with committed count", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/commit",
      payload: {
        agentId: "agent-c1",
        projectId: "proj-c1",
        facts: ["f1", "f2"],
        decisions: ["d1"]
      }
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { ok: boolean; committed: number };
    assert.equal(body.ok, true);
    assert.equal(body.committed, 3);
  });

  it("returns 400 when agentId is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/commit",
      payload: { facts: ["f1"] }
    });
    assert.equal(res.statusCode, 400);
  });

  it("unresolved items appear in publishCandidates", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/commit",
      payload: {
        agentId: "agent-c2",
        projectId: "proj-c2",
        unresolved: ["Should we use Redis?", "Is the schema final?"]
      }
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { publishCandidates: string[] };
    assert.ok(body.publishCandidates.length >= 1);
  });
});

// ---------------------------------------------------------------------------
// POST /carrier/init and /carrier/read
// ---------------------------------------------------------------------------

describe("POST /carrier/init and /carrier/read", () => {
  let app: FastifyInstance;
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sidecar-carrier-"));
    app = await buildTestApp(tmpDir);
  });
  after(async () => {
    await app.close();
    await rm(tmpDir, { recursive: true });
  });

  it("init returns 200 and creates carrier files", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/carrier/init",
      payload: { agentId: "agent-ci", projectId: "proj-1" }
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { ok: boolean };
    assert.equal(body.ok, true);
  });

  it("read returns carrier content after init", async () => {
    await app.inject({
      method: "POST",
      url: "/carrier/init",
      payload: { agentId: "agent-cr", projectId: "proj-2" }
    });

    const res = await app.inject({
      method: "POST",
      url: "/carrier/read",
      payload: {
        agentId: "agent-cr",
        projectId: "proj-2",
        files: ["self-model.md", "project-model.md"]
      }
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { carriers: Array<{ filename: string; exists: boolean }> };
    assert.ok(body.carriers.length === 2);
    assert.ok(body.carriers.every((c) => typeof c.filename === "string"));
  });
});

// ---------------------------------------------------------------------------
// POST /distill
// ---------------------------------------------------------------------------

describe("POST /distill", () => {
  let app: FastifyInstance;
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sidecar-distill-"));
    app = await buildTestApp(tmpDir);
  });
  after(async () => {
    await app.close();
    await rm(tmpDir, { recursive: true });
  });

  it("returns structured distill output for assistant messages", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/distill",
      payload: {
        agentId: "agent-d1",
        messages: [
          { role: "user", content: "How do we handle migrations?" },
          {
            role: "assistant",
            content:
              "We decided to use JSONL for incremental storage. The CarrierRepository manages all file operations."
          }
        ]
      }
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as {
      facts: string[];
      decisions: string[];
      entities: string[];
    };
    assert.ok(Array.isArray(body.decisions));
    assert.ok(Array.isArray(body.entities));
    assert.ok(body.entities.includes("CarrierRepository"));
  });

  it("returns 400 when agentId is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/distill",
      payload: { messages: [{ role: "assistant", content: "hello" }] }
    });
    assert.equal(res.statusCode, 400);
  });
});

// ---------------------------------------------------------------------------
// POST /shared/publish, /shared/recall, /shared/forget
// ---------------------------------------------------------------------------

describe("Shared memory routes", () => {
  let app: FastifyInstance;
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sidecar-shared-"));
    app = await buildTestApp(tmpDir);
  });
  after(async () => {
    await app.close();
    await rm(tmpDir, { recursive: true });
  });

  it("publish returns published count and ids", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/shared/publish",
      payload: {
        sourceAgent: "agent-s1",
        projectId: "proj-shared",
        items: [
          { type: "fact", content: "the cluster has 3 nodes" },
          { type: "decision", content: "use blue-green deployment" }
        ]
      }
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { published: number; ids: string[] };
    assert.equal(body.published, 2);
    assert.equal(body.ids.length, 2);
  });

  it("published entries are retrievable via shared recall", async () => {
    await app.inject({
      method: "POST",
      url: "/shared/publish",
      payload: {
        sourceAgent: "agent-s2",
        projectId: "proj-recall",
        items: [{ type: "fact", content: "redis is used for session cache" }]
      }
    });

    const res = await app.inject({
      method: "POST",
      url: "/shared/recall",
      payload: { projectId: "proj-recall", query: "redis" }
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { entries: Array<{ content: string }> };
    assert.ok(body.entries.some((e) => e.content.includes("redis")));
  });

  it("shared recall returns empty entries for unknown project", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/shared/recall",
      payload: { projectId: "proj-nonexistent" }
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { entries: unknown[] };
    assert.equal(body.entries.length, 0);
  });

  it("forget retracts matching entry — retracted item no longer recalled", async () => {
    await app.inject({
      method: "POST",
      url: "/shared/publish",
      payload: {
        sourceAgent: "agent-s3",
        projectId: "proj-forget",
        items: [{ type: "note", content: "outdated architecture note" }]
      }
    });

    await app.inject({
      method: "POST",
      url: "/shared/forget",
      payload: { projectId: "proj-forget", query: "outdated architecture" }
    });

    const res = await app.inject({
      method: "POST",
      url: "/shared/recall",
      payload: { projectId: "proj-forget", query: "outdated" }
    });
    const body = JSON.parse(res.body) as { entries: unknown[] };
    assert.equal(body.entries.length, 0);
  });

  it("recall route appends shared entries when scope=shared and projectId given", async () => {
    // Publish a shared entry
    await app.inject({
      method: "POST",
      url: "/shared/publish",
      payload: {
        sourceAgent: "agent-s4",
        projectId: "proj-combined",
        items: [{ type: "fact", content: "cross-agent shared fact about kafka" }]
      }
    });

    // Recall via main /recall route with scope=shared
    const res = await app.inject({
      method: "POST",
      url: "/recall",
      payload: {
        agentId: "agent-s4",
        projectId: "proj-combined",
        scope: "shared",
        query: "kafka"
      }
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { memoryBrief: string; sources: string[] };
    assert.ok(
      body.memoryBrief.includes("kafka") || body.sources.some((s) => s.startsWith("shared:"))
    );
  });

  it("publish returns 400 when items array is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/shared/publish",
      payload: {
        sourceAgent: "agent-s5",
        projectId: "proj-validation",
        items: []
      }
    });
    assert.equal(res.statusCode, 400);
  });

  it("org_shared entries are stored separately from project_shared entries", async () => {
    // Publish one project_shared and one org_shared entry for the same projectId
    await app.inject({
      method: "POST",
      url: "/shared/publish",
      payload: {
        sourceAgent: "agent-org",
        projectId: "proj-org-test",
        visibility: "project_shared",
        items: [{ type: "fact", content: "project-level fact" }]
      }
    });
    await app.inject({
      method: "POST",
      url: "/shared/publish",
      payload: {
        sourceAgent: "agent-org",
        projectId: "proj-org-test",
        visibility: "org_shared",
        items: [{ type: "fact", content: "org-level fact" }]
      }
    });

    // Recall should surface both (merged by SharedService.recall)
    const res = await app.inject({
      method: "POST",
      url: "/shared/recall",
      payload: { projectId: "proj-org-test", limit: 10 }
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { entries: Array<{ content: string; visibility: string }> };
    const contents = body.entries.map((e) => e.content);
    assert.ok(contents.includes("project-level fact"), "should include project_shared entry");
    assert.ok(contents.includes("org-level fact"), "should include org_shared entry");

    // Verify the two entries have different visibility values
    const visibilities = new Set(body.entries.map((e) => e.visibility));
    assert.ok(visibilities.has("project_shared"), "project_shared visibility present");
    assert.ok(visibilities.has("org_shared"), "org_shared visibility present");
  });
});
