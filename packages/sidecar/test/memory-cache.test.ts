import { describe, it, expect, beforeEach } from "bun:test";
import { MemoryCache } from "../src/core/memory-cache.js";
import { MemoryEntryBuilder } from "../src/models/schema-v2.js";

describe("MemoryCache", () => {
  let cache: MemoryCache;

  const createEntry = (id: string, content: string) => {
    return new MemoryEntryBuilder()
      .id(id)
      .type("fact")
      .content(content)
      .agentId("agent-1")
      .scope("private")
      .visibility("private")
      .build();
  };

  beforeEach(() => {
    cache = new MemoryCache({ maxEntries: 10, queryTtlMs: 100, entryTtlMs: 0 });
  });

  it("should cache and retrieve entries", () => {
    const entry = createEntry("1", "Test");
    cache.setEntry("1", entry);

    const cached = cache.getEntry("1");
    expect(cached).toBeDefined();
    expect(cached?.content).toBe("Test");
  });

  it("should return undefined for missing entries", () => {
    const cached = cache.getEntry("non-existent");
    expect(cached).toBeUndefined();
  });

  it("should cache and retrieve query results", () => {
    const entries = [createEntry("1", "A"), createEntry("2", "B")];
    cache.setQuery("test-query", entries);

    const cached = cache.getQuery("test-query");
    expect(cached).toBeDefined();
    expect(cached?.length).toBe(2);
  });

  it("should invalidate entry cache", () => {
    const entry = createEntry("1", "Test");
    cache.setEntry("1", entry);
    cache.invalidateEntry("1");

    expect(cache.getEntry("1")).toBeUndefined();
  });

  it("should invalidate query caches on entry change", () => {
    const entries = [createEntry("1", "A")];
    cache.setQuery("q1", entries);
    cache.invalidateEntry("1");

    expect(cache.getQuery("q1")).toBeUndefined();
  });

  it("should clear all caches", () => {
    cache.setEntry("1", createEntry("1", "A"));
    cache.setQuery("q1", [createEntry("2", "B")]);
    cache.clear();

    expect(cache.getEntry("1")).toBeUndefined();
    expect(cache.getQuery("q1")).toBeUndefined();
  });

  it("should preload entries", () => {
    const entries = [createEntry("1", "A"), createEntry("2", "B"), createEntry("3", "C")];
    cache.preload(entries);

    expect(cache.getEntry("1")).toBeDefined();
    expect(cache.getEntry("2")).toBeDefined();
    expect(cache.getEntry("3")).toBeDefined();
  });

  it("should report cache stats", () => {
    cache.setEntry("1", createEntry("1", "A"));
    cache.setQuery("q1", [createEntry("2", "B")]);

    const stats = cache.getStats();
    expect(stats.entryCacheSize).toBe(1);
    expect(stats.queryCacheSize).toBe(1);
    expect(stats.totalCached).toBe(2);
  });

  it("should generate consistent query keys", () => {
    const key1 = MemoryCache.generateQueryKey({ text: "test", limit: 10 });
    const key2 = MemoryCache.generateQueryKey({ text: "test", limit: 10 });
    const key3 = MemoryCache.generateQueryKey({ text: "other", limit: 10 });

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });

  it("should respect query TTL", async () => {
    const shortCache = new MemoryCache({ maxEntries: 10, queryTtlMs: 10, entryTtlMs: 0 });
    shortCache.setQuery("q1", [createEntry("1", "A")]);

    expect(shortCache.getQuery("q1")).toBeDefined();

    await new Promise((r) => setTimeout(r, 20));
    expect(shortCache.getQuery("q1")).toBeUndefined();
  });
});