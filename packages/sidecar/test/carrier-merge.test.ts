import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { CarrierRepository } from "../src/services/carrier-service.js";

let tmpDir: string;
let repo: CarrierRepository;

before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "carrier-test-"));
  repo = new CarrierRepository(tmpDir);
});

after(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("CarrierRepository.initAgent()", () => {
  it("creates private carrier files for a fresh agent", async () => {
    await repo.initAgent("agent-init");
    const privDir = join(tmpDir, "agents", "agent-init", "private");
    assert.ok(existsSync(join(privDir, "identity.md")));
    assert.ok(existsSync(join(privDir, "working-style.md")));
    assert.ok(existsSync(join(privDir, "self-model.md")));
  });

  it("is idempotent — calling twice does not overwrite content", async () => {
    await repo.initAgent("agent-idem");
    const selfModelPath = join(tmpDir, "agents", "agent-idem", "private", "self-model.md");
    const before = readFileSync(selfModelPath, "utf8");
    await repo.initAgent("agent-idem");
    const after = readFileSync(selfModelPath, "utf8");
    assert.equal(before, after);
  });
});

describe("CarrierRepository.initProject()", () => {
  it("creates project carrier files", async () => {
    await repo.initProject("agent-p", "project-1");
    const projDir = join(tmpDir, "agents", "agent-p", "projects", "project-1");
    assert.ok(existsSync(join(projDir, "decision-log.md")));
    assert.ok(existsSync(join(projDir, "entities-glossary.md")));
    assert.ok(existsSync(join(projDir, "execution-journal.md")));
  });
});

describe("CarrierRepository.merge() — overwrite strategy", () => {
  it("replaces entire file content", async () => {
    await repo.initAgent("agent-ow");
    await repo.merge({
      agentId: "agent-ow",
      patches: [{ filename: "identity.md", content: "# New Identity\nreplaced" }]
    });
    const content = readFileSync(
      join(tmpDir, "agents", "agent-ow", "private", "identity.md"),
      "utf8"
    );
    assert.equal(content, "# New Identity\nreplaced");
  });
});

describe("CarrierRepository.merge() — append strategy", () => {
  it("appends new content below original with separator", async () => {
    await repo.initAgent("agent-ap");
    await repo.initProject("agent-ap", "proj-ap");
    await repo.merge({
      agentId: "agent-ap",
      projectId: "proj-ap",
      patches: [
        {
          filename: "execution-journal.md",
          content: "## task 1\n**Task:** init\n**Outcome:** done"
        }
      ]
    });
    const content = readFileSync(
      join(tmpDir, "agents", "agent-ap", "projects", "proj-ap", "execution-journal.md"),
      "utf8"
    );
    assert.ok(content.includes("appended:"));
    assert.ok(content.includes("## task 1"));
  });
});

describe("CarrierRepository.merge() — dedup-append strategy", () => {
  it("appends new lines that are not already present", async () => {
    await repo.initAgent("agent-dd");
    await repo.initProject("agent-dd", "proj-dd");
    const patch = { filename: "entities-glossary.md", content: "- **NodeA**: first entity" };
    await repo.merge({ agentId: "agent-dd", projectId: "proj-dd", patches: [patch] });
    await repo.merge({ agentId: "agent-dd", projectId: "proj-dd", patches: [patch] });
    const content = readFileSync(
      join(tmpDir, "agents", "agent-dd", "projects", "proj-dd", "entities-glossary.md"),
      "utf8"
    );
    // Should appear exactly once
    const occurrences = (content.match(/NodeA/g) ?? []).length;
    assert.equal(occurrences, 1);
  });

  it("does append genuinely new lines", async () => {
    await repo.initAgent("agent-dd2");
    await repo.initProject("agent-dd2", "proj-dd2");
    await repo.merge({
      agentId: "agent-dd2",
      projectId: "proj-dd2",
      patches: [{ filename: "entities-glossary.md", content: "- **NodeA**: first" }]
    });
    await repo.merge({
      agentId: "agent-dd2",
      projectId: "proj-dd2",
      patches: [{ filename: "entities-glossary.md", content: "- **NodeB**: second" }]
    });
    const content = readFileSync(
      join(tmpDir, "agents", "agent-dd2", "projects", "proj-dd2", "entities-glossary.md"),
      "utf8"
    );
    assert.ok(content.includes("NodeA"));
    assert.ok(content.includes("NodeB"));
  });

  it("skips low-quality short lines but keeps valid auto-extracted entries", async () => {
    await repo.initAgent("agent-dd3");
    await repo.initProject("agent-dd3", "proj-dd3");
    await repo.merge({
      agentId: "agent-dd3",
      projectId: "proj-dd3",
      patches: [
        {
          filename: "entities-glossary.md",
          content: "- x\n- **DistillService**: (auto-extracted)\n..."
        }
      ]
    });
    const content = readFileSync(
      join(tmpDir, "agents", "agent-dd3", "projects", "proj-dd3", "entities-glossary.md"),
      "utf8"
    );
    assert.ok(!content.includes("- x"));
    assert.ok(!content.includes("\n...\n"));
    assert.ok(content.includes("DistillService"));
  });
});

describe("CarrierRepository.merge() — ordered-accumulate strategy", () => {
  it("prepends new entry after the first heading (newest-first)", async () => {
    await repo.initAgent("agent-oa");
    await repo.initProject("agent-oa", "proj-oa");
    await repo.merge({
      agentId: "agent-oa",
      projectId: "proj-oa",
      patches: [{ filename: "decision-log.md", content: "## 2026-04-15: Use JSONL" }]
    });
    await repo.merge({
      agentId: "agent-oa",
      projectId: "proj-oa",
      patches: [{ filename: "decision-log.md", content: "## 2026-04-16: Use Node test" }]
    });
    const content = readFileSync(
      join(tmpDir, "agents", "agent-oa", "projects", "proj-oa", "decision-log.md"),
      "utf8"
    );
    const idx1 = content.indexOf("2026-04-16");
    const idx2 = content.indexOf("2026-04-15");
    assert.ok(idx1 < idx2, "latest entry should appear before earlier entry");
  });

  it("does not duplicate the same decision entry", async () => {
    await repo.initAgent("agent-oa2");
    await repo.initProject("agent-oa2", "proj-oa2");
    const entry =
      "## 2026-04-16: Use JSONL\n**Context:** Auto-distilled from session\n**Decision:** Use JSONL format for persistent storage\n**Rationale:** See execution journal\n";
    await repo.merge({
      agentId: "agent-oa2",
      projectId: "proj-oa2",
      patches: [{ filename: "decision-log.md", content: entry }]
    });
    await repo.merge({
      agentId: "agent-oa2",
      projectId: "proj-oa2",
      patches: [{ filename: "decision-log.md", content: entry }]
    });
    const content = readFileSync(
      join(tmpDir, "agents", "agent-oa2", "projects", "proj-oa2", "decision-log.md"),
      "utf8"
    );
    const occurrences = (content.match(/Use JSONL format for persistent storage/g) ?? []).length;
    assert.equal(occurrences, 1);
  });
});

describe("CarrierRepository.merge() — conflict-preserve strategy", () => {
  it("appends a new open question with checkbox", async () => {
    await repo.initAgent("agent-cp");
    await repo.initProject("agent-cp", "proj-cp");
    await repo.merge({
      agentId: "agent-cp",
      projectId: "proj-cp",
      patches: [{ filename: "open-questions.md", content: "Should we migrate to Postgres?" }]
    });
    const content = readFileSync(
      join(tmpDir, "agents", "agent-cp", "projects", "proj-cp", "open-questions.md"),
      "utf8"
    );
    assert.ok(content.includes("- [ ]"));
    assert.ok(content.includes("Postgres"));
  });

  it("does not duplicate an identical entry", async () => {
    await repo.initAgent("agent-cp2");
    await repo.initProject("agent-cp2", "proj-cp2");
    const q = "What auth library should we use?";
    await repo.merge({
      agentId: "agent-cp2",
      projectId: "proj-cp2",
      patches: [{ filename: "open-questions.md", content: q }]
    });
    await repo.merge({
      agentId: "agent-cp2",
      projectId: "proj-cp2",
      patches: [{ filename: "open-questions.md", content: q }]
    });
    const content = readFileSync(
      join(tmpDir, "agents", "agent-cp2", "projects", "proj-cp2", "open-questions.md"),
      "utf8"
    );
    const occurrences = (content.match(/auth library/g) ?? []).length;
    assert.equal(occurrences, 1);
  });
});

describe("CarrierRepository.merge() — skipped cases", () => {
  it("skips unknown carrier filenames and returns them in skipped list", async () => {
    await repo.initAgent("agent-skip");
    const result = await repo.merge({
      agentId: "agent-skip",
      patches: [{ filename: "unknown-file.md", content: "data" }]
    });
    assert.ok(result.skipped.some((s) => s.includes("unknown-file.md")));
    assert.equal(result.merged.length, 0);
  });

  it("skips project carrier when projectId is missing", async () => {
    await repo.initAgent("agent-noproj");
    const result = await repo.merge({
      agentId: "agent-noproj",
      patches: [{ filename: "decision-log.md", content: "## decision" }]
    });
    assert.ok(result.skipped.some((s) => s.includes("requires projectId")));
  });
});
