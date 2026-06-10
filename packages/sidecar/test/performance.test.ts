import { describe, it, expect } from "./test-helpers.js";
import { MemoryCoreV2 } from "../src/core/memory-core-v2.js";
import { MemoryIndex } from "../src/core/memory-index.js";
import { MemoryEntryBuilder } from "../src/models/schema-v2.js";

describe("Performance Benchmarks", () => {
  const createEntry = (i: number) => {
    const types = ["fact", "decision", "entity", "pattern", "lesson"] as const;
    return new MemoryEntryBuilder()
      .id(`bench-${i}`)
      .type(types[i % types.length])
      .content(`Benchmark entry ${i}: This is a test memory about topic ${i % 10} with some keywords like recipe, project, decision, pattern`)
      .agentId(`agent-${i % 5}`)
      .scope("private")
      .visibility("private")
      .tag(`tag-${i % 20}`)
      .tag(`category-${i % 5}`)
      .build();
  };

  describe("MemoryIndex Performance", () => {
    it("should build index for 1000 entries under 100ms", () => {
      const entries = Array.from({ length: 1000 }, (_, i) => createEntry(i));
      const index = new MemoryIndex();

      const start = Date.now();
      index.build(entries);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
      expect(index.getStats().totalEntries).toBe(1000);
    });

    it("should search 1000 entries under 5ms", () => {
      const entries = Array.from({ length: 1000 }, (_, i) => createEntry(i));
      const index = new MemoryIndex();
      index.build(entries);

      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        index.searchText("recipe");
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50); // 100 queries under 50ms total
    });

    it("should filter by type for 1000 entries under 5ms", () => {
      const entries = Array.from({ length: 1000 }, (_, i) => createEntry(i));
      const index = new MemoryIndex();
      index.build(entries);

      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        index.filterByType("decision");
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });

    it("should handle combined queries for 1000 entries under 10ms", () => {
      const entries = Array.from({ length: 1000 }, (_, i) => createEntry(i));
      const index = new MemoryIndex();
      index.build(entries);

      const start = Date.now();
      for (let i = 0; i < 50; i++) {
        index.query({
          text: "recipe",
          types: ["fact"],
          agentId: "agent-1",
        });
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
    });
  });

  describe("MemoryCoreV2 Performance", () => {
    it("should create 100 entries under 500ms", async () => {
      const core = new MemoryCoreV2({
        mode: "local",
        basePath: "/tmp/bench-core",
        targetRoot: "bench",
      });

      try {
        const { rmdir } = await import("fs/promises");
        await rmdir("/tmp/bench-core", { recursive: true });
      } catch {}

      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        await core.create({
          content: `Benchmark entry ${i}`,
          agentId: `agent-${i % 5}`,
          type: (["fact", "decision"] as const)[i % 2],
        });
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500);
    });

    it("should query 100 entries under 200ms", async () => {
      const core = new MemoryCoreV2({
        mode: "local",
        basePath: "/tmp/bench-query",
        targetRoot: "bench",
      });

      try {
        const { rmdir } = await import("fs/promises");
        await rmdir("/tmp/bench-query", { recursive: true });
      } catch {}

      // Seed data
      for (let i = 0; i < 100; i++) {
        await core.create({
          content: `Benchmark entry ${i} about recipe and project`,
          agentId: `agent-${i % 5}`,
          type: (["fact", "decision"] as const)[i % 2],
        });
      }

      const start = Date.now();
      for (let i = 0; i < 10; i++) {
        await core.query({ text: "recipe" });
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(200);
    });
  });
});
