import type { MemoryEntryV2, MemoryType } from "../models/schema-v2.js";
import { MemoryCoreV2 } from "../core/memory-core-v2.js";
import type { SidecarConfig } from "../config/index.js";
import type { AtomicMemoryStore } from "./atomic-memory-store.js";
import type { EventLedgerService } from "./event-ledger-service.js";
import type { MemoryConsolidator } from "./memory-consolidator.js";
import { DEFAULT_MEMORY_BENCH_CASES, type MemoryBenchCase } from "./memory-bench-runner.js";

export interface MemoryBenchSeedResult {
  agentId: string;
  projectId?: string;
  scopes?: Array<{ agentId: string; projectId?: string; requested: number; createdCandidates: number; promoted: number }>;
  requested: number;
  skippedExisting: number;
  createdEvents: number;
  createdCandidates: number;
  promoted: number;
  needsReview: number;
  rejected: number;
  memoryIds: string[];
}

export interface MemoryBenchSeedOptions {
  agentId?: string;
  projectId?: string;
  cases?: MemoryBenchCase[];
  limit?: number;
}

function inferType(benchCase: MemoryBenchCase): MemoryType {
  const value = `${benchCase.id} ${benchCase.query}`.toLowerCase();
  if (/decision|why|为什么|决定|路线/.test(value)) return "decision";
  if (/entity|graphify|关系|实体|glossary/.test(value)) return "entity";
  if (/task|continuation|继续|下一步|journal/.test(value)) return "episode";
  if (/rule|红线|source|required|gate|规则/.test(value)) return "lesson";
  return "fact";
}

function fixtureTag(id: string): string {
  return `bench_fixture:${id}`;
}

function fixtureContent(benchCase: MemoryBenchCase): string {
  const terms = benchCase.expectedTerms.join(", ");
  return `Memory Bench fixture ${benchCase.id}: ${benchCase.query}. Expected retrieval terms: ${terms}.`;
}

export class MemoryBenchFixtureSeeder {
  constructor(
    private readonly cfg: SidecarConfig["openviking"],
    private readonly eventLedger: EventLedgerService,
    private readonly candidates: AtomicMemoryStore,
    private readonly consolidator: MemoryConsolidator
  ) {}

  async seed(opts: MemoryBenchSeedOptions = {}): Promise<MemoryBenchSeedResult> {
    const cases = (opts.cases ?? DEFAULT_MEMORY_BENCH_CASES).slice(0, Math.max(1, Math.min(opts.limit ?? 50, 100)));
    const memoryIds: string[] = [];
    let skippedExisting = 0;
    let createdEvents = 0;
    let createdCandidates = 0;
    const scopeStats = new Map<string, { agentId: string; projectId?: string; requested: number; createdCandidates: number }>();
    const createdByScope = new Map<string, { agentId: string; projectId?: string; count: number }>();

    for (const benchCase of cases) {
      const agentId = opts.agentId ?? benchCase.agentId ?? "development";
      const projectId = opts.projectId ?? benchCase.projectId ?? "openclaw-memory-fabric";
      const key = scopeKey(agentId, projectId);
      const stats = scopeStats.get(key) ?? { agentId, projectId, requested: 0, createdCandidates: 0 };
      stats.requested++;
      scopeStats.set(key, stats);

      const existing = await this.findExisting(agentId, projectId, benchCase);
      if (existing) {
        skippedExisting++;
        memoryIds.push(existing.id);
        continue;
      }

      const content = fixtureContent(benchCase);
      const event = await this.eventLedger.append({
        agentId,
        projectId,
        sourceType: "session",
        sourceUri: `bench-fixture://${benchCase.id}`,
        summary: `Memory Bench fixture seed: ${benchCase.id}`,
        content,
        payload: benchCase,
      });
      createdEvents++;

      await this.candidates.create({
        agentId,
        projectId,
        type: inferType(benchCase),
        content,
        sourceRefs: [event.eventId],
        confidence: 0.92,
        quality: {
          specificity: 0.85,
          actionability: 0.75,
          stability: 0.9,
          sourceCoverage: 1,
        },
        tags: ["bench_fixture", fixtureTag(benchCase.id)],
      });
      createdCandidates++;
      stats.createdCandidates++;
      const created = createdByScope.get(key) ?? { agentId, projectId, count: 0 };
      created.count++;
      createdByScope.set(key, created);
    }

    const consolidatedScopes: MemoryBenchSeedResult["scopes"] = [];
    let promoted = 0;
    let needsReview = 0;
    let rejected = 0;
    for (const scope of createdByScope.values()) {
      const consolidated = await this.consolidator.run({
        agentId: scope.agentId,
        projectId: scope.projectId,
        statuses: ["pending"],
        limit: Math.max(scope.count, 1),
      });
      memoryIds.push(...consolidated.entries.map((entry) => entry.memoryId).filter((id): id is string => !!id));
      promoted += consolidated.promoted;
      needsReview += consolidated.needsReview;
      rejected += consolidated.rejected;
      const stats = scopeStats.get(scopeKey(scope.agentId, scope.projectId));
      consolidatedScopes.push({
        agentId: scope.agentId,
        projectId: scope.projectId,
        requested: stats?.requested ?? scope.count,
        createdCandidates: stats?.createdCandidates ?? scope.count,
        promoted: consolidated.promoted,
      });
    }

    return {
      agentId: opts.agentId ?? (scopeStats.size === 1 ? [...scopeStats.values()][0]?.agentId : "mixed"),
      projectId: opts.projectId ?? (scopeStats.size === 1 ? [...scopeStats.values()][0]?.projectId : undefined),
      scopes: consolidatedScopes.length > 0 ? consolidatedScopes : [...scopeStats.values()].map((scope) => ({ ...scope, promoted: 0 })),
      requested: cases.length,
      skippedExisting,
      createdEvents,
      createdCandidates,
      promoted,
      needsReview,
      rejected,
      memoryIds: [...new Set(memoryIds)],
    };
  }

  private async findExisting(agentId: string, projectId: string | undefined, benchCase: MemoryBenchCase): Promise<MemoryEntryV2 | null> {
    const core = new MemoryCoreV2(this.cfg);
    const result = await core.query({
      agentId,
      projectId,
      tags: [fixtureTag(benchCase.id)],
      includeExpired: false,
      limit: 1,
    });
    return result.entries[0] ?? null;
  }
}

function scopeKey(agentId: string, projectId: string | undefined): string {
  return `${agentId}::${projectId ?? ""}`;
}
