import { describe, it, expect, beforeEach } from "bun:test";
import { MemoryCoreV2 } from "../src/core/memory-core-v2.js";
import { QueryRouter } from "../src/core/query-router.js";
import { MemoryAPIV2 } from "../src/api/memory-api-v2.js";

describe("MemoryAPIV2", () => {
  let api: MemoryAPIV2;
  const testConfig = {
    basePath: "/tmp/memory-api-test",
    targetRoot: "test",
  };

  beforeEach(async () => {
    try {
      const { rmdir } = await import("fs/promises");
      await rmdir("/tmp/memory-api-test", { recursive: true });
    } catch {}
    const core = new MemoryCoreV2(testConfig);
    const router = new QueryRouter(core);
    api = new MemoryAPIV2(core, router);
  });

  describe("CRUD", () => {
    it("should create a memory", async () => {
      const result = await api.create({
        content: "Test memory",
        agentId: "agent-1",
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.content).toBe("Test memory");
    });

    it("should read a memory", async () => {
      const created = await api.create({
        content: "Test memory",
        agentId: "agent-1",
      });

      const result = await api.read(created.data!.id);
      expect(result.success).toBe(true);
      expect(result.data?.content).toBe("Test memory");
    });

    it("should return error for non-existent memory", async () => {
      const result = await api.read("non-existent");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Memory not found");
    });

    it("should update a memory", async () => {
      const created = await api.create({
        content: "Original",
        agentId: "agent-1",
      });

      const result = await api.update(created.data!.id, {
        content: "Updated",
      });

      expect(result.success).toBe(true);
      expect(result.data?.content).toBe("Updated");
    });

    it("should delete a memory", async () => {
      const created = await api.create({
        content: "To delete",
        agentId: "agent-1",
      });

      const result = await api.delete(created.data!.id);
      expect(result.success).toBe(true);
      expect(result.data?.deleted).toBe(true);
    });
  });

  describe("Query", () => {
    beforeEach(async () => {
      await api.create({ content: "Apple pie recipe", agentId: "agent-1", type: "fact" });
      await api.create({ content: "Banana bread recipe", agentId: "agent-1", type: "fact" });
      await api.create({ content: "Important decision", agentId: "agent-1", type: "decision" });
    });

    it("should query memories", async () => {
      const result = await api.query({ text: "recipe" });
      expect(result.success).toBe(true);
      expect(result.data?.length).toBeGreaterThan(0);
    });

    it("should filter by type", async () => {
      const result = await api.query({ types: ["decision"] });
      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(1);
      expect(result.data?.[0].type).toBe("decision");
    });

    it("should include execution metadata", async () => {
      const result = await api.query({ text: "test" });
      expect(result.meta?.executionTimeMs).toBeDefined();
    });
  });

  describe("Relations", () => {
    it("should find related memories", async () => {
      const parent = await api.create({ content: "Parent", agentId: "agent-1" });
      
      const result = await api.related(parent.data!.id);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("should get relation graph", async () => {
      const result = await api.graph(10);
      expect(result.success).toBe(true);
      expect(result.data?.nodes).toBeDefined();
      expect(result.data?.edges).toBeDefined();
    });
  });

  describe("Management", () => {
    it("should get statistics", async () => {
      await api.create({ content: "Entry 1", agentId: "agent-1" });
      await api.create({ content: "Entry 2", agentId: "agent-1" });

      const result = await api.stats();
      expect(result.success).toBe(true);
      expect(result.data?.totalEntries).toBeGreaterThanOrEqual(2);
    });

    it("should cleanup expired memories", async () => {
      const result = await api.cleanup();
      expect(result.success).toBe(true);
      expect(result.data?.removed).toBeDefined();
    });

    it("should compact storage", async () => {
      const result = await api.compact();
      expect(result.success).toBe(true);
      expect(result.data?.success).toBe(true);
    });
  });
});