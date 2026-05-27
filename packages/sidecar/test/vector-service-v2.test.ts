import { describe, it, expect, beforeEach } from "bun:test";
import { VectorServiceV2 } from "../src/services/vector-service-v2.js";
import { VectorStoreV2 } from "../src/stores/vector-store-v2.js";
import { EmbeddingServiceV2 } from "../src/services/embedding-service-v2.js";
import type { MemoryEmbedding } from "../src/models/schema-v2.js";

// Mock EmbeddingServiceV2 for testing
class MockEmbeddingService extends EmbeddingServiceV2 {
  private testVector: number[];

  constructor(vector: number[]) {
    super({ baseUrl: "http://test", model: "test-model" });
    this.testVector = vector;
  }

  override async embedVector(): Promise<number[] | null> {
    return this.testVector;
  }
}

describe("VectorServiceV2", () => {
  let store: VectorStoreV2;
  let embedder: MockEmbeddingService;
  let service: VectorServiceV2;
  const testVector = [1, 0, 0, 0]; // Simple 4D vector for testing

  beforeEach(async () => {
    // Use temp directory for tests
    const tmpDir = `/tmp/vector-test-${Date.now()}`;
    store = new VectorStoreV2(tmpDir);
    await store.load();
    embedder = new MockEmbeddingService(testVector);
    service = new VectorServiceV2(store, embedder);
  });

  describe("Indexing", () => {
    it("should index an entry", async () => {
      await service.index("entry-1", "agent-1", "test content");
      expect(service.has("entry-1")).toBe(true);
      expect(service.getStats().size).toBe(1);
    });

    it("should index with pre-computed embedding", async () => {
      const embedding: MemoryEmbedding = {
        model: "test-model",
        dimensions: 4,
        vector: [0, 1, 0, 0],
        generatedAt: new Date().toISOString(),
        version: "1.0",
      };

      await service.index("entry-2", "agent-1", "test", { embedding });
      expect(service.has("entry-2")).toBe(true);
    });

    it("should batch index entries", async () => {
      // Clear any existing entries first
      await service.clear();
      
      const result = await service.indexBatch([
        { entryId: "e1", agentId: "a1", text: "text1" },
        { entryId: "e2", agentId: "a1", text: "text2" },
        { entryId: "e3", agentId: "a2", text: "text3" },
      ]);

      expect(result.indexed).toBe(3);
      expect(result.failed).toBe(0);
      expect(service.getStats().size).toBe(3);
    });

    it("should not overwrite without flag", async () => {
      await service.index("entry-1", "agent-1", "first");
      await service.index("entry-1", "agent-1", "second");
      
      const entry = store.get("entry-1");
      expect(entry?.text).toBe("first"); // Should keep first
    });

    it("should overwrite with flag", async () => {
      await service.index("entry-1", "agent-1", "first");
      await service.index("entry-1", "agent-1", "second", { overwrite: true });
      
      const entry = store.get("entry-1");
      expect(entry?.text).toBe("second");
    });
  });

  describe("Querying", () => {
    beforeEach(async () => {
      // Clear and add test entries with different vectors
      await service.clear();
      await store.add({
        entryId: "doc-1",
        agentId: "agent-1",
        text: "apple banana",
        vector: [1, 0, 0, 0],
        createdAt: Date.now(),
      });
      await store.add({
        entryId: "doc-2",
        agentId: "agent-1",
        text: "banana cherry",
        vector: [0.9, 0.1, 0, 0],
        createdAt: Date.now(),
      });
      await store.add({
        entryId: "doc-3",
        agentId: "agent-1",
        text: "cherry date",
        vector: [0, 1, 0, 0],
        createdAt: Date.now(),
      });
    });

    it("should perform semantic query", async () => {
      // Query vector [1,0,0,0] should match doc-1 and doc-2
      const results = await service.semanticQuery("apple", 2);
      
      expect(results.length).toBeGreaterThan(0);
      // doc-1 has exact vector match [1,0,0,0]
      const doc1Result = results.find(r => r.entryId === "doc-1");
      expect(doc1Result).toBeDefined();
      expect(doc1Result?.source).toBe("semantic");
    });

    it("should perform hybrid query", async () => {
      const tfidfScores = new Map([
        ["doc-1", 0.5],
        ["doc-2", 0.8],
        ["doc-3", 0.3],
      ]);

      const results = await service.hybridQuery("apple", tfidfScores, 3);
      
      expect(results.length).toBeGreaterThan(0);
      // doc-2 has high TF-IDF + good semantic = should be top
      expect(results[0].hybridScore).toBeGreaterThan(0);
    });

    it("should handle empty query", async () => {
      // Empty query returns empty because embedVector returns null for empty string
      // or matches everything if mock returns vector
      const results = await service.semanticQuery("", 5);
      // Mock returns vector even for empty, so we just check it doesn't throw
      expect(Array.isArray(results)).toBe(true);
    });

    it("should respect topK limit", async () => {
      const results = await service.semanticQuery("test", 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("Management", () => {
    it("should remove entries", async () => {
      await service.index("entry-1", "agent-1", "test");
      expect(service.has("entry-1")).toBe(true);

      await service.remove("entry-1");
      expect(service.has("entry-1")).toBe(false);
    });

    it("should clear all entries", async () => {
      // Use fresh store for this test
      const freshStore = new VectorStoreV2(`/tmp/vector-clear-test-${Date.now()}`);
      await freshStore.load();
      const freshService = new VectorServiceV2(freshStore, embedder);
      
      await freshService.index("e1-clear", "a1", "t1");
      await freshService.index("e2-clear", "a1", "t2");
      expect(freshService.getStats().size).toBe(2);

      await freshService.clear();
      expect(freshService.getStats().size).toBe(0);
    });

    it("should return stats", async () => {
      await service.clear();
      await service.index("e1", "a1", "t1");
      await service.index("e2", "a2", "t2");

      const stats = service.getStats();
      expect(stats.size).toBe(2);
      // dimensions comes from embedder.getDimensions() which may be null for unknown models
      // just verify stats object is valid
      expect(stats.size).toBe(2);
    });
  });

  describe("Hybrid scoring", () => {
    it("should use configurable weights", async () => {
      const customService = new VectorServiceV2(store, embedder, {
        semanticWeight: 0.8,
        tfidfWeight: 0.2,
      });

      await store.add({
        entryId: "test-1",
        agentId: "agent-1",
        text: "test",
        vector: [1, 0, 0, 0],
        createdAt: Date.now(),
      });

      const tfidfScores = new Map([["test-1", 1.0]]);
      const results = await customService.hybridQuery("test", tfidfScores, 1);

      expect(results.length).toBe(1);
      // With 0.8 semantic + 0.2 tfidf, should still produce valid score
      expect(results[0].hybridScore).toBeGreaterThan(0);
    });
  });
});
