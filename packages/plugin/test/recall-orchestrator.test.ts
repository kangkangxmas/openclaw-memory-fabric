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

describe("RecallOrchestrator.plan() — taskType detection", () => {
  const orch = new RecallOrchestrator(makeClient() as never, baseConfig);

  it("returns general for empty message", () => {
    const p = orch.plan({ agentId: "a1" });
    assert.equal(p.taskType, "general");
  });

  it("returns general for short generic message", () => {
    const p = orch.plan({ agentId: "a1", latestMessage: "hello world" });
    assert.equal(p.taskType, "general");
  });

  it("detects code_review for PR review messages", () => {
    const p = orch.plan({ agentId: "a1", latestMessage: "please review this PR" });
    assert.equal(p.taskType, "code_review");
  });

  it("detects code_review for Chinese review keywords", () => {
    const p = orch.plan({ agentId: "a1", latestMessage: "帮我做一下代码审查" });
    assert.equal(p.taskType, "code_review");
  });

  it("detects debug for error messages", () => {
    const p = orch.plan({ agentId: "a1", latestMessage: "there is a bug causing an error" });
    assert.equal(p.taskType, "debug");
  });

  it("detects debug for Chinese debug keywords", () => {
    const p = orch.plan({ agentId: "a1", latestMessage: "系统报错了，帮我排查一下异常" });
    assert.equal(p.taskType, "debug");
  });

  it("detects architecture for design messages", () => {
    const p = orch.plan({ agentId: "a1", latestMessage: "analyze the system design architecture and module dependencies" });
    assert.equal(p.taskType, "architecture");
  });

  it("detects devops for deployment messages", () => {
    const p = orch.plan({ agentId: "a1", latestMessage: "deploy the service to kubernetes" });
    assert.equal(p.taskType, "devops");
  });

  it("detects qa for test-related messages", () => {
    const p = orch.plan({ agentId: "a1", latestMessage: "write test cases for coverage" });
    assert.equal(p.taskType, "qa");
  });

  it("detects documentation for doc-related messages", () => {
    const p = orch.plan({ agentId: "a1", latestMessage: "update the README doc" });
    assert.equal(p.taskType, "documentation");
  });

  it("detects refactor for refactoring messages", () => {
    const p = orch.plan({ agentId: "a1", latestMessage: "refactor this module and simplify" });
    assert.equal(p.taskType, "refactor");
  });

  it("detects refactor for Chinese refactor keywords", () => {
    const p = orch.plan({ agentId: "a1", latestMessage: "重构这个模块并提取公共方法" });
    assert.equal(p.taskType, "refactor");
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

  it("passes taskType to the sidecar recall request", async () => {
    let capturedReq: Record<string, unknown> = {};
    const client = makeClient({
      recall: async (req: Record<string, unknown>) => {
        capturedReq = req;
        return { memoryBrief: "brief", sources: ["s"], budgetUsed: 10 };
      }
    });
    const orch = new RecallOrchestrator(client as never, baseConfig);
    await orch.execute({ agentId: "a1", latestMessage: "fix the bug error" });
    assert.equal(capturedReq.taskType, "debug");
  });

  it("uses v2 memory cards when v2 recall mode is enabled", async () => {
    const previousMode = process.env.MEMORY_FABRIC_V2_MODE;
    process.env.MEMORY_FABRIC_V2_MODE = "v2-recall";
    let legacyRecallCalled = false;
    let auditPayload: Record<string, unknown> | null = null;
    const client = makeClient({
      recall: async () => {
        legacyRecallCalled = true;
        return { memoryBrief: "legacy", sources: ["legacy"], budgetUsed: 10 };
      },
      recallPlan: async () => ({
        ok: true,
        plan: {
          query: "why v2",
          intent: "decision_history",
          reason: "test",
        },
        cards: [
          {
            memoryId: "mem-1",
            type: "decision",
            time: "2026-06-10T00:00:00.000Z",
            confidence: 0.9,
            content: "Memory Fabric v2 uses self-researched memory cards.",
            evidence: ["evt-1"],
          },
        ],
        rendered: "### Memory Cards\n- Memory Fabric v2 uses self-researched memory cards.",
        executionTimeMs: 1,
      }),
      recallAudit: async (req: Record<string, unknown>) => {
        auditPayload = req;
        return { ok: true };
      },
    });

    try {
      const orch = new RecallOrchestrator(client as never, baseConfig);
      const result = await orch.execute({ agentId: "a1", latestMessage: "why v2" });
      assert.equal(legacyRecallCalled, true);
      assert.ok(auditPayload);
      assert.equal((auditPayload as { mode?: string }).mode, "v2-recall");
      assert.deepEqual((auditPayload as { legacy?: { sources?: string[] } }).legacy?.sources, ["legacy"]);
      assert.equal(
        (auditPayload as { legacy?: { memoryBriefPreview?: string } }).legacy?.memoryBriefPreview,
        "legacy"
      );
      assert.deepEqual((auditPayload as { v2?: { memoryIds?: string[] } }).v2?.memoryIds, ["mem-1"]);
      assert.deepEqual((auditPayload as { v2?: { evidenceRefs?: string[] } }).v2?.evidenceRefs, ["evt-1"]);
      assert.deepEqual((auditPayload as { v2?: { cardPreviews?: string[] } }).v2?.cardPreviews, [
        "Memory Fabric v2 uses self-researched memory cards.",
      ]);
      assert.ok(result.brief.includes("Memory Cards"));
      assert.ok(result.sources.includes("v2:recall-plan:decision_history"));
      assert.ok(result.sources.includes("event:evt-1"));
    } finally {
      if (previousMode === undefined) delete process.env.MEMORY_FABRIC_V2_MODE;
      else process.env.MEMORY_FABRIC_V2_MODE = previousMode;
    }
  });

  it("requests extra carrier files for debug task type at l1", async () => {
    let capturedFiles: string[] = [];
    const client = makeClient({
      carrierRead: async (req: { files?: string[] }) => {
        capturedFiles = req.files ?? [];
        return { carriers: [] };
      }
    });
    const orch = new RecallOrchestrator(client as never, baseConfig);
    // Long debug message → l1+ depth, projectId to trigger carrier read
    await orch.execute({ agentId: "a1", projectId: "p1", latestMessage: "x".repeat(210) + " bug error" });
    assert.ok(capturedFiles.includes("open-questions.md"), "debug should include open-questions.md");
    assert.ok(capturedFiles.includes("entities-glossary.md"), "debug should include entities-glossary.md");
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
