import { describe, it, expect, beforeEach } from "./test-helpers.js";
import { MemoryCoreV2 } from "../src/core/memory-core-v2.js";
import { QueryRouter } from "../src/core/query-router.js";
import { MemoryEntryBuilder } from "../src/models/schema-v2.js";

describe("QueryRouter", () => {
  let core: MemoryCoreV2;
  let router: QueryRouter;
  const testConfig = {
    mode: "local" as const,
    basePath: "/tmp/query-router-test",
    targetRoot: "test",
  };

  beforeEach(async () => {
    try {
      const { rmdir } = await import("fs/promises");
      await rmdir("/tmp/query-router-test", { recursive: true });
    } catch {}
    core = new MemoryCoreV2(testConfig);
    router = new QueryRouter(core);

    // Seed data
    await core.create({ content: "Apple pie recipe with cinnamon", agentId: "agent-1", type: "fact" });
    await core.create({ content: "Banana bread recipe", agentId: "agent-1", type: "fact" });
    await core.create({ content: "Important architecture decision", agentId: "agent-1", type: "decision" });
    await core.create({ content: "Project Alpha roadmap", agentId: "agent-2", type: "entity" });
  });

  describe("Query Classification", () => {
    it("should route keyword queries", async () => {
      const result = await router.route("recipe");
      expect(result.plan.strategy).toBe("keyword");
      expect(result.results.length).toBeGreaterThan(0);
    });

    it("should route temporal queries", async () => {
      const result = await router.route("recent decisions");
      expect(result.plan.strategy).toBe("temporal");
    });

    it("should route relational queries", async () => {
      const result = await router.route("related to Project Alpha");
      expect(result.plan.strategy).toBe("relational");
    });

    it("should route hybrid queries by default", async () => {
      const result = await router.route("project roadmap");
      expect(result.plan.strategy).toBe("hybrid");
    });
  });

  describe("Result Fusion", () => {
    it("should return results from multiple strategies", async () => {
      const result = await router.route("recipe");
      expect(result.sources.length).toBeGreaterThan(0);
      expect(result.results.length).toBeGreaterThan(0);
    });

    it("should include execution time", async () => {
      const result = await router.route("test");
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("should include query plan", async () => {
      const result = await router.route("recipe");
      expect(result.plan.originalQuery).toBe("recipe");
      expect(result.plan.confidence).toBeGreaterThan(0);
    });
  });

  describe("Config", () => {
    it("should respect maxResults config", async () => {
      const customRouter = new QueryRouter(core, undefined, {
        maxResults: 2,
        semanticWeight: 0.5,
        keywordWeight: 0.5,
        temporalWeight: 0,
        relationalWeight: 0,
        minScore: 0.1,
        enableDecomposition: false,
      });

      const result = await customRouter.route("recipe");
      expect(result.results.length).toBeLessThanOrEqual(2);
    });
  });
});
