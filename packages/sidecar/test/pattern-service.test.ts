import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PatternService } from "../src/services/pattern-service.js";
import { PatternStore } from "../src/stores/pattern-store.js";
import { ExperienceStore } from "../src/stores/experience-store.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "mf-test-"));
}

describe("PatternService.detectPatterns()", () => {
  it("returns empty when no experiences", async () => {
    const dir = makeTempDir();
    const expStore = new ExperienceStore(dir);
    const patStore = new PatternStore(dir);
    const svc = new PatternService(expStore, patStore);

    const result = await svc.detectPatterns("agent-x");
    assert.equal(result.patterns.length, 0);

    rmSync(dir, { recursive: true });
  });

  it("detects stable pattern with ≥3 frequency and ≥80% success", async () => {
    const dir = makeTempDir();
    const expStore = new ExperienceStore(dir);
    const patStore = new PatternStore(dir);
    const svc = new PatternService(expStore, patStore);

    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      await expStore.append({
        agentId: "agent-x",
        timestamp: base + i,
        taskType: "development",
        toolsUsed: ["read", "edit", "exec"],
        toolCount: 3,
        turnCount: 6,
        success: true,
        patterns: [],
        lessons: ["test lesson"],
        tokenCost: 0,
        outcome: "success"
      });
    }

    const result = await svc.forceDetect("agent-x");
    assert.equal(result.patterns.length, 1);
    assert.equal(result.patterns[0].taskType, "development");
    assert.ok(result.patterns[0].frequency >= 3);
    assert.ok(result.patterns[0].successRate >= 0.8);

    rmSync(dir, { recursive: true });
  });

  it("skips unstable patterns (low success rate)", async () => {
    const dir = makeTempDir();
    const expStore = new ExperienceStore(dir);
    const patStore = new PatternStore(dir);
    const svc = new PatternService(expStore, patStore);

    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      await expStore.append({
        agentId: "agent-x",
        timestamp: base + i,
        taskType: "development",
        toolsUsed: ["read", "edit"],
        toolCount: 2,
        turnCount: 4,
        success: i < 2, // only 2/5 success = 40%
        patterns: [],
        lessons: [],
        tokenCost: 0,
        outcome: "mixed"
      });
    }

    const result = await svc.forceDetect("agent-x");
    assert.equal(result.patterns.length, 0);

    rmSync(dir, { recursive: true });
  });
});
