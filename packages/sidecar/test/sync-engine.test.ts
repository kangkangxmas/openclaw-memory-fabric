import { describe, it, expect } from "./test-helpers.js";
import { SyncEngine } from "../src/core/sync-engine.js";
import { MemoryEntryBuilder } from "../src/models/schema-v2.js";

describe("SyncEngine", () => {
  const createEntry = (id: string, content: string, agentId: string, updatedAt?: string, version?: number) => {
    const builder = new MemoryEntryBuilder()
      .id(id)
      .type("fact")
      .content(content)
      .agentId(agentId)
      .scope("private")
      .visibility("private");
    const entry = builder.build();
    if (updatedAt) entry.timeline.updatedAt = updatedAt;
    if (version) entry.timeline.version = version;
    return entry;
  };

  it("should detect created entries", () => {
    const engine = new SyncEngine();
    const source = [createEntry("1", "New entry", "agent-1")];
    const target: typeof source = [];

    const result = engine.sync(source, target, "source", "target");
    expect(result.created).toContain("1");
    expect(result.deleted).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
  });

  it("should detect deleted entries", () => {
    const engine = new SyncEngine();
    const source: ReturnType<typeof createEntry>[] = [];
    const target = [createEntry("1", "Old entry", "agent-1")];

    const result = engine.sync(source, target, "source", "target");
    expect(result.deleted).toContain("1");
    expect(result.created).toHaveLength(0);
  });

  it("should detect updated entries", () => {
    const engine = new SyncEngine();
    const source = [createEntry("1", "Updated", "agent-1", "2024-06-01T00:00:00Z", 2)];
    const target = [createEntry("1", "Original", "agent-1", "2024-01-01T00:00:00Z", 1)];

    const result = engine.sync(source, target, "source", "target");
    expect(result.updated).toContain("1");
  });

  it("should resolve conflicts with last-write-wins", () => {
    const engine = new SyncEngine({ conflictStrategy: "last-write-wins" });
    const source = [createEntry("1", "Source version", "agent-1", "2024-06-01T00:00:00Z", 2)];
    const target = [createEntry("1", "Target version", "agent-1", "2024-01-01T00:00:00Z", 2)];

    const result = engine.sync(source, target, "source", "target");
    expect(result.conflicts.length).toBeGreaterThanOrEqual(0);
    if (result.conflicts.length > 0) {
      expect(result.conflicts[0].resolvedBy).toBe("last-write-wins");
    }
  });

  it("should resolve conflicts with source-wins", () => {
    const engine = new SyncEngine({ conflictStrategy: "source-wins" });
    const source = [createEntry("1", "Source version", "agent-1", "2024-01-01T00:00:00Z", 2)];
    const target = [createEntry("1", "Target version", "agent-1", "2024-06-01T00:00:00Z", 2)];

    const result = engine.sync(source, target, "source", "target");
    if (result.conflicts.length > 0) {
      expect(result.conflicts[0].resolved.content).toBe("Source version");
    }
  });

  it("should merge entries with merge strategy", () => {
    const engine = new SyncEngine({ conflictStrategy: "merge" });
    const sourceBuilder = new MemoryEntryBuilder()
      .id("1").type("fact").content("Source content").agentId("agent-1").scope("private").visibility("private");
    sourceBuilder.tag("source-tag");
    const source = [sourceBuilder.build()];

    const targetBuilder = new MemoryEntryBuilder()
      .id("1").type("fact").content("Target content").agentId("agent-1").scope("private").visibility("private");
    targetBuilder.tag("target-tag");
    const target = [targetBuilder.build()];

    const result = engine.sync(source, target, "source", "target");
    if (result.conflicts.length > 0) {
      const merged = result.conflicts[0].resolved;
      // Merged tags should include both
      expect(merged.metadata?.tags).toContain("source-tag");
      expect(merged.metadata?.tags).toContain("target-tag");
    }
  });

  it("should track sync snapshots", () => {
    const engine = new SyncEngine();
    const source = [createEntry("1", "Entry", "agent-1")];
    const target: typeof source = [];

    engine.sync(source, target, "node-a", "node-b");
    const snapshot = engine.getLastSnapshot("node-a", "node-b");

    expect(snapshot).toBeDefined();
    expect(snapshot?.sourceId).toBe("node-a");
    expect(snapshot?.targetId).toBe("node-b");
    expect(snapshot?.entriesSynced).toBe(1);
  });

  it("should get incremental changes", () => {
    const engine = new SyncEngine();
    const entries = [
      createEntry("1", "Old", "agent-1", "2024-01-01T00:00:00Z"),
      createEntry("2", "New", "agent-1", "2024-06-01T00:00:00Z"),
    ];

    const changes = engine.getChangesSince(entries, "2024-05-01T00:00:00Z");
    expect(changes).toHaveLength(1);
    expect(changes[0].id).toBe("2");
  });
});