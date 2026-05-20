/**
 * FederationService — cross-workspace memory federation.
 *
 * F1: Enables knowledge sharing between different projects via a
 *     federation registry. Each project can export/import knowledge
 *     entries through a controlled protocol.
 *
 * F2: Multi-project dependency graph — tracks which projects
 *     reference entities from other projects.
 *
 * F3: Adaptive memory budget — adjusts L0/L1/L2 token budgets
 *     based on task complexity signals.
 *
 * F4: Shared memory approval workflow — pending/approved/rejected
 *     states for org-shared publications.
 */

import { existsSync } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { readJsonl, appendJsonl, writeJsonl } from "../utils/jsonl.js";

// ---------------------------------------------------------------------------
// F1: Federation types
// ---------------------------------------------------------------------------

export interface FederationEntry {
  id: string;
  sourceProject: string;
  targetProject: string;
  type: "fact" | "decision" | "entity" | "pattern";
  content: string;
  exportedBy: string; // agentId
  exportedAt: string;
  status: "active" | "revoked";
}

export interface FederationExportRequest {
  sourceProject: string;
  targetProject: string;
  agentId: string;
  entries: Array<{
    type: FederationEntry["type"];
    content: string;
  }>;
}

export interface FederationImportResult {
  project: string;
  entries: FederationEntry[];
  count: number;
}

// ---------------------------------------------------------------------------
// F2: Project dependency types
// ---------------------------------------------------------------------------

export interface ProjectDependency {
  from: string;
  to: string;
  sharedEntities: string[];
  strength: number;
  lastUpdated: string;
}

export interface DependencyGraph {
  projects: string[];
  dependencies: ProjectDependency[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// F3: Adaptive budget types
// ---------------------------------------------------------------------------

export interface BudgetRecommendation {
  depth: "l0" | "l1" | "l2";
  tokenBudget: number;
  reason: string;
}

// ---------------------------------------------------------------------------
// F4: Approval workflow types
// ---------------------------------------------------------------------------

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalEntry {
  id: string;
  sourceAgent: string;
  projectId: string;
  content: string;
  type: string;
  status: ApprovalStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// FederationService
// ---------------------------------------------------------------------------

export class FederationService {
  constructor(private readonly basePath: string) {}

  private federationDir(): string {
    return join(this.basePath, "federation");
  }

  private federationFile(projectId: string): string {
    return join(this.federationDir(), `${projectId}.jsonl`);
  }

  private depsFile(): string {
    return join(this.federationDir(), "dependencies.json");
  }

  private approvalsFile(): string {
    return join(this.federationDir(), "approvals.jsonl");
  }

  // -----------------------------------------------------------------------
  // F1: Cross-workspace federation
  // -----------------------------------------------------------------------

  /** Export entries from one project to another. */
  async exportEntries(req: FederationExportRequest): Promise<{ exported: number; ids: string[] }> {
    await mkdir(this.federationDir(), { recursive: true });
    const ids: string[] = [];

    for (const item of req.entries) {
      const entry: FederationEntry = {
        id: uid("fed"),
        sourceProject: req.sourceProject,
        targetProject: req.targetProject,
        type: item.type,
        content: item.content,
        exportedBy: req.agentId,
        exportedAt: new Date().toISOString(),
        status: "active",
      };
      await appendJsonl(this.federationFile(req.targetProject), entry);
      ids.push(entry.id);
    }

    // Update dependency graph
    await this.updateDependency(req.sourceProject, req.targetProject, req.entries.map((e) => e.content.slice(0, 30)));

    return { exported: ids.length, ids };
  }

  /** Import federated entries for a project. */
  async importEntries(projectId: string, limit = 50): Promise<FederationImportResult> {
    const entries = await readJsonl<FederationEntry>(this.federationFile(projectId));
    const active = entries
      .filter((e) => e.status === "active")
      .sort((a, b) => new Date(b.exportedAt).getTime() - new Date(a.exportedAt).getTime())
      .slice(0, limit);

    return { project: projectId, entries: active, count: active.length };
  }

  /** Revoke a previously exported entry. */
  async revokeEntry(projectId: string, entryId: string): Promise<boolean> {
    const filePath = this.federationFile(projectId);
    const entries = await readJsonl<FederationEntry>(filePath);
    const idx = entries.findIndex((e) => e.id === entryId);
    if (idx < 0) return false;

    entries[idx] = { ...entries[idx], status: "revoked" };
    await writeJsonl(filePath, entries);
    return true;
  }

  // -----------------------------------------------------------------------
  // F2: Multi-project dependency graph
  // -----------------------------------------------------------------------

  private async updateDependency(from: string, to: string, sharedEntities: string[]): Promise<void> {
    const graph = await this.loadDependencyGraph();

    if (!graph.projects.includes(from)) graph.projects.push(from);
    if (!graph.projects.includes(to)) graph.projects.push(to);

    const existing = graph.dependencies.find((d) => d.from === from && d.to === to);
    if (existing) {
      existing.strength++;
      existing.sharedEntities = [
        ...new Set([...existing.sharedEntities, ...sharedEntities]),
      ].slice(0, 20);
      existing.lastUpdated = new Date().toISOString();
    } else {
      graph.dependencies.push({
        from,
        to,
        sharedEntities,
        strength: 1,
        lastUpdated: new Date().toISOString(),
      });
    }

    graph.generatedAt = new Date().toISOString();
    await writeFile(this.depsFile(), JSON.stringify(graph, null, 2), "utf-8");
  }

  async getDependencyGraph(): Promise<DependencyGraph> {
    return this.loadDependencyGraph();
  }

  private async loadDependencyGraph(): Promise<DependencyGraph> {
    const path = this.depsFile();
    if (!existsSync(path)) {
      return { projects: [], dependencies: [], generatedAt: new Date().toISOString() };
    }
    try {
      return JSON.parse(await readFile(path, "utf-8")) as DependencyGraph;
    } catch {
      return { projects: [], dependencies: [], generatedAt: new Date().toISOString() };
    }
  }

  // -----------------------------------------------------------------------
  // F3: Adaptive memory budget
  // -----------------------------------------------------------------------

  /**
   * Recommend a recall depth and token budget based on complexity signals.
   *
   * Signals:
   * - toolCount: more tools = more complex
   * - turnCount: more turns = deeper conversation
   * - queryLength: longer query = more complex need
   * - mentionCount: more entity mentions = richer context needed
   */
  recommendBudget(signals: {
    toolCount?: number;
    turnCount?: number;
    queryLength?: number;
    mentionCount?: number;
  }): BudgetRecommendation {
    const { toolCount = 0, turnCount = 0, queryLength = 0, mentionCount = 0 } = signals;

    let complexity = 0;
    if (toolCount >= 5) complexity += 2;
    else if (toolCount >= 2) complexity += 1;

    if (turnCount >= 10) complexity += 2;
    else if (turnCount >= 5) complexity += 1;

    if (queryLength >= 100) complexity += 2;
    else if (queryLength >= 30) complexity += 1;

    if (mentionCount >= 5) complexity += 1;

    if (complexity >= 5) {
      return { depth: "l2", tokenBudget: 5000, reason: `high complexity (score=${complexity}): deep retrieval with full context` };
    }
    if (complexity >= 3) {
      return { depth: "l1", tokenBudget: 1800, reason: `medium complexity (score=${complexity}): structural brief + key memories` };
    }
    return { depth: "l0", tokenBudget: 600, reason: `low complexity (score=${complexity}): quick keyword lookup` };
  }

  // -----------------------------------------------------------------------
  // F4: Shared memory approval workflow
  // -----------------------------------------------------------------------

  /** Submit an entry for org-shared publication (pending approval). */
  async submitForApproval(params: {
    sourceAgent: string;
    projectId: string;
    type: string;
    content: string;
  }): Promise<{ id: string }> {
    await mkdir(this.federationDir(), { recursive: true });
    const entry: ApprovalEntry = {
      id: uid("appr"),
      sourceAgent: params.sourceAgent,
      projectId: params.projectId,
      content: params.content,
      type: params.type,
      status: "pending",
      submittedAt: new Date().toISOString(),
    };
    await appendJsonl(this.approvalsFile(), entry);
    return { id: entry.id };
  }

  /** List pending approvals. */
  async listPendingApprovals(projectId?: string): Promise<ApprovalEntry[]> {
    const all = await readJsonl<ApprovalEntry>(this.approvalsFile());
    let pending = all.filter((e) => e.status === "pending");
    if (projectId) {
      pending = pending.filter((e) => e.projectId === projectId);
    }
    return pending.sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
    );
  }

  /** Approve or reject a pending entry. */
  async reviewApproval(
    entryId: string,
    decision: "approved" | "rejected",
    reviewedBy: string,
  ): Promise<boolean> {
    const filePath = this.approvalsFile();
    const all = await readJsonl<ApprovalEntry>(filePath);
    const idx = all.findIndex((e) => e.id === entryId);
    if (idx < 0) return false;
    if (all[idx].status !== "pending") return false;

    all[idx] = {
      ...all[idx],
      status: decision,
      reviewedAt: new Date().toISOString(),
      reviewedBy,
    };
    await writeJsonl(filePath, all);
    return true;
  }
}
