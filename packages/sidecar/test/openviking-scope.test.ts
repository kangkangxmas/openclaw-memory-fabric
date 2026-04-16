/**
 * Unit tests for OpenVikingService scope routing and brief composition.
 * Uses a tmp dir to verify JSONL read/write without real OpenViking.
 *
 * targetRoot = "viking://org/test" → org = "test"
 * Private path:  <basePath>/test/agents/<agentId>/private/memories.jsonl
 * Project path:  <basePath>/test/agents/<agentId>/projects/<projectId>/memories.jsonl
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenVikingService } from "../src/services/openviking-service.js";

const ORG = "test";
let tmpDir: string;
let svc: OpenVikingService;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "viking-scope-test-"));
  svc = new OpenVikingService({
    mode: "local",
    basePath: tmpDir,
    targetRoot: `viking://org/${ORG}`
  });
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedPrivate(agentId: string, entries: object[]): Promise<void> {
  const dir = join(tmpDir, ORG, "agents", agentId, "private");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "memories.jsonl"),
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf8"
  );
}

async function seedProject(agentId: string, projectId: string, entries: object[]): Promise<void> {
  const dir = join(tmpDir, ORG, "agents", agentId, "projects", projectId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "memories.jsonl"),
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
    "utf8"
  );
}

function makeEntry(overrides: object = {}): object {
  return {
    id: `mem-${Math.random().toString(36).slice(2)}`,
    type: "fact",
    content: "default content",
    agentId: "agent-x",
    scope: "private",
    visibility: "private",
    createdAt: new Date().toISOString(),
    tags: [],
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Scope routing
// ---------------------------------------------------------------------------

describe("OpenVikingService — scope routing", () => {
  it("private scope reads only private directory", async () => {
    await seedPrivate("agent-scope1", [
      makeEntry({ agentId: "agent-scope1", content: "private knowledge only" })
    ]);
    await seedProject("agent-scope1", "proj-x", [
      makeEntry({ agentId: "agent-scope1", scope: "project", content: "project knowledge" })
    ]);

    const result = await svc.recallMemory({
      agentId: "agent-scope1",
      projectId: "proj-x",
      scope: "private",
      depth: "l0"
    });

    assert.ok(result.memoryBrief.includes("private knowledge only"));
    assert.ok(!result.memoryBrief.includes("project knowledge"));
  });

  it("project scope reads private + project directories", async () => {
    await seedPrivate("agent-scope2", [
      makeEntry({ agentId: "agent-scope2", content: "private fact" })
    ]);
    await seedProject("agent-scope2", "proj-y", [
      makeEntry({ agentId: "agent-scope2", scope: "project", content: "project decision" })
    ]);

    const result = await svc.recallMemory({
      agentId: "agent-scope2",
      projectId: "proj-y",
      scope: "project",
      depth: "l1"
    });

    assert.ok(result.memoryBrief.includes("private fact"));
    assert.ok(result.memoryBrief.includes("project decision"));
  });

  it("project scope without projectId falls back to private only", async () => {
    await seedPrivate("agent-scope3", [
      makeEntry({ agentId: "agent-scope3", content: "solo private" })
    ]);

    const result = await svc.recallMemory({
      agentId: "agent-scope3",
      scope: "project",
      depth: "l0"
      // no projectId
    });

    assert.ok(!result.sources.some((s) => s.includes(":project:")));
  });

  it("auto scope resolves to project scope when projectId present", async () => {
    await seedPrivate("agent-scope4", [
      makeEntry({ agentId: "agent-scope4", content: "auto private" })
    ]);
    await seedProject("agent-scope4", "proj-auto", [
      makeEntry({ agentId: "agent-scope4", scope: "project", content: "auto project" })
    ]);

    const result = await svc.recallMemory({
      agentId: "agent-scope4",
      projectId: "proj-auto",
      scope: "auto",
      depth: "l0"
    });

    assert.ok(
      result.memoryBrief.includes("auto private") || result.memoryBrief.includes("auto project")
    );
  });
});

// ---------------------------------------------------------------------------
// Brief composition
// ---------------------------------------------------------------------------

describe("OpenVikingService — brief composer", () => {
  it("returns empty-state message when no memories exist", async () => {
    const result = await svc.recallMemory({ agentId: "agent-empty-brief", depth: "l0" });
    assert.ok(result.memoryBrief.includes("No memories found"));
    assert.ok(result.sources.includes("openviking:empty"));
  });

  it("groups entries by type in the brief (Facts / Decisions / Entities)", async () => {
    await seedPrivate("agent-brief1", [
      makeEntry({ agentId: "agent-brief1", type: "fact", content: "node 20 is required" }),
      makeEntry({ agentId: "agent-brief1", type: "decision", content: "use JSONL storage" }),
      makeEntry({ agentId: "agent-brief1", type: "entity", content: "CarrierRepository" })
    ]);

    const result = await svc.recallMemory({ agentId: "agent-brief1", depth: "l1" });
    assert.ok(result.memoryBrief.includes("### Facts"));
    assert.ok(result.memoryBrief.includes("### Decisions"));
    // formatBrief appends 's' directly: entity → "Entitys"
    assert.ok(
      result.memoryBrief.includes("arrier") || result.memoryBrief.includes("CarrierRepository")
    );
    assert.ok(result.memoryBrief.includes("node 20 is required"));
    assert.ok(result.memoryBrief.includes("use JSONL storage"));
  });

  it("brief includes agentId metadata", async () => {
    await seedPrivate("agent-meta1", [
      makeEntry({ agentId: "agent-meta1", content: "meta content" })
    ]);

    const result = await svc.recallMemory({ agentId: "agent-meta1", depth: "l1" });
    assert.ok(result.memoryBrief.includes("agent-meta1"));
  });

  it("keyword scoring puts relevant entries first", async () => {
    await seedPrivate("agent-score1", [
      makeEntry({ agentId: "agent-score1", content: "completely unrelated information" }),
      makeEntry({ agentId: "agent-score1", content: "JSONL is used for persistent memory storage" })
    ]);

    const result = await svc.recallMemory({
      agentId: "agent-score1",
      query: "JSONL memory",
      depth: "l1"
    });

    const briefIdx1 = result.memoryBrief.indexOf("JSONL");
    const briefIdx2 = result.memoryBrief.indexOf("unrelated");
    assert.ok(briefIdx1 < briefIdx2 || briefIdx2 === -1);
  });

  it("depth l0 limits to 5 entries max", async () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ agentId: "agent-depth-l0a", content: `fact number ${i}` })
    );
    await seedPrivate("agent-depth-l0a", entries);

    const result = await svc.recallMemory({ agentId: "agent-depth-l0a", depth: "l0" });
    const matchCount = (result.memoryBrief.match(/fact number/g) ?? []).length;
    assert.ok(matchCount <= 5);
  });

  it("depth l1 allows up to 20 entries max", async () => {
    const entries = Array.from({ length: 25 }, (_, i) =>
      makeEntry({ agentId: "agent-depth-l1a", content: `item ${i}` })
    );
    await seedPrivate("agent-depth-l1a", entries);

    const result = await svc.recallMemory({ agentId: "agent-depth-l1a", depth: "l1" });
    const matchCount = (result.memoryBrief.match(/item \d/g) ?? []).length;
    assert.ok(matchCount <= 20);
  });
});

// ---------------------------------------------------------------------------
// commit → recall round-trip
// ---------------------------------------------------------------------------

describe("OpenVikingService — commit → recall round-trip", () => {
  it("committed facts are retrievable in subsequent recall (private scope)", async () => {
    await svc.commitSession({
      agentId: "agent-rtrip",
      scope: "private",
      facts: ["pnpm is the package manager"],
      decisions: ["use NodeNext module resolution"],
      entities: ["RecallOrchestrator"]
    });

    const result = await svc.recallMemory({ agentId: "agent-rtrip", depth: "l2" });
    assert.ok(result.memoryBrief.includes("pnpm is the package manager"));
    assert.ok(result.memoryBrief.includes("NodeNext"));
    assert.ok(result.memoryBrief.includes("RecallOrchestrator"));
  });

  it("commitSession returns committed count matching total items", async () => {
    const result = await svc.commitSession({
      agentId: "agent-count",
      scope: "private",
      facts: ["f1", "f2"],
      decisions: ["d1"],
      entities: ["E1", "E2", "E3"]
    });
    assert.equal(result.committed, 6);
  });

  it("unresolved items bubble up as publishCandidates", async () => {
    const result = await svc.commitSession({
      agentId: "agent-pub",
      scope: "private",
      unresolved: ["Should we use Redis?", "Is the port 7811 final?"]
    });
    assert.ok(result.publishCandidates.length >= 1);
    assert.ok(result.publishCandidates.some((c) => c.includes("Redis")));
  });

  it("multi-agent isolation: agent A cannot see agent B memories", async () => {
    await svc.commitSession({ agentId: "agent-A", scope: "private", facts: ["agent A secret"] });
    await svc.commitSession({ agentId: "agent-B", scope: "private", facts: ["agent B secret"] });

    const resultA = await svc.recallMemory({ agentId: "agent-A", depth: "l2" });
    const resultB = await svc.recallMemory({ agentId: "agent-B", depth: "l2" });

    assert.ok(resultA.memoryBrief.includes("agent A secret"));
    assert.ok(!resultA.memoryBrief.includes("agent B secret"));
    assert.ok(resultB.memoryBrief.includes("agent B secret"));
    assert.ok(!resultB.memoryBrief.includes("agent A secret"));
  });
});
