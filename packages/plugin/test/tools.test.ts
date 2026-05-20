/**
 * Unit tests for new plugin tool handler factories.
 * Uses stub SidecarClients so no real network is required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SidecarClient } from "../src/utils/sidecar-client.js";

// Minimal stub for SidecarClient — only the methods needed per tool
function makeClient(overrides: Record<string, (...args: unknown[]) => unknown>) {
  return overrides as unknown as SidecarClient;
}

// ---------------------------------------------------------------------------
// memory_brief
// ---------------------------------------------------------------------------

import { createMemoryBrief } from "../src/tools/memory-brief.js";

describe("memory_brief tool", () => {
  it("calls client.recall with correct params and returns result", async () => {
    const stub = { memoryBrief: "## Brief", sources: ["openviking:l0"], budgetUsed: 200 };
    const client = makeClient({ recall: async () => stub });
    const tool = createMemoryBrief(client);
    const result = await tool({ agentId: "agent-a", projectId: "proj-1", depth: "l0" });
    assert.equal(result.memoryBrief, "## Brief");
    assert.equal(result.budgetUsed, 200);
  });

  it("defaults to scope=auto and depth=l1 when not specified", async () => {
    let captured: unknown;
    const client = makeClient({
      recall: async (req: unknown) => {
        captured = req;
        return { memoryBrief: "", sources: [], budgetUsed: 0 };
      }
    });
    const tool = createMemoryBrief(client);
    await tool({ agentId: "agent-a" });
    const req = captured as { scope: string; depth: string };
    assert.equal(req.scope, "auto");
    assert.equal(req.depth, "l1");
  });
});

// ---------------------------------------------------------------------------
// memory_commit
// ---------------------------------------------------------------------------

import { createMemoryCommit } from "../src/tools/memory-commit.js";

describe("memory_commit tool", () => {
  it("calls client.commit with provided facts and decisions", async () => {
    let captured: unknown;
    const commitResp = { ok: true as const, committed: 2, publishCandidates: [] };
    const client = makeClient({
      commit: async (req: unknown) => {
        captured = req;
        return commitResp;
      }
    });
    const tool = createMemoryCommit(client);
    const result = await tool({
      agentId: "agent-a",
      projectId: "proj-1",
      facts: ["fact1", "fact2"],
      decisions: ["dec1"]
    });
    assert.equal(result.committed, 2);
    const req = captured as { facts: string[] };
    assert.deepEqual(req.facts, ["fact1", "fact2"]);
  });

  it("defaults visibility to private when not specified", async () => {
    let captured: unknown;
    const client = makeClient({
      commit: async (req: unknown) => {
        captured = req;
        return { ok: true as const, committed: 0, publishCandidates: [] };
      }
    });
    const tool = createMemoryCommit(client);
    await tool({ agentId: "agent-a" });
    const req = captured as { visibility: string };
    assert.equal(req.visibility, "private");
  });
});

// ---------------------------------------------------------------------------
// project_bootstrap
// ---------------------------------------------------------------------------

import { createProjectBootstrap } from "../src/tools/project-bootstrap.js";

describe("project_bootstrap tool", () => {
  it("calls client.bootstrap with projectId and paths", async () => {
    const bootstrapResp = {
      ok: true,
      projectId: "proj-1",
      nodeCount: 10,
      edgeCount: 5,
      fileCount: 3
    };
    const client = makeClient({ bootstrap: async () => bootstrapResp });
    const tool = createProjectBootstrap(client);
    const result = await tool({ projectId: "proj-1", paths: ["/some/path"] });
    assert.equal(result.nodeCount, 10);
    assert.equal(result.projectId, "proj-1");
  });

  it("defaults mode to auto", async () => {
    let captured: unknown;
    const client = makeClient({
      bootstrap: async (req: unknown) => {
        captured = req;
        return { ok: true, projectId: "p", nodeCount: 0, edgeCount: 0, fileCount: 0 };
      }
    });
    const tool = createProjectBootstrap(client);
    await tool({ projectId: "p", paths: [] });
    const req = captured as { mode: string };
    assert.equal(req.mode, "auto");
  });
});

// ---------------------------------------------------------------------------
// project_state_refresh
// ---------------------------------------------------------------------------

import { createProjectStateRefresh } from "../src/tools/project-state-refresh.js";

describe("project_state_refresh tool", () => {
  it("calls client.graphBrief with projectId", async () => {
    const briefResp = {
      projectId: "proj-1",
      freshness: "fresh" as const,
      coreNodes: ["A"],
      communities: [],
      keyPaths: [],
      unknowns: [],
      recommendedRetrievalTargets: [],
      summary: "ok"
    };
    const client = makeClient({ graphBrief: async () => briefResp });
    const tool = createProjectStateRefresh(client);
    const result = await tool({ projectId: "proj-1" });
    assert.equal(result.freshness, "fresh");
    assert.equal(result.projectId, "proj-1");
  });
});

// ---------------------------------------------------------------------------
// project_graph_query / path / explain
// ---------------------------------------------------------------------------

import {
  createProjectGraphQuery,
  createProjectGraphPath,
  createProjectGraphExplain
} from "../src/tools/project-graph-tools.js";

describe("project_graph_query tool", () => {
  it("calls client.graphQuery and returns nodes", async () => {
    const client = makeClient({ graphQuery: async () => ({ nodes: ["NodeA", "NodeB"] }) });
    const tool = createProjectGraphQuery(client);
    const result = await tool({ projectId: "p", query: "service" });
    assert.deepEqual(result.nodes, ["NodeA", "NodeB"]);
  });
});

describe("project_graph_path tool", () => {
  it("calls client.graphPath and returns path", async () => {
    const client = makeClient({
      graphPath: async () => ({ path: ["A", "B", "C"], found: true })
    });
    const tool = createProjectGraphPath(client);
    const result = await tool({ projectId: "p", from: "A", to: "C" });
    assert.deepEqual(result.path, ["A", "B", "C"]);
    assert.equal(result.found, true);
  });
});

describe("project_graph_explain tool", () => {
  it("calls client.graphExplain and returns explanation", async () => {
    const client = makeClient({
      graphExplain: async () => ({ explanation: "Module X handles auth" })
    });
    const tool = createProjectGraphExplain(client);
    const result = await tool({ projectId: "p", query: "Module X" });
    assert.equal(result.explanation, "Module X handles auth");
  });
});

// ---------------------------------------------------------------------------
// carrier_read / carrier_merge
// ---------------------------------------------------------------------------

import { createCarrierRead, createCarrierMerge } from "../src/tools/carrier-tools.js";

describe("carrier_read tool", () => {
  it("calls client.carrierRead and returns carriers array", async () => {
    const carriers = [{ filename: "identity.md", content: "# ID", exists: true }];
    const client = makeClient({ carrierRead: async () => ({ carriers }) });
    const tool = createCarrierRead(client);
    const result = await tool({ agentId: "agent-a" });
    assert.equal(result.carriers.length, 1);
    assert.equal(result.carriers[0].filename, "identity.md");
  });
});

describe("carrier_merge tool", () => {
  it("calls client.carrierMerge and returns merged list", async () => {
    const client = makeClient({
      carrierMerge: async () => ({ merged: ["identity.md"], skipped: [] })
    });
    const tool = createCarrierMerge(client);
    const result = await tool({
      agentId: "agent-a",
      patches: [{ filename: "identity.md", content: "# Updated" }]
    });
    assert.deepEqual(result.merged, ["identity.md"]);
    assert.equal(result.skipped.length, 0);
  });
});
