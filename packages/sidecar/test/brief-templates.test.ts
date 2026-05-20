import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getTemplateConfig, formatBriefWithTemplate } from "../src/services/brief-templates.js";

describe("getTemplateConfig()", () => {
  it("returns the code_review template", () => {
    const cfg = getTemplateConfig("code_review");
    assert.deepEqual(cfg.emphasized, ["decision", "pattern"]);
    assert.ok(cfg.includePatterns);
    assert.ok(cfg.headerNote.includes("Code review"));
  });

  it("returns the debug template with entity+unresolved emphasis", () => {
    const cfg = getTemplateConfig("debug");
    assert.deepEqual(cfg.emphasized, ["entity", "unresolved"]);
    assert.equal(cfg.sectionOrder[0], "entity");
  });

  it("returns the architecture template", () => {
    const cfg = getTemplateConfig("architecture");
    assert.deepEqual(cfg.emphasized, ["decision", "entity"]);
    assert.ok(cfg.includePatterns);
  });

  it("returns general template for undefined taskType", () => {
    const cfg = getTemplateConfig(undefined);
    assert.deepEqual(cfg.emphasized, []);
    assert.equal(cfg.includePatterns, false);
    assert.equal(cfg.headerNote, "");
  });

  it("falls back to general for unknown task type", () => {
    const cfg = getTemplateConfig("unknown_type");
    assert.deepEqual(cfg.emphasized, []);
  });

  it("falls back to general for 'other' (ExperienceService compat)", () => {
    const cfg = getTemplateConfig("other");
    assert.deepEqual(cfg.emphasized, []);
  });
});

describe("formatBriefWithTemplate()", () => {
  const entries = [
    { type: "fact", content: "fact-1" },
    { type: "fact", content: "fact-2" },
    { type: "decision", content: "decision-1" },
    { type: "decision", content: "decision-2" },
    { type: "entity", content: "entity-1" },
    { type: "unresolved", content: "unresolved-1" },
    { type: "pattern", content: "pattern-1" },
  ];

  const ctx = { agentId: "a1", projectId: "p1", scope: "project", depth: "l1" };

  it("general template includes all sections", () => {
    const template = getTemplateConfig("general");
    const brief = formatBriefWithTemplate(entries, ctx, template, 20);
    assert.ok(brief.includes("### Facts"));
    assert.ok(brief.includes("### Decisions"));
    assert.ok(brief.includes("### Entities"));
    assert.ok(brief.includes("### Patterns"));
    assert.ok(brief.includes("### Unresolved"));
  });

  it("debug template orders entities before facts", () => {
    const template = getTemplateConfig("debug");
    const brief = formatBriefWithTemplate(entries, { ...ctx, taskType: "debug" }, template, 20);
    const entityPos = brief.indexOf("### Entities");
    const factPos = brief.indexOf("### Facts");
    assert.ok(entityPos < factPos, "Entities should appear before Facts in debug template");
  });

  it("code_review template orders decisions before facts", () => {
    const template = getTemplateConfig("code_review");
    const brief = formatBriefWithTemplate(entries, { ...ctx, taskType: "code_review" }, template, 20);
    const decisionPos = brief.indexOf("### Decisions");
    const factPos = brief.indexOf("### Facts");
    assert.ok(decisionPos < factPos, "Decisions should appear before Facts in code_review template");
  });

  it("documentation template omits unresolved and pattern sections", () => {
    const template = getTemplateConfig("documentation");
    const brief = formatBriefWithTemplate(entries, { ...ctx, taskType: "documentation" }, template, 20);
    assert.ok(!brief.includes("### Unresolved"));
    assert.ok(!brief.includes("### Patterns"));
  });

  it("includes header note for non-general templates", () => {
    const template = getTemplateConfig("debug");
    const brief = formatBriefWithTemplate(entries, { ...ctx, taskType: "debug" }, template, 20);
    assert.ok(brief.includes("Debugging"));
  });

  it("does not include header note for general template", () => {
    const template = getTemplateConfig("general");
    const brief = formatBriefWithTemplate(entries, ctx, template, 20);
    assert.ok(!brief.includes("> Focus:"));
  });

  it("returns empty brief message when no entries", () => {
    const template = getTemplateConfig("debug");
    const brief = formatBriefWithTemplate([], ctx, template, 20);
    assert.ok(brief.includes("No memories found"));
  });

  it("includes Task metadata in header for non-general types", () => {
    const template = getTemplateConfig("debug");
    const brief = formatBriefWithTemplate(entries, { ...ctx, taskType: "debug" }, template, 20);
    assert.ok(brief.includes("Task: debug"));
  });

  it("does not include Task metadata for general type", () => {
    const template = getTemplateConfig("general");
    const brief = formatBriefWithTemplate(entries, { ...ctx, taskType: "general" }, template, 20);
    assert.ok(!brief.includes("Task:"));
  });
});
