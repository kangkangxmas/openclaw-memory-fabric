import { describe, it, expect } from "bun:test";
import {
  MemoryEntryBuilder,
  generateMemoryId,
  getMemoryAgeDays,
  isMemoryExpired,
  getMemoryText,
  touchMemory,
  migrateV1ToV2,
  downgradeV2ToV1,
  validateMemoryEntryV2,
  type MemoryEntryV1,
  type MemoryEntryV2,
} from "../src/models/schema-v2.js";

describe("Schema V2", () => {
  describe("MemoryEntryBuilder", () => {
    it("should build a basic V2 entry", () => {
      const entry = new MemoryEntryBuilder()
        .id("mem-123")
        .type("fact")
        .content("Test content")
        .agentId("agent-1")
        .scope("project")
        .visibility("private")
        .build();

      expect(entry.id).toBe("mem-123");
      expect(entry.type).toBe("fact");
      expect(entry.content).toBe("Test content");
      expect(entry.agentId).toBe("agent-1");
      expect(entry.scope).toBe("project");
      expect(entry.visibility).toBe("private");
      expect(entry.timeline.version).toBe(1);
      expect(entry.metadata.tags).toEqual([]);
    });

    it("should auto-generate timestamps", () => {
      const entry = new MemoryEntryBuilder()
        .id("mem-123")
        .type("fact")
        .content("Test")
        .agentId("agent-1")
        .scope("project")
        .visibility("private")
        .build();

      expect(entry.timeline.createdAt).toBeDefined();
      expect(entry.timeline.updatedAt).toBeDefined();
      expect(new Date(entry.timeline.createdAt).getTime()).toBeGreaterThan(0);
    });

    it("should support content blocks", () => {
      const entry = new MemoryEntryBuilder()
        .id("mem-123")
        .type("code")
        .content("Function summary")
        .agentId("agent-1")
        .scope("project")
        .visibility("private")
        .block("code", "const x = 1;", "typescript")
        .block("markdown", "# Docs")
        .build();

      expect(entry.blocks).toHaveLength(2);
      expect(entry.blocks?.[0].format).toBe("code");
      expect(entry.blocks?.[0].language).toBe("typescript");
      expect(entry.blocks?.[1].format).toBe("markdown");
    });

    it("should support relations", () => {
      const entry = new MemoryEntryBuilder()
        .id("mem-123")
        .type("fact")
        .content("Test")
        .agentId("agent-1")
        .scope("project")
        .visibility("private")
        .relation({ type: "related", targetId: "mem-456", strength: 0.8 })
        .relation({ type: "parent", targetId: "mem-789", strength: 1.0 })
        .build();

      expect(entry.relations).toHaveLength(2);
      expect(entry.relations?.[0].targetId).toBe("mem-456");
    });

    it("should support sources", () => {
      const entry = new MemoryEntryBuilder()
        .id("mem-123")
        .type("fact")
        .content("Test")
        .agentId("agent-1")
        .scope("project")
        .visibility("private")
        .source({ type: "session", identifier: "sess-1", timestamp: new Date().toISOString() })
        .build();

      expect(entry.sources).toHaveLength(1);
      expect(entry.sources?.[0].type).toBe("session");
    });

    it("should support tags and metadata", () => {
      const entry = new MemoryEntryBuilder()
        .id("mem-123")
        .type("fact")
        .content("Test")
        .agentId("agent-1")
        .scope("project")
        .visibility("private")
        .tag("important")
        .tag("review")
        .metadata({ priority: 8, domain: "backend" })
        .build();

      expect(entry.metadata.tags).toContain("important");
      expect(entry.metadata.tags).toContain("review");
      expect(entry.metadata.priority).toBe(8);
      expect(entry.metadata.domain).toBe("backend");
    });

    it("should throw on missing required fields", () => {
      expect(() => new MemoryEntryBuilder().build()).toThrow("requires id");
      expect(() => new MemoryEntryBuilder().id("x").build()).toThrow("requires type");
    });
  });

  describe("Utility Functions", () => {
    it("should generate unique IDs", () => {
      const id1 = generateMemoryId();
      const id2 = generateMemoryId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^mem-/);
    });

    it("should calculate memory age", () => {
      const entry = new MemoryEntryBuilder()
        .id("mem-123")
        .type("fact")
        .content("Test")
        .agentId("agent-1")
        .scope("project")
        .visibility("private")
        .timeline({
          createdAt: new Date(Date.now() - 86400000).toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
        })
        .build();

      const age = getMemoryAgeDays(entry);
      expect(age).toBeGreaterThan(0.9);
      expect(age).toBeLessThan(1.1);
    });

    it("should detect expired memories", () => {
      const expired = new MemoryEntryBuilder()
        .id("mem-123")
        .type("fact")
        .content("Test")
        .agentId("agent-1")
        .scope("project")
        .visibility("private")
        .timeline({
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        })
        .build();

      const active = new MemoryEntryBuilder()
        .id("mem-124")
        .type("fact")
        .content("Test")
        .agentId("agent-1")
        .scope("project")
        .visibility("private")
        .build();

      expect(isMemoryExpired(expired)).toBe(true);
      expect(isMemoryExpired(active)).toBe(false);
    });

    it("should get full text from blocks", () => {
      const entry = new MemoryEntryBuilder()
        .id("mem-123")
        .type("code")
        .content("Summary")
        .agentId("agent-1")
        .scope("project")
        .visibility("private")
        .block("code", "const x = 1;", "typescript")
        .block("markdown", "Details")
        .build();

      const text = getMemoryText(entry);
      expect(text).toContain("Summary");
      expect(text).toContain("const x = 1;");
      expect(text).toContain("Details");
    });

    it("should touch memory (update access stats)", () => {
      const entry = new MemoryEntryBuilder()
        .id("mem-123")
        .type("fact")
        .content("Test")
        .agentId("agent-1")
        .scope("project")
        .visibility("private")
        .build();

      const touched = touchMemory(entry);
      expect(touched.metadata.accessCount).toBe(1);
      expect(touched.timeline.version).toBe(2);
      expect(touched.metadata.lastAccessedAt).toBeDefined();
    });
  });

  describe("Migration", () => {
    it("should migrate V1 to V2", () => {
      const v1: MemoryEntryV1 = {
        id: "mem-old",
        type: "decision",
        content: "Important decision",
        agentId: "agent-1",
        scope: "project",
        visibility: "private",
        createdAt: "2024-01-01T00:00:00Z",
        tags: ["critical"],
      };

      const v2 = migrateV1ToV2(v1);

      expect(v2.id).toBe(v1.id);
      expect(v2.type).toBe(v1.type);
      expect(v2.content).toBe(v1.content);
      expect(v2.timeline.createdAt).toBe(v1.createdAt);
      expect(v2.timeline.version).toBe(1);
      expect(v2.metadata.tags).toEqual(v1.tags);
    });

    it("should downgrade V2 to V1", () => {
      const v2 = new MemoryEntryBuilder()
        .id("mem-123")
        .type("fact")
        .content("Test")
        .agentId("agent-1")
        .scope("project")
        .visibility("private")
        .build();

      const v1 = downgradeV2ToV1(v2);

      expect(v1.id).toBe(v2.id);
      expect(v1.type).toBe(v2.type);
      expect(v1.content).toBe(v2.content);
      expect(v1.createdAt).toBe(v2.timeline.createdAt);
      expect(v1.tags).toEqual(v2.metadata.tags);
    });

    it("should validate V2 entries", () => {
      const valid = new MemoryEntryBuilder()
        .id("mem-123")
        .type("fact")
        .content("Test")
        .agentId("agent-1")
        .scope("project")
        .visibility("private")
        .build();

      expect(validateMemoryEntryV2(valid)).toBe(true);
      expect(validateMemoryEntryV2({})).toBe(false);
      expect(validateMemoryEntryV2(null)).toBe(false);
    });
  });
});
