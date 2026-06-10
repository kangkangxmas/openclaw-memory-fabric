import { MemoryCoreV2 } from "../core/memory-core-v2.js";
import type { SidecarConfig } from "../config/index.js";
import type { MemoryEntryV2, MemoryQuality } from "../models/schema-v2.js";
import { AtomicMemoryStore, type AtomicMemoryCandidate } from "./atomic-memory-store.js";
import type { V2RelationGraphService } from "./v2-relation-graph-service.js";

export interface ConsolidationResult {
  processed: number;
  promoted: number;
  rejected: number;
  needsReview: number;
  superseded: number;
  entries: Array<{
    candidateId: string;
    status: AtomicMemoryCandidate["status"];
    memoryId?: string;
    reason?: string;
  }>;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 1));
}

function jaccard(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection++;
  }
  return intersection / new Set([...left, ...right]).size;
}

function aggregateQuality(quality: MemoryQuality): number {
  return (quality.specificity + quality.actionability + quality.stability + quality.sourceCoverage) / 4;
}

function hasExplicitUserDirective(candidate: AtomicMemoryCandidate): boolean {
  return candidate.tags.some((tag) => tag === "explicit_user_instruction" || tag === "user_directive");
}

function passesHighTrustGate(candidate: AtomicMemoryCandidate): boolean {
  if (candidate.type !== "profile" && candidate.type !== "intent") return true;
  if (hasExplicitUserDirective(candidate) && candidate.confidence >= 0.7) return true;
  if (candidate.tags.includes("manual_review_approved") && candidate.confidence >= 0.7) return true;
  return candidate.sourceRefs.length >= 2 && candidate.confidence >= 0.8 && aggregateQuality(candidate.quality) >= 0.75;
}

export class MemoryConsolidator {
  private readonly core: MemoryCoreV2;

  constructor(
    cfg: SidecarConfig["openviking"],
    private readonly candidates: AtomicMemoryStore,
    private readonly relationGraph?: V2RelationGraphService
  ) {
    this.core = new MemoryCoreV2(cfg);
  }

  async run(opts: { agentId: string; projectId?: string; limit?: number; statuses?: AtomicMemoryCandidate["status"][] }): Promise<ConsolidationResult> {
    const pending = await this.candidates.list({
      agentId: opts.agentId,
      projectId: opts.projectId,
      statuses: opts.statuses ?? ["pending", "needs_review"],
      limit: opts.limit ?? 100,
    });

    const result: ConsolidationResult = {
      processed: pending.length,
      promoted: 0,
      rejected: 0,
      needsReview: 0,
      superseded: 0,
      entries: [],
    };

    for (const candidate of pending) {
      if (candidate.sourceRefs.length === 0) {
        candidate.status = "needs_review";
        candidate.reviewReason = "missing_source_refs";
        await this.candidates.update(candidate);
        result.needsReview++;
        result.entries.push({ candidateId: candidate.candidateId, status: candidate.status, reason: candidate.reviewReason });
        continue;
      }

      const qualityScore = aggregateQuality(candidate.quality);
      if (candidate.confidence < 0.45 || qualityScore < 0.45) {
        candidate.status = "needs_review";
        candidate.reviewReason = "quality_below_threshold";
        await this.candidates.update(candidate);
        result.needsReview++;
        result.entries.push({ candidateId: candidate.candidateId, status: candidate.status, reason: candidate.reviewReason });
        continue;
      }

      if (!passesHighTrustGate(candidate)) {
        candidate.status = "needs_review";
        candidate.reviewReason = "profile_intent_requires_explicit_or_multi_source";
        await this.candidates.update(candidate);
        result.needsReview++;
        result.entries.push({ candidateId: candidate.candidateId, status: candidate.status, reason: candidate.reviewReason });
        continue;
      }

      const similar = await this.core.query({
        text: candidate.content,
        agentId: candidate.agentId,
        projectId: candidate.projectId,
        types: [candidate.type],
        includeExpired: false,
        limit: 20,
      });

      const exactDuplicate = similar.entries.find((entry) => normalize(entry.content) === normalize(candidate.content));
      if (exactDuplicate) {
        candidate.status = "rejected";
        candidate.reviewReason = `duplicate:${exactDuplicate.id}`;
        await this.candidates.update(candidate);
        result.rejected++;
        result.entries.push({ candidateId: candidate.candidateId, status: candidate.status, reason: candidate.reviewReason });
        continue;
      }

      const superseded = similar.entries.find((entry) => jaccard(entry.content, candidate.content) >= 0.82);
      const now = new Date().toISOString();
      if (superseded) {
        await this.core.update(superseded.id, {
          status: "superseded",
          validUntil: now,
        } as Partial<MemoryEntryV2>);
        result.superseded++;
      }

      const promoted = await this.core.create({
        type: candidate.type,
        content: candidate.content,
        agentId: candidate.agentId,
        projectId: candidate.projectId,
        scope: candidate.projectId ? "project" : "private",
        visibility: "private",
        sourceRefs: candidate.sourceRefs,
        validFrom: now,
        validUntil: null,
        supersedes: superseded ? [superseded.id] : [],
        status: "active",
        quality: candidate.quality,
        sources: candidate.sourceRefs.map((ref) => ({
          type: "event",
          identifier: ref,
          timestamp: now,
          confidence: candidate.confidence,
          agentId: candidate.agentId,
        })),
        metadata: { tags: candidate.tags },
      });

      candidate.status = "promoted";
      candidate.promotedMemoryId = promoted.id;
      await this.candidates.update(candidate);
      await this.recordRelations(candidate, promoted, superseded?.id);
      result.promoted++;
      result.entries.push({ candidateId: candidate.candidateId, status: candidate.status, memoryId: promoted.id });
    }

    return result;
  }

  private async recordRelations(candidate: AtomicMemoryCandidate, promoted: MemoryEntryV2, supersededId?: string): Promise<void> {
    if (!this.relationGraph) return;
    for (const sourceRef of candidate.sourceRefs) {
      await this.relationGraph.add({
        agentId: candidate.agentId,
        projectId: candidate.projectId,
        type: "VALIDATES",
        sourceKind: "event",
        sourceId: sourceRef,
        targetKind: "memory",
        targetId: promoted.id,
        confidence: candidate.confidence,
        evidenceRefs: [sourceRef],
        metadata: { candidateId: candidate.candidateId },
      });
    }

    if (supersededId) {
      await this.relationGraph.add({
        agentId: candidate.agentId,
        projectId: candidate.projectId,
        type: "SUPERSEDES",
        sourceKind: "memory",
        sourceId: promoted.id,
        targetKind: "memory",
        targetId: supersededId,
        confidence: candidate.confidence,
        evidenceRefs: candidate.sourceRefs,
        metadata: { candidateId: candidate.candidateId },
      });
    }

    if (candidate.type === "decision" && candidate.projectId) {
      await this.relationGraph.add({
        agentId: candidate.agentId,
        projectId: candidate.projectId,
        type: "DECIDES",
        sourceKind: "memory",
        sourceId: promoted.id,
        targetKind: "project",
        targetId: candidate.projectId,
        confidence: candidate.confidence,
        evidenceRefs: candidate.sourceRefs,
        metadata: { candidateId: candidate.candidateId },
      });
    }

    if (candidate.type === "code" || candidate.type === "todo" || candidate.type === "episode") {
      await this.relationGraph.add({
        agentId: candidate.agentId,
        projectId: candidate.projectId,
        type: "IMPLEMENTS",
        sourceKind: "memory",
        sourceId: promoted.id,
        targetKind: candidate.projectId ? "project" : "entity",
        targetId: candidate.projectId ?? candidate.agentId,
        confidence: Math.min(candidate.confidence, 0.8),
        evidenceRefs: candidate.sourceRefs,
        metadata: { candidateId: candidate.candidateId },
      });
    }
  }
}
