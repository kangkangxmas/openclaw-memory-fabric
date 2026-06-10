import { describe, it, expect } from "./test-helpers.js";
import { MemoryIndex } from "../src/core/memory-index.js";
import { MemoryEntryBuilder } from "../src/models/schema-v2.js";

describe("MemoryIndex", () => {
  const createEntry = (id: string, content: string, type: string, agentId: string, tags?: string[]) => {
    const builder = new MemoryEntryBuilder()
      .id(id)
      .type(type as any)
      .content(content)
      .agentId(agentId)
      .scope("private")
      .visibility("private");
    tags?.forEach((tag) => builder.tag(tag));
    return builder.build();
  };

  it("should build index from entries", () => {
    const index = new MemoryIndex();
    const entries = [
      createEntry("1", "Apple pie recipe", "fact", "agent-1", ["recipe", "dessert"]),
      createEntry("2", "Banana bread recipe", "fact", "agent-1", ["recipe", "baking"]),
      createEntry("3", "Important decision", "decision", "agent-2", ["work"]),
    ];

    index.build(entries);

    const stats = index.getStats();
    expect(stats.totalEntries).toBe(3);
    expect(stats.types).toBe(2);
    expect(stats.tags).toBe(4);
    expect(stats.agents).toBe(2);
  });

  it("should search by text", () => {
    const index = new MemoryIndex();
    const entries = [
      createEntry("1", "Apple pie recipe", "fact", "agent-1"),
      createEntry("2", "Banana bread recipe", "fact", "agent-1"),
      createEntry("3", "Project roadmap", "entity", "agent-2"),
    ];

    index.build(entries);

    const results = index.searchText("recipe");
    expect(results).toContain("1");
    expect(results).toContain("2");
    expect(results).not.toContain("3");
  });

  it("should rank partial multi-token text matches by relevance", () => {
    const index = new MemoryIndex();
    const entries = [
      createEntry("1", "OpenViking mode local configuration", "fact", "agent-1"),
      createEntry("2", "OpenViking storage migration", "fact", "agent-1"),
      createEntry("3", "Carrier projection rollback", "decision", "agent-1"),
    ];

    index.build(entries);

    const results = index.searchText("openviking local");
    expect(results[0]).toBe("1");
    expect(results).toContain("2");
    expect(results).not.toContain("3");
  });

  it("should search Chinese text with CJK bigrams", () => {
    const index = new MemoryIndex();
    const entries = [
      createEntry("1", "L0 事件账本需要记录 event_id、content_hash、source_uri", "fact", "agent-1"),
      createEntry("2", "测试配置里的 openviking.mode 应该是 local", "fact", "agent-1"),
    ];

    index.build(entries);

    const results = index.searchText("L0 事件账本需要记录哪些字段");
    expect(results[0]).toBe("1");
    expect(results).not.toContain("2");
  });

  it("should filter by type", () => {
    const index = new MemoryIndex();
    const entries = [
      createEntry("1", "Fact 1", "fact", "agent-1"),
      createEntry("2", "Decision 1", "decision", "agent-1"),
      createEntry("3", "Fact 2", "fact", "agent-2"),
    ];

    index.build(entries);

    const results = index.filterByType("fact");
    expect(results).toContain("1");
    expect(results).toContain("3");
    expect(results).not.toContain("2");
  });

  it("should filter by tag", () => {
    const index = new MemoryIndex();
    const entries = [
      createEntry("1", "Entry 1", "fact", "agent-1", ["important"]),
      createEntry("2", "Entry 2", "fact", "agent-1", ["urgent"]),
      createEntry("3", "Entry 3", "fact", "agent-2", ["important"]),
    ];

    index.build(entries);

    const results = index.filterByTag("important");
    expect(results).toContain("1");
    expect(results).toContain("3");
    expect(results).not.toContain("2");
  });

  it("should filter by agent", () => {
    const index = new MemoryIndex();
    const entries = [
      createEntry("1", "Entry 1", "fact", "agent-1"),
      createEntry("2", "Entry 2", "fact", "agent-2"),
    ];

    index.build(entries);

    const results = index.filterByAgent("agent-1");
    expect(results).toContain("1");
    expect(results).not.toContain("2");
  });

  it("should support combined queries", () => {
    const index = new MemoryIndex();
    const entries = [
      createEntry("1", "Apple pie recipe", "fact", "agent-1", ["dessert"]),
      createEntry("2", "Banana bread recipe", "fact", "agent-1", ["baking"]),
      createEntry("3", "Project decision", "decision", "agent-2", ["work"]),
    ];

    index.build(entries);

    const results = index.query({
      text: "recipe",
      types: ["fact"],
      agentId: "agent-1",
    });

    expect(results).toContain("1");
    expect(results).toContain("2");
    expect(results).not.toContain("3");
  });

  it("should handle add/remove/update", () => {
    const index = new MemoryIndex();
    const entry = createEntry("1", "Test entry", "fact", "agent-1");

    index.add(entry);
    expect(index.getStats().totalEntries).toBe(1);

    index.remove("1");
    expect(index.getStats().totalEntries).toBe(0);

    index.add(entry);
    const updated = { ...entry, content: "Updated" };
    index.update(updated);
    expect(index.getStats().totalEntries).toBe(1);
  });

  it("should filter by time range", () => {
    const index = new MemoryIndex();
    const entries = [
      createEntry("1", "Old entry", "fact", "agent-1"),
      createEntry("2", "Recent entry", "fact", "agent-1"),
    ];

    // Modify timestamps
    entries[0].timeline.createdAt = "2024-01-01T00:00:00Z";
    entries[1].timeline.createdAt = "2024-06-01T00:00:00Z";

    index.build(entries);

    const results = index.filterByTime("2024-05-01T00:00:00Z");
    expect(results).toContain("2");
    expect(results).not.toContain("1");
  });
});
