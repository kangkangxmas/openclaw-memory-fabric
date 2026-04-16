import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RecallOrchestrator } from "../src/orchestrator/recall-orchestrator.js";
import { loadConfig } from "../src/config/loader.js";
import type { MemoryFabricConfig } from "../src/types/index.js";

// Minimal stub for SidecarClient — only the methods plan() and execute() touch
function makeClient(overrides = {}) {
  return {
    recall: async () => ({
      memoryBrief: "## Brief\nsome memory",
      sources: ["openviking:private"],
      budgetUsed: 50
    }),
    graphBrief: async () => ({
      freshness: "missing",
      coreNodes: [],
      communities: [],
      summary: ""
    }),
    carrierRead: async () => ({ carriers: [] }),
    carrierInit: async () => ({}),
    ...overrides
  };
}

const baseConfig: MemoryFabricConfig = loadConfig();

describe("RecallOrchestrator.plan()", () => {
  const orch = new RecallOrchestrator(makeClient() as never, baseConfig);

  it("detects l0 for a short simple message", () => {
    const p = orch.plan({ agentId: "a1", latestMessage: "hi", messageCount: 2 });
    assert.equal(p.depth, "l0");
    assert.equal(p.needsStructuralBrief, false);
  });

  it("detects l1 when message count > 10", () => {
    const p = orch.plan({ agentId: "a1", latestMessage: "hi", messageCount: 15 });
    assert.equal(p.depth, "l1");
  });

  it("detects l1 for a long message (>200 chars)", () => {
    const longMsg = "x".repeat(210);
    const p = orch.plan({ agentId: "a1", latestMessage: longMsg });
    assert.equal(p.depth, "l1");
  });

  it("detects l2 for messages with architecture keywords + length", () => {
    const p = orch.plan({
      agentId: "a1",
      latestMessage: "架构设计 " + "y".repeat(210)
    });
    assert.equal(p.depth, "l2");
  });

  it("needsStructuralBrief is true for l1+ with projectId", () => {
    const p = orch.plan({ agentId: "a1", projectId: "proj1", latestMessage: "x".repeat(210) });
    assert.equal(p.needsStructuralBrief, true);
  });

  it("needsStructuralBrief is false without projectId even at l1", () => {
    const p = orch.plan({ agentId: "a1", latestMessage: "x".repeat(210) });
    assert.equal(p.needsStructuralBrief, false);
  });

  it("scope defaults to private when no projectId", () => {
    const p = orch.plan({ agentId: "a1", latestMessage: "something" });
    assert.equal(p.scope, "private");
  });

  it("scope is project when projectId set and defaultScope != private", () => {
    const cfg = loadConfig({ defaultScope: "project" });
    const o = new RecallOrchestrator(makeClient() as never, cfg);
    const p = o.plan({ agentId: "a1", projectId: "p1", latestMessage: "something" });
    assert.equal(p.scope, "project");
  });
});

describe("RecallOrchestrator.execute()", () => {
  it("returns a brief string and sources array on success", async () => {
    const orch = new RecallOrchestrator(makeClient() as never, baseConfig);
    const result = await orch.execute({ agentId: "a1", latestMessage: "hi" });
    assert.ok(typeof result.brief === "string");
    assert.ok(Array.isArray(result.sources));
    assert.ok(result.sources.length >= 1);
  });

  it("includes graphify source when graphBrief returns non-missing freshness", async () => {
    const client = makeClient({
      graphBrief: async () => ({
        freshness: "fresh",
        coreNodes: ["NodeA", "NodeB"],
        communities: ["cluster-1"],
        summary: "A test project with two main modules"
      })
    });
    const orch = new RecallOrchestrator(client as never, baseConfig);
    const ctx = { agentId: "a1", projectId: "p1", latestMessage: "x".repeat(210) };
    const result = await orch.execute(ctx);
    assert.ok(result.sources.some((s) => s.startsWith("graphify:")));
    assert.ok(result.brief.includes("Structural Brief"));
  });

  it("gracefully skips graphBrief when sidecar throws", async () => {
    const client = makeClient({
      graphBrief: async () => {
        throw new Error("unavailable");
      }
    });
    const orch = new RecallOrchestrator(client as never, baseConfig);
    const ctx = { agentId: "a1", projectId: "p1", latestMessage: "x".repeat(210) };
    const result = await orch.execute(ctx);
    assert.ok(!result.sources.some((s) => s.startsWith("graphify:")));
  });

  it("includes carrier source at l1 when carriers are populated", async () => {
    const client = makeClient({
      carrierRead: async () => ({
        carriers: [
          {
            filename: "self-model.md",
            content: "# Self Model\ncurrent goal: testing",
            exists: true
          },
          {
            filename: "project-model.md",
            content: "# Project Model\ngoal: build a thing",
            exists: true
          }
        ]
      })
    });
    const orch = new RecallOrchestrator(client as never, baseConfig);
    const ctx = { agentId: "a1", projectId: "p1", latestMessage: "x".repeat(210) };
    const result = await orch.execute(ctx);
    assert.ok(result.sources.some((s) => s.startsWith("carrier:")));
  });
});
