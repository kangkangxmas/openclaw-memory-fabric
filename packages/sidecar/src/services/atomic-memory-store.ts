import { createHash } from "crypto";
import { join } from "path";
import { readdir } from "fs/promises";
import { existsSync } from "fs";
import type { SidecarConfig } from "../config/index.js";
import type { MemoryQuality, MemoryStatus, MemoryType } from "../models/schema-v2.js";
import { appendJsonl, ensureDir, readJsonl, writeJsonl } from "../utils/jsonl.js";
import { validateId } from "../utils/path-guard.js";
import { resolveV2BaseDir } from "../utils/v2-paths.js";

export interface AtomicMemoryCandidate {
  candidateId: string;
  agentId: string;
  projectId?: string;
  type: MemoryType;
  content: string;
  sourceRefs: string[];
  confidence: number;
  quality: MemoryQuality;
  status: Extract<MemoryStatus, "pending" | "needs_review" | "rejected"> | "promoted";
  createdAt: string;
  updatedAt: string;
  promotedMemoryId?: string;
  reviewReason?: string;
  tags: string[];
}

export interface CandidateStats {
  total: number;
  byStatus: Record<AtomicMemoryCandidate["status"], number>;
  byType: Partial<Record<MemoryType, number>>;
}

export interface CreateCandidateInput {
  agentId: string;
  projectId?: string;
  type?: MemoryType;
  content: string;
  sourceRefs?: string[];
  confidence?: number;
  quality?: Partial<MemoryQuality>;
  tags?: string[];
}

export interface CandidateListOptions {
  agentId?: string;
  projectId?: string;
  statuses?: AtomicMemoryCandidate["status"][];
  limit?: number;
}

export interface ReviewCandidateInput {
  candidateId: string;
  agentId?: string;
  decision: "approve" | "reject";
  reviewedBy: string;
  reason?: string;
}

function candidateId(input: CreateCandidateInput, createdAt: string): string {
  const hash = createHash("sha256")
    .update(JSON.stringify({ ...input, createdAt }))
    .digest("hex")
    .slice(0, 12);
  return `cand_${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}_${hash}`;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function defaultQuality(input: CreateCandidateInput): MemoryQuality {
  const len = input.content.trim().length;
  return {
    specificity: clamp(len / 120),
    actionability: input.type === "decision" || input.type === "todo" || input.type === "risk" ? 0.85 : 0.55,
    stability: input.type === "preference" || input.type === "intent" || input.type === "decision" ? 0.8 : 0.55,
    sourceCoverage: input.sourceRefs && input.sourceRefs.length > 0 ? 1 : 0,
    ...input.quality,
  };
}

export class AtomicMemoryStore {
  private readonly root: string;

  constructor(cfg: SidecarConfig["openviking"]) {
    this.root = join(resolveV2BaseDir(cfg), "atomic-candidates");
  }

  async create(input: CreateCandidateInput): Promise<AtomicMemoryCandidate> {
    validateId(input.agentId, "agentId");
    if (input.projectId) validateId(input.projectId, "projectId");
    const now = new Date().toISOString();
    const sourceRefs = input.sourceRefs ?? [];
    const quality = defaultQuality({ ...input, sourceRefs });
    const candidate: AtomicMemoryCandidate = {
      candidateId: candidateId({ ...input, sourceRefs }, now),
      agentId: input.agentId,
      projectId: input.projectId,
      type: input.type ?? "fact",
      content: input.content.trim(),
      sourceRefs,
      confidence: clamp(input.confidence ?? (sourceRefs.length > 0 ? 0.72 : 0.35)),
      quality,
      status: sourceRefs.length > 0 ? "pending" : "needs_review",
      createdAt: now,
      updatedAt: now,
      reviewReason: sourceRefs.length > 0 ? undefined : "missing_source_refs",
      tags: input.tags ?? [],
    };

    await ensureDir(this.agentDir(input.agentId));
    await appendJsonl(this.filePath(input.agentId), candidate);
    return candidate;
  }

  async list(opts: { agentId: string; projectId?: string; statuses?: AtomicMemoryCandidate["status"][]; limit?: number }): Promise<AtomicMemoryCandidate[]> {
    validateId(opts.agentId, "agentId");
    if (opts.projectId) validateId(opts.projectId, "projectId");
    const candidates = await readJsonl<AtomicMemoryCandidate>(this.filePath(opts.agentId));
    return this.filterCandidates(candidates, opts);
  }

  async listAll(opts: CandidateListOptions = {}): Promise<AtomicMemoryCandidate[]> {
    if (opts.agentId) {
      return this.list({
        agentId: opts.agentId,
        projectId: opts.projectId,
        statuses: opts.statuses,
        limit: opts.limit,
      });
    }

    const candidates: AtomicMemoryCandidate[] = [];
    for (const agentId of await this.listAgents()) {
      candidates.push(...(await readJsonl<AtomicMemoryCandidate>(this.filePath(agentId))));
    }
    return this.filterCandidates(candidates, opts);
  }

  async get(candidateId: string, agentId?: string): Promise<AtomicMemoryCandidate | null> {
    const candidates = agentId
      ? await this.list({ agentId, limit: 1000 })
      : await this.listAll({ limit: 10_000 });
    return candidates.find((candidate) => candidate.candidateId === candidateId) ?? null;
  }

  async update(candidate: AtomicMemoryCandidate): Promise<void> {
    const all = await readJsonl<AtomicMemoryCandidate>(this.filePath(candidate.agentId));
    const idx = all.findIndex((item) => item.candidateId === candidate.candidateId);
    const updated = { ...candidate, updatedAt: new Date().toISOString() };
    if (idx >= 0) all[idx] = updated;
    else all.push(updated);
    await ensureDir(this.agentDir(candidate.agentId));
    await writeJsonl(this.filePath(candidate.agentId), all);
  }

  async review(input: ReviewCandidateInput): Promise<AtomicMemoryCandidate | null> {
    const candidate = await this.get(input.candidateId, input.agentId);
    if (!candidate) return null;

    if (input.decision === "approve") {
      candidate.status = candidate.sourceRefs.length > 0 ? "pending" : "needs_review";
      candidate.confidence = Math.max(candidate.confidence, 0.8);
      candidate.reviewReason = candidate.sourceRefs.length > 0 ? undefined : "missing_source_refs";
      candidate.tags = [
        ...new Set([
          ...candidate.tags,
          "manual_review_approved",
          `reviewed_by:${input.reviewedBy}`,
          ...(input.reason ? [`review_reason:${input.reason}`] : []),
        ]),
      ];
    } else {
      candidate.status = "rejected";
      candidate.reviewReason = input.reason ?? "manual_review_rejected";
      candidate.tags = [...new Set([...candidate.tags, "manual_review_rejected", `reviewed_by:${input.reviewedBy}`])];
    }

    await this.update(candidate);
    return candidate;
  }

  async retry(opts: { agentId?: string; projectId?: string; statuses?: AtomicMemoryCandidate["status"][]; limit?: number }): Promise<AtomicMemoryCandidate[]> {
    const candidates = await this.listAll({
      agentId: opts.agentId,
      projectId: opts.projectId,
      statuses: opts.statuses ?? ["needs_review", "rejected"],
      limit: opts.limit ?? 100,
    });
    const updated: AtomicMemoryCandidate[] = [];
    for (const candidate of candidates) {
      candidate.status = candidate.sourceRefs.length > 0 ? "pending" : "needs_review";
      candidate.reviewReason = candidate.sourceRefs.length > 0 ? undefined : "missing_source_refs";
      await this.update(candidate);
      updated.push(candidate);
    }
    return updated;
  }

  async stats(opts: CandidateListOptions = {}): Promise<CandidateStats> {
    const candidates = await this.listAll({ ...opts, limit: opts.limit ?? 10_000 });
    const byStatus: CandidateStats["byStatus"] = {
      pending: 0,
      needs_review: 0,
      rejected: 0,
      promoted: 0,
    };
    const byType: CandidateStats["byType"] = {};
    for (const candidate of candidates) {
      byStatus[candidate.status]++;
      byType[candidate.type] = (byType[candidate.type] ?? 0) + 1;
    }
    return { total: candidates.length, byStatus, byType };
  }

  async listAgents(): Promise<string[]> {
    if (!existsSync(this.root)) return [];
    const entries = await readdir(this.root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }

  private agentDir(agentId: string): string {
    return join(this.root, agentId);
  }

  private filePath(agentId: string): string {
    return join(this.agentDir(agentId), "candidates.jsonl");
  }

  private filterCandidates(candidates: AtomicMemoryCandidate[], opts: CandidateListOptions): AtomicMemoryCandidate[] {
    if (opts.projectId) validateId(opts.projectId, "projectId");
    return candidates
      .filter((candidate) => !opts.projectId || candidate.projectId === opts.projectId)
      .filter((candidate) => !opts.statuses || opts.statuses.includes(candidate.status))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, Math.max(1, Math.min(opts.limit ?? 100, 10_000)));
  }
}
