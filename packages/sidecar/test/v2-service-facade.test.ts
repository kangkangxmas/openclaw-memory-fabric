import { describe, it, expect, beforeAll } from "bun:test";
import { V2ServiceFacade, type V2FacadeConfig } from "../src/services/v2-service-facade.js";
import type { MemoryEntryV2 } from "../src/models/schema-v2.js";

describe("V2ServiceFacade", () => {
  let facade: V2ServiceFacade;

  const testConfig: V2FacadeConfig = {
    sidecarConfig: {
      basePath: "/tmp/facade-test",
      targetRoot: "memories",
    },
    instanceId: "test-instance",
  };

  beforeAll(async () => {
    try {
      const { rmdir } = await import("fs/promises");
      await rmdir("/tmp/facade-test", { recursive: true });
    } catch {}
    facade = new V2ServiceFacade(testConfig);
  });

  describe("CRUD", () => {
    it("should create memory", async () => {
      const entry = await facade.create({
        content: "Test entry for facade",
        agentId: "agent-1",
        type: "fact",
        tags: ["test", "facade"],
      });

      expect(entry.id).toBeDefined();
      expect(entry.content).toBe("Test entry for facade");
      expect(entry.metadata?.tags).toContain("test");
    });

    it("should read memory", async () => {
      const created = await facade.create({
        content: "Read test",
        agentId: "agent-1",
      });

      const read = await facade.read(created.id);
      expect(read).toBeDefined();
      expect(read?.content).toBe("Read test");
    });

    it("should return null for non-existent memory", async () => {
      const result = await facade.read("non-existent-id");
      expect(result).toBeNull();
    });

    it("should delete memory", async () => {
      const created = await facade.create({
        content: "Delete test",
        agentId: "agent-1",
      });

      const deleted = await facade.delete(created.id);
      expect(deleted).toBe(true);
    });
  });

  describe("Query", () => {
    it("should search by text", async () => {
      await facade.create({ content: "Recipe for apple pie", agentId: "agent-1" });
      await facade.create({ content: "Project roadmap 2026", agentId: "agent-2" });

      const results = await facade.search("recipe");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((e) => e.content.includes("Recipe"))).toBe(true);
    });

    it("should query with filters", async () => {
      await facade.create({ content: "Decision entry", agentId: "agent-1", type: "decision" });
      await facade.create({ content: "Fact entry", agentId: "agent-2", type: "fact" });

      const result = await facade.query({
        types: ["decision"],
        agentId: "agent-1",
      });

      expect(result.entries.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Advanced Query", () => {
    it("should aggregate entries", async () => {
      const result = await facade.aggregate({ field: "id", op: "count" });
      expect(result.value).toBeGreaterThan(0);
    });

    it("should group entries", async () => {
      const groups = await facade.group("agentId");
      expect(groups.length).toBeGreaterThan(0);
    });

    it("should generate facets", async () => {
      const facets = await facade.facets(["type", "agentId"]);
      expect(facets.length).toBe(2);
    });
  });

  describe("Stats", () => {
    it("should return memory stats", async () => {
      const stats = await facade.stats();
      expect(stats.totalEntries).toBeGreaterThan(0);
    });
  });

  describe("Cache & Index", () => {
    it("should report cache stats", () => {
      const stats = facade.getCacheStats();
      expect(stats).toHaveProperty("entryCacheSize");
      expect(stats).toHaveProperty("queryCacheSize");
    });

    it("should report index stats", () => {
      const stats = facade.getIndexStats();
      expect(stats).toHaveProperty("totalEntries");
    });

    it("should clear caches", () => {
      expect(() => facade.clearCaches()).not.toThrow();
    });
  });

  describe("Export/Import", () => {
    it("should export entries", async () => {
      const data = await facade.exportEntries();
      expect(data.version).toBe("2.0");
      expect(data.entries.length).toBeGreaterThan(0);
    });

    it("should create and verify backup", async () => {
      const backup = await facade.backup("Test backup");
      expect(backup.backupId).toBeDefined();

      const verification = facade.verifyBackup(backup);
      expect(verification.valid).toBe(true);
    });
  });

  describe("Lifecycle", () => {
    it("should cleanup expired memories", async () => {
      const count = await facade.cleanup();
      expect(typeof count).toBe("number");
    });
  });
});