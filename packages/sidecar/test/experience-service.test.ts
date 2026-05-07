import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ExperienceService } from "../src/services/experience-service.js";
import { ExperienceStore } from "../src/stores/experience-store.js";
import { CarrierRepository } from "../src/services/carrier-service.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "mf-test-"));
}

describe("ExperienceService rate limiting", () => {
  it("allows first distill immediately", async () => {
    const dir = makeTempDir();
    const store = new ExperienceStore(dir);
    const carriers = new CarrierRepository(join(dir, "carriers"));
    const svc = new ExperienceService(store, carriers);

    await svc.postCommitDistill({
      agentId: "test-agent",
      toolCalls: [{ name: "read" }, { name: "edit" }, { name: "exec" }],
      toolCount: 3,
      turnCount: 5,
      tokenCost: 0
    });

    const entries = await store.query({ agentId: "test-agent" });
    assert.equal(entries.length, 1);

    rmSync(dir, { recursive: true });
  });

  it("blocks second distill within 5 minutes", async () => {
    const dir = makeTempDir();
    const store = new ExperienceStore(dir);
    const carriers = new CarrierRepository(join(dir, "carriers"));
    const svc = new ExperienceService(store, carriers);

    await svc.postCommitDistill({
      agentId: "test-agent",
      toolCalls: [{ name: "read" }],
      toolCount: 3,
      turnCount: 5,
      tokenCost: 0
    });

    await svc.postCommitDistill({
      agentId: "test-agent",
      toolCalls: [{ name: "read" }],
      toolCount: 3,
      turnCount: 5,
      tokenCost: 0
    });

    const entries = await store.query({ agentId: "test-agent" });
    assert.equal(entries.length, 1); // second blocked by rate limit

    rmSync(dir, { recursive: true });
  });

  it("skips when toolCount < 3 and turnCount < 5", async () => {
    const dir = makeTempDir();
    const store = new ExperienceStore(dir);
    const carriers = new CarrierRepository(join(dir, "carriers"));
    const svc = new ExperienceService(store, carriers);

    await svc.postCommitDistill({
      agentId: "test-agent",
      toolCalls: [{ name: "read" }],
      toolCount: 1,
      turnCount: 2,
      tokenCost: 0
    });

    const entries = await store.query({ agentId: "test-agent" });
    assert.equal(entries.length, 0);

    rmSync(dir, { recursive: true });
  });
});
