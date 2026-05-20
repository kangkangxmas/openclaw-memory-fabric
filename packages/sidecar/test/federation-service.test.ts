import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { FederationService } from "../src/services/federation-service.js";

describe("FederationService", () => {
  let tmpDir: string;
  let svc: FederationService;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "federation-"));
    svc = new FederationService(tmpDir);
  });

  after(async () => {
    await rm(tmpDir, { recursive: true });
  });

  describe("F1: export/import", () => {
    it("exports and imports entries across projects", async () => {
      const { exported, ids } = await svc.exportEntries({
        sourceProject: "project-a",
        targetProject: "project-b",
        agentId: "agent-1",
        entries: [
          { type: "fact", content: "API uses REST over HTTPS" },
          { type: "decision", content: "Use PostgreSQL for persistence" },
        ],
      });
      assert.equal(exported, 2);
      assert.equal(ids.length, 2);

      const result = await svc.importEntries("project-b");
      assert.equal(result.count, 2);
      assert.equal(result.entries[0].sourceProject, "project-a");
    });

    it("revokes an exported entry", async () => {
      const result = await svc.importEntries("project-b");
      const entryId = result.entries[0].id;

      const ok = await svc.revokeEntry("project-b", entryId);
      assert.ok(ok);

      const after = await svc.importEntries("project-b");
      assert.equal(after.count, 1); // one revoked, one remaining
    });
  });

  describe("F2: dependency graph", () => {
    it("tracks project dependencies from exports", async () => {
      const graph = await svc.getDependencyGraph();
      assert.ok(graph.projects.includes("project-a"));
      assert.ok(graph.projects.includes("project-b"));
      assert.ok(graph.dependencies.length >= 1);
    });
  });

  describe("F3: adaptive budget", () => {
    it("returns l0 for simple tasks", () => {
      const rec = svc.recommendBudget({ toolCount: 1, turnCount: 2 });
      assert.equal(rec.depth, "l0");
      assert.equal(rec.tokenBudget, 600);
    });

    it("returns l2 for complex tasks", () => {
      const rec = svc.recommendBudget({
        toolCount: 8,
        turnCount: 15,
        queryLength: 150,
        mentionCount: 6,
      });
      assert.equal(rec.depth, "l2");
      assert.equal(rec.tokenBudget, 5000);
    });

    it("returns l1 for medium complexity", () => {
      const rec = svc.recommendBudget({ toolCount: 3, turnCount: 7, queryLength: 50 });
      assert.equal(rec.depth, "l1");
    });
  });

  describe("F4: approval workflow", () => {
    let approvalId: string;

    it("submits for approval", async () => {
      const { id } = await svc.submitForApproval({
        sourceAgent: "agent-1",
        projectId: "project-a",
        type: "decision",
        content: "Switch to gRPC",
      });
      approvalId = id;
      assert.ok(id.startsWith("appr-"));
    });

    it("lists pending approvals", async () => {
      const pending = await svc.listPendingApprovals("project-a");
      assert.equal(pending.length, 1);
      assert.equal(pending[0].status, "pending");
    });

    it("approves an entry", async () => {
      const ok = await svc.reviewApproval(approvalId, "approved", "reviewer-1");
      assert.ok(ok);

      const pending = await svc.listPendingApprovals("project-a");
      assert.equal(pending.length, 0);
    });

    it("rejects double-review", async () => {
      const ok = await svc.reviewApproval(approvalId, "rejected", "reviewer-2");
      assert.equal(ok, false); // already approved
    });
  });
});
