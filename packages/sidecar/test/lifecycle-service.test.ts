import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { writeJsonl, readJsonl } from "../src/utils/jsonl.js";
import {
  computeDecayScore,
  compactMemoryFile,
  readSummaryVersion,
  updateSummaryWithVersion,
} from "../src/services/lifecycle-service.js";
import type { MemoryEntry } from "../src/services/openviking-service.js";

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: `mem-${Math.random().toString(36).slice(2, 7)}`,
    type: "fact",
    content: "test entry content for lifecycle",
    agentId: "agent-lc",
    scope: "project",
    visibility: "private",
    createdAt: new Date().toISOString(),
    tags: [],
    ...overrides,
  };
}

describe("computeDecayScore()", () => {
  it("returns ~1 for brand new entries", () => {
    const entry = makeEntry({ createdAt: new Date().toISOString() });
    const score = computeDecayScore(entry);
    assert.ok(score > 0.95, `expected >0.95, got ${score}`);
  });

  it("returns lower score for old entries", () => {
    const old = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const entry = makeEntry({ createdAt: old });
    const score = computeDecayScore(entry);
    assert.ok(score < 0.5, `expected <0.5, got ${score}`);
  });

  it("gives bonus to decisions over facts", () => {
    const ts = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const fact = computeDecayScore(makeEntry({ type: "fact", createdAt: ts }));
    const decision = computeDecayScore(makeEntry({ type: "decision", createdAt: ts }));
    assert.ok(decision > fact, `decision ${decision} should be > fact ${fact}`);
  });
});

describe("compactMemoryFile()", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "lifecycle-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it("returns null when file is under limit", async () => {
    const path = join(tmpDir, "small.jsonl");
    const entries = Array.from({ length: 10 }, () => makeEntry());
    await writeJsonl(path, entries);
    const result = await compactMemoryFile(path);
    assert.equal(result, null);
  });

  it("compacts when over 1000 entries", async () => {
    const path = join(tmpDir, "large.jsonl");
    const entries = Array.from({ length: 1050 }, (_, i) =>
      makeEntry({
        createdAt: new Date(Date.now() - i * 86_400_000).toISOString(),
      }),
    );
    await writeJsonl(path, entries);

    const result = await compactMemoryFile(path);
    assert.ok(result !== null);
    assert.equal(result.before, 1050);
    assert.ok(result.after <= 750);
    assert.ok(result.removed > 0);

    const remaining = await readJsonl<MemoryEntry>(path);
    assert.ok(remaining.length <= 750);
  });
});

describe("summary version locking", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "version-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it("starts at version 0 for missing file", async () => {
    const path = join(tmpDir, "missing.json");
    const version = await readSummaryVersion(path);
    assert.equal(version, 0);
  });

  it("increments version on update", async () => {
    const path = join(tmpDir, "summary.json");
    const ok = await updateSummaryWithVersion(
      path,
      { lastCommit: "2026-01-01T00:00:00Z", agentId: "a", scope: "project" },
      0,
    );
    assert.ok(ok);
    const version = await readSummaryVersion(path);
    assert.equal(version, 1);
  });

  it("rejects stale version", async () => {
    const path = join(tmpDir, "summary.json");
    // version is now 1, try to update with expected version 0
    const ok = await updateSummaryWithVersion(
      path,
      { lastCommit: "2026-01-02T00:00:00Z", agentId: "b", scope: "project" },
      0,
    );
    assert.equal(ok, false);
  });
});
