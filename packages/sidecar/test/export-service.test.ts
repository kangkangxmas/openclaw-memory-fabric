import { describe, it, expect } from "./test-helpers.js";
import { ExportService } from "../src/core/export-service.js";
import { MemoryEntryBuilder } from "../src/models/schema-v2.js";

describe("ExportService", () => {
  const createEntry = (id: string, content: string, agentId: string) => {
    return new MemoryEntryBuilder()
      .id(id)
      .type("fact")
      .content(content)
      .agentId(agentId)
      .scope("private")
      .visibility("private")
      .build();
  };

  const entries = [
    createEntry("1", "Entry 1", "agent-1"),
    createEntry("2", "Entry 2", "agent-1"),
    createEntry("3", "Entry 3", "agent-2"),
  ];

  it("should export entries to JSON", () => {
    const service = new ExportService("test-instance");
    const data = service.export(entries);

    expect(data.version).toBe("2.0");
    expect(data.entryCount).toBe(3);
    expect(data.entries).toHaveLength(3);
    expect(data.sourceId).toBe("test-instance");
  });

  it("should export with agent filter", () => {
    const service = new ExportService();
    const data = service.export(entries, { agentIds: ["agent-1"] });

    expect(data.entryCount).toBe(2);
    expect(data.entries.every((e) => e.agentId === "agent-1")).toBe(true);
  });

  it("should export with type filter", () => {
    const service = new ExportService();
    const data = service.export(entries, { types: ["fact"] });

    expect(data.entryCount).toBe(3);
  });

  it("should include metadata in export", () => {
    const service = new ExportService();
    const data = service.export(entries, { includeMetadata: true });

    expect(data.metadata).toBeDefined();
    expect(data.metadata?.agentIds).toContain("agent-1");
    expect(data.metadata?.agentIds).toContain("agent-2");
  });

  it("should serialize to JSON format", () => {
    const service = new ExportService();
    const data = service.export(entries);
    const serialized = service.serialize(data, "json");

    expect(serialized).toContain('"version": "2.0"');
    expect(serialized).toContain('"entryCount": 3');
  });

  it("should serialize to JSONL format", () => {
    const service = new ExportService();
    const data = service.export(entries);
    const serialized = service.serialize(data, "jsonl");

    const lines = serialized.split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain("Entry 1");
  });

  it("should import entries with no conflicts", () => {
    const service = new ExportService();
    const data = service.export(entries);
    const existing: typeof entries = [];

    const result = service.import(data, existing, { validate: false });
    expect(result.imported).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
  });

  it("should skip existing entries on import", () => {
    const service = new ExportService();
    const data = service.export(entries);

    const result = service.import(data, entries, { conflictStrategy: "skip", validate: false });
    expect(result.skipped).toHaveLength(3);
    expect(result.imported).toHaveLength(0);
  });

  it("should overwrite existing entries on import", () => {
    const service = new ExportService();
    const data = service.export(entries);

    const result = service.import(data, entries, { conflictStrategy: "overwrite", validate: false });
    expect(result.overwritten).toHaveLength(3);
  });

  it("should create and verify backup", () => {
    const service = new ExportService();
    const backup = service.backup(entries, "Test backup");

    expect(backup.backupId).toBeDefined();
    expect(backup.description).toBe("Test backup");
    expect(backup.checksum).toBeDefined();

    const verification = service.verifyBackup(backup);
    expect(verification.valid).toBe(true);
  });

  it("should detect corrupted backup", () => {
    const service = new ExportService();
    const backup = service.backup(entries);

    // Tamper with entries
    backup.entries = [...backup.entries, createEntry("fake", "Fake", "agent-1")];

    const verification = service.verifyBackup(backup);
    expect(verification.valid).toBe(false);
  });

  it("should parse JSON format", () => {
    const service = new ExportService();
    const data = service.export(entries);
    const serialized = service.serialize(data, "json");

    const parsed = service.parse(serialized, "json");
    expect(parsed.entryCount).toBe(3);
    expect(parsed.entries).toHaveLength(3);
  });

  it("should parse JSONL format", () => {
    const service = new ExportService();
    const data = service.export(entries);
    const serialized = service.serialize(data, "jsonl");

    const parsed = service.parse(serialized, "jsonl");
    expect(parsed.entries).toHaveLength(3);
  });
});