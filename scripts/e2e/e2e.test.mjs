/**
 * E2E test suite for openclaw-memory-fabric.
 *
 * Starts a real sidecar on a random port, exercises all key scenarios,
 * then shuts it down. Runs against the compiled dist/ output.
 *
 * Usage:
 *   node --test scripts/e2e/e2e.test.mjs
 *
 * Prerequisites:
 *   pnpm -r build     (must be done before running)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// ---------------------------------------------------------------------------
// Sidecar lifecycle helpers
// ---------------------------------------------------------------------------

const E2E_PORT = 17811; // avoid conflicts with local dev port

async function startSidecar(dataDir) {
  const env = {
    ...process.env,
    PORT: String(E2E_PORT),
    HOST: "127.0.0.1",
    OPENVIKING_MODE: "local",
    OPENVIKING_BASE_PATH: join(dataDir, "openviking"),
    CARRIERS_ROOT: join(dataDir, "carriers"),
    GRAPHIFY_BASE_PATH: join(dataDir, "graph"),
    LOG_LEVEL: "error"  // suppress logs during tests
  };

  const proc = spawn(
    process.execPath,
    ["packages/sidecar/dist/server.js"],
    { env, stdio: "pipe", cwd: process.cwd() }
  );

  // Wait for sidecar to be ready (max 5 seconds)
  for (let i = 0; i < 25; i++) {
    await sleep(200);
    try {
      const res = await fetch(`http://127.0.0.1:${E2E_PORT}/health`);
      if (res.ok) break;
    } catch {
      // not ready yet
    }
    if (i === 24) throw new Error("Sidecar did not start within 5 seconds");
  }
  return proc;
}

function stopSidecar(proc) {
  proc.kill("SIGTERM");
}

async function post(path, body) {
  const res = await fetch(`http://127.0.0.1:${E2E_PORT}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

let dataDir;
let proc;

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "e2e-sidecar-"));
  proc = await startSidecar(dataDir);
});

after(async () => {
  stopSidecar(proc);
  await rm(dataDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// E2E 1: Health check
// ---------------------------------------------------------------------------

describe("E2E: Health check", () => {
  it("GET /health returns ok:true", async () => {
    const res = await fetch(`http://127.0.0.1:${E2E_PORT}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });
});

// ---------------------------------------------------------------------------
// E2E 2: Multi-agent isolation
// ---------------------------------------------------------------------------

describe("E2E: Multi-agent isolation", () => {
  it("agent A and agent B memories do not cross-contaminate", async () => {
    // Agent A commits a private fact
    await post("/commit", {
      agentId: "e2e-agent-A",
      projectId: "e2e-proj",
      facts: ["agent-A uses TypeScript exclusively"]
    });

    // Agent B commits a different private fact
    await post("/commit", {
      agentId: "e2e-agent-B",
      projectId: "e2e-proj",
      facts: ["agent-B prefers Python for scripts"]
    });

    // Agent A recalls
    const { body: recallA } = await post("/recall", {
      agentId: "e2e-agent-A",
      projectId: "e2e-proj",
      scope: "project",
      depth: "l2"
    });

    // Agent B recalls
    const { body: recallB } = await post("/recall", {
      agentId: "e2e-agent-B",
      projectId: "e2e-proj",
      scope: "project",
      depth: "l2"
    });

    assert.ok(recallA.memoryBrief.includes("TypeScript"), "A should see its own memory");
    assert.ok(!recallA.memoryBrief.includes("Python"), "A should NOT see B's memory");
    assert.ok(recallB.memoryBrief.includes("Python"), "B should see its own memory");
    assert.ok(!recallB.memoryBrief.includes("TypeScript"), "B should NOT see A's memory");
  });
});

// ---------------------------------------------------------------------------
// E2E 3: Cross-session persistence (simulates "cross-day" memory)
// ---------------------------------------------------------------------------

describe("E2E: Cross-session persistence", () => {
  it("memories committed in one 'session' are retrievable in the next", async () => {
    // Session 1: commit
    await post("/commit", {
      agentId: "e2e-persist",
      projectId: "e2e-persist-proj",
      facts: ["the final API endpoint is /api/v2/query"],
      decisions: ["switched from REST to GraphQL in phase 9"]
    });

    // Simulate context window cleared — new session, same agent
    // Session 2: recall
    const { body } = await post("/recall", {
      agentId: "e2e-persist",
      projectId: "e2e-persist-proj",
      scope: "project",
      depth: "l2",
      query: "API endpoint"
    });

    assert.ok(body.memoryBrief.includes("/api/v2/query"), "recalled fact from previous session");
    assert.ok(body.memoryBrief.includes("GraphQL"), "recalled decision from previous session");
  });
});

// ---------------------------------------------------------------------------
// E2E 4: Shared governance — publish → recall → retract
// ---------------------------------------------------------------------------

describe("E2E: Shared governance", () => {
  it("published entries are visible to other agents; retracted entries are not", async () => {
    const projectId = "e2e-shared-proj";

    // Agent X publishes a shared fact
    await post("/shared/publish", {
      sourceAgent: "e2e-agent-X",
      projectId,
      items: [
        { type: "fact", content: "kafka cluster version is 3.7" },
        { type: "decision", content: "use SSL for all broker connections" }
      ]
    });

    // Agent Y can recall the shared facts
    const { body: recall1 } = await post("/shared/recall", {
      projectId,
      query: "kafka"
    });
    assert.ok(recall1.entries.length >= 1, "agent Y should see shared entries");
    assert.ok(recall1.entries.some((e) => e.content.includes("kafka")));

    // Agent X retracts the kafka fact
    await post("/shared/forget", {
      projectId,
      query: "kafka cluster version"
    });

    // Agent Y can no longer see the retracted entry
    const { body: recall2 } = await post("/shared/recall", {
      projectId,
      query: "kafka"
    });
    assert.ok(
      !recall2.entries.some((e) => e.content.includes("kafka cluster version")),
      "retracted entry must not appear in recall"
    );

    // But the SSL decision was not retracted — still visible
    const { body: recall3 } = await post("/shared/recall", { projectId, query: "SSL" });
    assert.ok(recall3.entries.some((e) => e.content.includes("SSL")));
  });

  it("shared entries appear in main /recall with scope=shared", async () => {
    const projectId = "e2e-shared-main-proj";

    await post("/shared/publish", {
      sourceAgent: "e2e-agent-Z",
      projectId,
      items: [{ type: "fact", content: "redis max memory policy is allkeys-lru" }]
    });

    const { body } = await post("/recall", {
      agentId: "e2e-agent-Z",
      projectId,
      scope: "shared",
      query: "redis"
    });

    assert.ok(
      body.memoryBrief.includes("redis") ||
      body.sources.some((s) => s.startsWith("shared:")),
      "shared entries should appear in main recall with scope=shared"
    );
  });
});

// ---------------------------------------------------------------------------
// E2E 5: Graceful degradation
// ---------------------------------------------------------------------------

describe("E2E: Graceful degradation", () => {
  it("recall for unknown agent returns a brief (not an error)", async () => {
    const { status, body } = await post("/recall", {
      agentId: "e2e-brand-new-agent",
      depth: "l0"
    });
    assert.equal(status, 200, "should return 200 even for unknown agent");
    assert.ok(typeof body.memoryBrief === "string", "should return a memoryBrief string");
  });

  it("invalid scope returns 400 not 500", async () => {
    const { status } = await post("/recall", {
      agentId: "e2e-any",
      scope: "universe"    // invalid enum
    });
    assert.equal(status, 400, "invalid schema field should return 400");
  });

  it("distill on empty messages returns empty arrays gracefully", async () => {
    const { status, body } = await post("/distill", {
      agentId: "e2e-distill",
      messages: []
    });
    assert.equal(status, 200);
    assert.deepEqual(body.facts, []);
    assert.deepEqual(body.decisions, []);
  });
});

// ---------------------------------------------------------------------------
// E2E 6: Full commit → distill → carrier round-trip
// ---------------------------------------------------------------------------

describe("E2E: Full pipeline round-trip", () => {
  it("distill extracts content, commit stores it, recall retrieves it", async () => {
    const agentId = "e2e-pipeline";
    const projectId = "e2e-pipeline-proj";

    // Step 1: distill a conversation
    const { body: distillResult } = await post("/distill", {
      agentId,
      messages: [
        { role: "user", content: "What storage should we use?" },
        {
          role: "assistant",
          content:
            "We decided to use JSONL for incremental append storage. " +
            "The CarrierRepository and OpenVikingService are the two key components."
        }
      ]
    });

    assert.ok(distillResult.decisions.length >= 1, "should extract at least one decision");
    assert.ok(distillResult.entities.includes("CarrierRepository"), "should extract entity");

    // Step 2: commit the distilled output
    const { status: commitStatus } = await post("/commit", {
      agentId,
      projectId,
      facts: distillResult.facts,
      decisions: distillResult.decisions,
      entities: distillResult.entities
    });
    assert.equal(commitStatus, 200);

    // Step 3: initialise carriers
    await post("/carrier/init", { agentId, projectId });

    // Step 4: recall and verify distilled content is present
    const { body: recallResult } = await post("/recall", {
      agentId,
      projectId,
      scope: "project",
      depth: "l2",
      query: "JSONL storage"
    });

    assert.ok(
      recallResult.memoryBrief.includes("JSONL") ||
      recallResult.memoryBrief.includes("CarrierRepository"),
      "recalled brief should contain distilled knowledge"
    );
  });
});
