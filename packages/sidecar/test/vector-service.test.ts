import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { VectorService } from "../src/services/vector-service.js";
import { VectorStore } from "../src/stores/vector-store.js";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "mf-test-"));
}

// Mock embedder that returns deterministic vectors
class MockEmbedder {
  async embed(text: string): Promise<number[] | null> {
    // Simple hash-based vector for determinism
    const vec = new Array(4).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % 4] += text.charCodeAt(i);
    }
    // Normalize
    const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0));
    return vec.map((v) => v / (norm || 1));
  }
}

describe("VectorService.semanticQuery()", () => {
  it("returns empty when no vectors indexed", async () => {
    const dir = makeTempDir();
    const store = new VectorStore(dir);
    await store.load();
    const svc = new VectorService(store, new MockEmbedder() as any);

    const results = await svc.semanticQuery("test");
    assert.equal(results.length, 0);

    rmSync(dir, { recursive: true });
  });

  it("finds similar vectors", async () => {
    const dir = makeTempDir();
    const store = new VectorStore(dir);
    await store.load();
    const svc = new VectorService(store, new MockEmbedder() as any);

    await svc.index("id-1", "agent-a", "hello world");
    await svc.index("id-2", "agent-a", "hello there");
    await svc.index("id-3", "agent-a", "completely different topic");

    const results = await svc.semanticQuery("hello world", 2);
    assert.equal(results.length, 2);
    // id-1 should be most similar to "hello world"
    assert.equal(results[0].entryId, "id-1");
    assert.ok(results[0].hybridScore > 0);

    rmSync(dir, { recursive: true });
  });
});

describe("VectorService.hybridQuery()", () => {
  it("combines semantic and tfidf scores", async () => {
    const dir = makeTempDir();
    const store = new VectorStore(dir);
    await store.load();
    const svc = new VectorService(store, new MockEmbedder() as any);

    await svc.index("id-1", "agent-a", "test content");
    await svc.index("id-2", "agent-a", "other stuff");

    const tfidf = new Map<string, number>();
    tfidf.set("id-1", 0.5);
    tfidf.set("id-2", 0.8);

    const results = await svc.hybridQuery("test", tfidf, 2);
    assert.equal(results.length, 2);

    // Both scores should be present
    assert.ok(results[0].semanticScore >= 0);
    assert.ok(results[0].tfidfScore >= 0);
    assert.ok(results[0].hybridScore > 0);

    rmSync(dir, { recursive: true });
  });
});
