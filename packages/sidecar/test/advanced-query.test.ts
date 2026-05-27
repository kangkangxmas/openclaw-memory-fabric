import { describe, it, expect } from "bun:test";
import { AdvancedQuery } from "../src/core/advanced-query.js";
import { MemoryEntryBuilder } from "../src/models/schema-v2.js";

describe("AdvancedQuery", () => {
  const createEntry = (id: string, content: string, type: string, agentId: string, tags?: string[], priority?: number) => {
    const builder = new MemoryEntryBuilder()
      .id(id)
      .type(type as any)
      .content(content)
      .agentId(agentId)
      .scope("private")
      .visibility("private");
    tags?.forEach((t) => builder.tag(t));
    const entry = builder.build();
    if (priority !== undefined) entry.metadata.priority = priority;
    return entry;
  };

  const entries = [
    createEntry("1", "Apple pie recipe", "fact", "agent-1", ["recipe"], 3),
    createEntry("2", "Banana bread recipe", "fact", "agent-1", ["recipe"], 5),
    createEntry("3", "Architecture decision", "decision", "agent-2", ["work"], 8),
    createEntry("4", "API pattern", "pattern", "agent-2", ["code"], 7),
    createEntry("5", "Bug lesson learned", "lesson", "agent-1", ["bug"], 2),
  ];

  const aq = new AdvancedQuery();

  it("should aggregate count", () => {
    const result = aq.aggregate(entries, { field: "id", op: "count" });
    expect(result.value).toBe(5);
  });

  it("should aggregate sum", () => {
    const result = aq.aggregate(entries, { field: "metadata.priority", op: "sum" });
    expect(result.value).toBe(25);
  });

  it("should aggregate avg", () => {
    const result = aq.aggregate(entries, { field: "metadata.priority", op: "avg" });
    expect(result.value).toBe(5);
  });

  it("should aggregate min/max", () => {
    const min = aq.aggregate(entries, { field: "metadata.priority", op: "min" });
    const max = aq.aggregate(entries, { field: "metadata.priority", op: "max" });
    expect(min.value).toBe(2);
    expect(max.value).toBe(8);
  });

  it("should aggregate with grouping", () => {
    const result = aq.aggregateGrouped(entries, { field: "id", op: "count" }, "agentId");
    expect(result.groups).toBeDefined();
    expect(result.groups!.length).toBe(2);
  });

  it("should group entries by type", () => {
    const groups = aq.group(entries, "type");
    expect(groups.length).toBe(4); // fact, decision, pattern, lesson
    const facts = groups.find((g) => g.key === "fact");
    expect(facts?.count).toBe(2);
  });

  it("should group entries by agent", () => {
    const groups = aq.group(entries, "agentId");
    expect(groups.length).toBe(2);
  });

  it("should generate facets", () => {
    const facets = aq.facets(entries, ["type", "agentId"]);
    expect(facets.length).toBe(2);
    expect(facets[0].values.length).toBeGreaterThan(0);
  });

  it("should deduplicate exact entries", () => {
    const dupEntries = [
      createEntry("1", "Same content", "fact", "agent-1"),
      createEntry("2", "Same content", "fact", "agent-1"),
      createEntry("3", "Different content", "fact", "agent-1"),
    ];

    const result = aq.deduplicate(dupEntries);
    expect(result.totalBefore).toBe(3);
    expect(result.totalAfter).toBe(2);
    expect(result.duplicates).toHaveLength(1);
  });

  it("should deduplicate by custom field", () => {
    const dupEntries = [
      createEntry("1", "Content A", "fact", "agent-1"),
      createEntry("2", "Content B", "fact", "agent-1"),
    ];

    const result = aq.deduplicate(dupEntries, { keyField: "agentId" });
    expect(result.totalAfter).toBe(1); // Same agentId
  });
});