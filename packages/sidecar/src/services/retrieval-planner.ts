import type { MemoryCoreV2, MemoryQuery } from "../core/memory-core-v2.js";
import type { MemoryEntryV2, MemoryType } from "../models/schema-v2.js";
import { MemoryCardPackager, type MemoryCard } from "./memory-card-packager.js";
import type { V2Relation, V2RelationGraphService } from "./v2-relation-graph-service.js";

export type RecallIntent = "fact_lookup" | "decision_history" | "task_continuation" | "rule_execution" | "entity_relation" | "general";

export interface RetrievalPlan {
  query: string;
  intent: RecallIntent;
  layers: Array<"L1" | "L2" | "L3" | "L4" | "L5">;
  preferredTypes: MemoryType[];
  scope: "private" | "project" | "shared";
  timeRange?: { from?: string; to?: string };
  weights: {
    keyword: number;
    vector: number;
    graph: number;
    temporal: number;
    sourceQuality: number;
  };
  reason: string;
}

export interface RecallPlanResult {
  plan: RetrievalPlan;
  entries: MemoryEntryV2[];
  cards: MemoryCard[];
  rendered: string;
  relations?: V2Relation[];
  ranking: Array<{
    memoryId: string;
    type: MemoryType;
    status: string;
    score: number;
    lexical: number;
    quality: number;
    temporal: number;
    relationCount: number;
    sourceRefCount: number;
    selected: boolean;
  }>;
  filterSummary: {
    refreshed: boolean;
    scored: number;
    sourceLessFiltered: number;
    focusedDropped: number;
    selected: number;
  };
  executionTimeMs: number;
}

function rrf(rank: number, k = 60): number {
  return 1 / (k + rank + 1);
}

function qualityScore(entry: MemoryEntryV2): number {
  if (!entry.quality) return entry.sourceRefs && entry.sourceRefs.length > 0 ? 0.65 : 0.35;
  return (entry.quality.specificity + entry.quality.actionability + entry.quality.stability + entry.quality.sourceCoverage) / 4;
}

function temporalBoost(entry: MemoryEntryV2): number {
  const days = (Date.now() - new Date(entry.timeline.createdAt).getTime()) / 86_400_000;
  return Math.max(0, 1 - days / 180);
}

function lexicalTokens(text: string): string[] {
  const normalized = text.toLowerCase();
  const tokens: string[] = [];
  const chunks = normalized.match(/[\p{L}\p{N}_]+/gu) ?? [];
  for (const chunk of chunks) {
    if (chunk.length >= 2) tokens.push(chunk);
    const cjkRuns = chunk.match(/[\p{Script=Han}]+/gu) ?? [];
    for (const run of cjkRuns) {
      for (let i = 0; i < run.length - 1; i++) {
        tokens.push(run.slice(i, i + 2));
      }
    }
  }
  return [...new Set(tokens.filter((token) => token.length >= 2))];
}

function lexicalRelevance(entry: MemoryEntryV2, query: string): number {
  const tokens = lexicalTokens(query);
  if (tokens.length === 0) return 0;
  const text = `${entry.content} ${entry.metadata.tags?.join(" ") ?? ""}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (text.includes(token)) {
      score += token.length > 2 ? 1 : 0.75;
    }
  }
  if (text.includes(query.toLowerCase())) score += 2;
  return Math.min(1, score / Math.max(1, tokens.length * 0.7));
}

function hasEvidence(entry: MemoryEntryV2): boolean {
  return (entry.sourceRefs?.length ?? 0) > 0 || (entry.sources?.length ?? 0) > 0;
}

export class RetrievalPlanner {
  private readonly packager = new MemoryCardPackager();

  constructor(
    private readonly core: MemoryCoreV2,
    private readonly relationGraph?: V2RelationGraphService
  ) {}

  plan(input: { query: string; agentId?: string; projectId?: string; scope?: "private" | "project" | "shared" }): RetrievalPlan {
    const query = input.query.trim();
    const lower = query.toLowerCase();

    let intent: RecallIntent = "general";
    let preferredTypes: MemoryType[] = ["fact", "decision", "pattern", "entity", "lesson"];
    let layers: RetrievalPlan["layers"] = ["L1", "L3"];
    let reason = "General query uses atomic memories and profile/project context.";

    if (/为什么|why|decision|决定|取舍|路线/.test(lower)) {
      intent = "decision_history";
      preferredTypes = ["decision", "episode", "fact"];
      layers = ["L1", "L2"];
      reason = "Decision/history query prioritizes decisions, episodes, and supporting facts.";
    } else if (/继续|上次|resume|handoff|进展|下一步/.test(lower)) {
      intent = "task_continuation";
      preferredTypes = ["episode", "todo", "decision", "unresolved"];
      layers = ["L2", "L1"];
      reason = "Continuation query prioritizes task episodes, todos, decisions, and open questions.";
    } else if (/规则|红线|不能|can i|allowed|禁止|stop|restart/.test(lower)) {
      intent = "rule_execution";
      preferredTypes = ["intent", "preference", "lesson", "decision"];
      layers = ["L5", "L4", "L3"];
      reason = "Rule execution query prioritizes long-term intent and procedural memories.";
    } else if (/谁|关系|related|connected|负责|owner|entity|实体/.test(lower)) {
      intent = "entity_relation";
      preferredTypes = ["entity", "fact", "decision"];
      layers = ["L1", "L3"];
      reason = "Entity query prioritizes entity memories and supporting facts.";
    } else if (/当前|配置|是什么|what is|确认|路径|命令/.test(lower)) {
      intent = "fact_lookup";
      preferredTypes = ["fact", "entity", "decision"];
      layers = ["L1", "L3"];
      reason = "Fact lookup query prioritizes current facts and entity/project profile.";
    }

    return {
      query,
      intent,
      layers,
      preferredTypes,
      scope: input.scope ?? (input.projectId ? "project" : "private"),
      weights: {
        keyword: 0.25,
        vector: 0.3,
        graph: intent === "entity_relation" ? 0.25 : 0.1,
        temporal: intent === "task_continuation" ? 0.2 : 0.1,
        sourceQuality: 0.1,
      },
      reason,
    };
  }

  async recall(input: { query: string; agentId?: string; projectId?: string; scope?: "private" | "project" | "shared"; limit?: number }): Promise<RecallPlanResult> {
    const start = Date.now();
    const refreshed = await this.core.refreshIfChanged();
    const plan = this.plan(input);
    const baseQuery: MemoryQuery = {
      text: plan.query,
      agentId: input.agentId,
      projectId: input.projectId,
      scope: plan.scope,
      includeExpired: false,
      limit: Math.max(20, (input.limit ?? 8) * 4),
    };

    const keyword = await this.core.query(baseQuery);
    const typed = await this.core.query({ ...baseQuery, text: undefined, types: plan.preferredTypes });
    const temporal = await this.core.query({ ...baseQuery, text: undefined });
    const relations =
      plan.intent === "entity_relation" && this.relationGraph
        ? await this.relationGraph.list({
            agentId: input.agentId,
            projectId: input.projectId,
            limit: 200,
          })
        : [];

    const scores = new Map<string, { entry: MemoryEntryV2; score: number; lexical: number; quality: number; temporal: number; relationCount: number }>();
    const add = (entries: MemoryEntryV2[], weight: number): void => {
      entries.forEach((entry, rank) => {
        const current = scores.get(entry.id) ?? {
          entry,
          score: 0,
          lexical: lexicalRelevance(entry, plan.query),
          quality: qualityScore(entry),
          temporal: temporalBoost(entry),
          relationCount: 0,
        };
        current.score += rrf(rank) * weight;
        scores.set(entry.id, current);
      });
    };

    add(keyword.entries, plan.weights.keyword + plan.weights.vector);
    add(typed.entries, 0.2);
    add(temporal.entries, plan.weights.temporal);

    for (const current of scores.values()) {
      current.score += current.lexical * 0.85;
      current.score += current.quality * plan.weights.sourceQuality;
      current.score += current.temporal * plan.weights.temporal;
      if (plan.preferredTypes.includes(current.entry.type)) current.score += 0.05;
      const relationCount = relations.filter(
        (relation) => relation.sourceId === current.entry.id || relation.targetId === current.entry.id
      ).length;
      current.relationCount = relationCount;
      if (relationCount > 0) current.score += Math.min(0.2, relationCount * 0.04) * plan.weights.graph;
    }

    const scored = Array.from(scores.values());
    const ranked = scored
      .filter((item) => hasEvidence(item.entry))
      .sort((a, b) => b.score - a.score);
    const topLexical = ranked[0]?.lexical ?? 0;
    const focused =
      topLexical >= 0.35
        ? ranked.filter((item) => item.lexical >= Math.max(0.35, topLexical * 0.55))
        : ranked;
    const entries = focused.slice(0, input.limit ?? 8).map((item) => item.entry);
    const cards = this.packager.package(entries, { limit: input.limit ?? 8, tokenBudget: plan.intent === "task_continuation" ? 900 : 700 });
    const selectedIds = new Set(entries.map((entry) => entry.id));

    return {
      plan,
      entries,
      cards,
      rendered: this.packager.render(cards),
      relations: relations.filter((relation) => entries.some((entry) => relation.sourceId === entry.id || relation.targetId === entry.id)).slice(0, 20),
      ranking: ranked.slice(0, 20).map((item) => ({
        memoryId: item.entry.id,
        type: item.entry.type,
        status: item.entry.status ?? "active",
        score: Number(item.score.toFixed(4)),
        lexical: Number(item.lexical.toFixed(4)),
        quality: Number(item.quality.toFixed(4)),
        temporal: Number(item.temporal.toFixed(4)),
        relationCount: item.relationCount,
        sourceRefCount: (item.entry.sourceRefs?.length ?? 0) + (item.entry.sources?.length ?? 0),
        selected: selectedIds.has(item.entry.id),
      })),
      filterSummary: {
        refreshed,
        scored: scored.length,
        sourceLessFiltered: scored.filter((item) => !hasEvidence(item.entry)).length,
        focusedDropped: Math.max(0, ranked.length - focused.length),
        selected: entries.length,
      },
      executionTimeMs: Date.now() - start,
    };
  }
}
