/**
 * Query Router — Intelligent query routing and multi-strategy retrieval.
 *
 * Features:
 * - Query intent classification (semantic vs keyword vs temporal vs relational)
 * - Strategy selection based on query characteristics
 * - Result fusion from multiple strategies
 * - Re-ranking and deduplication
 * - Query planning for complex queries
 */

import type { MemoryEntryV2 } from "../models/schema-v2.js";
import type { MemoryCoreV2, MemoryQuery, MemoryQueryResult } from "./memory-core-v2.js";
import type { VectorServiceV2 } from "../services/vector-service-v2.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QueryStrategy = "semantic" | "keyword" | "temporal" | "relational" | "hybrid";

export interface QueryPlan {
  originalQuery: string;
  strategy: QueryStrategy;
  subQueries?: string[];
  filters: {
    types?: string[];
    tags?: string[];
    timeRange?: { from?: string; to?: string };
  };
  confidence: number;
}

export interface RoutedResult {
  results: MemoryEntryV2[];
  plan: QueryPlan;
  sources: Array<{
    strategy: QueryStrategy;
    entries: MemoryEntryV2[];
    score: number;
  }>;
  executionTimeMs: number;
}

export interface RouterConfig {
  /** Weight for semantic scores in fusion */
  semanticWeight: number;
  /** Weight for keyword scores in fusion */
  keywordWeight: number;
  /** Weight for temporal scores in fusion */
  temporalWeight: number;
  /** Weight for relational scores in fusion */
  relationalWeight: number;
  /** Minimum score threshold */
  minScore: number;
  /** Max results to return */
  maxResults: number;
  /** Enable query decomposition */
  enableDecomposition: boolean;
}

const DEFAULT_CONFIG: RouterConfig = {
  semanticWeight: 0.4,
  keywordWeight: 0.3,
  temporalWeight: 0.15,
  relationalWeight: 0.15,
  minScore: 0.1,
  maxResults: 20,
  enableDecomposition: true,
};

// ---------------------------------------------------------------------------
// QueryClassifier
// ---------------------------------------------------------------------------

class QueryClassifier {
  /** Classify query intent based on patterns */
  classify(query: string): QueryPlan {
    const lower = query.toLowerCase().trim();

    // Temporal patterns
    const temporalPatterns = [
      /\b(recent|latest|last|yesterday|today|this week|this month)\b/,
      /\b(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\b/,
      /\b(after|before|since|until|between)\b/,
    ];
    const isTemporal = temporalPatterns.some((p) => p.test(lower));

    // Relational patterns
    const relationalPatterns = [
      /\b(related to|connected|linked|similar to|like)\b/,
      /\b(parent|child|derived|supersedes)\b/,
    ];
    const isRelational = relationalPatterns.some((p) => p.test(lower));

    // Keyword patterns (exact matches, IDs, specific terms)
    const isKeyword = /^[a-z0-9_-]+$/i.test(lower) || lower.includes('"');

    // Determine strategy
    let strategy: QueryStrategy = "hybrid";
    let confidence = 0.7;

    if (isTemporal && isRelational) {
      strategy = "hybrid";
      confidence = 0.6;
    } else if (isTemporal) {
      strategy = "temporal";
      confidence = 0.85;
    } else if (isRelational) {
      strategy = "relational";
      confidence = 0.8;
    } else if (isKeyword) {
      strategy = "keyword";
      confidence = 0.9;
    }

    // Extract filters
    const filters = this.extractFilters(lower);

    // Decompose complex queries
    const subQueries = this.decompose(query);

    return {
      originalQuery: query,
      strategy,
      subQueries: subQueries.length > 1 ? subQueries : undefined,
      filters,
      confidence,
    };
  }

  private extractFilters(query: string): QueryPlan["filters"] {
    const filters: QueryPlan["filters"] = {};

    // Extract type filters
    const typeMatch = query.match(/type:(\w+)/);
    if (typeMatch) filters.types = [typeMatch[1]];

    // Extract tag filters
    const tagMatches = query.matchAll(/tag:(\w+)/g);
    const tags = Array.from(tagMatches).map((m) => m[1]);
    if (tags.length > 0) filters.tags = tags;

    // Extract date range
    const dateMatch = query.match(/(after|since):(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      filters.timeRange = { from: dateMatch[2] };
    }

    return filters;
  }

  private decompose(query: string): string[] {
    // Split on conjunctions for complex queries
    const parts = query.split(/\s+(?:and|&|,)\s+/i);
    return parts.filter((p) => p.trim().length > 0);
  }
}

// ---------------------------------------------------------------------------
// ResultFusion
// ---------------------------------------------------------------------------

class ResultFusion {
  /** Fuse results from multiple strategies using weighted scores */
  fuse(
    sources: Array<{ strategy: QueryStrategy; entries: MemoryEntryV2[]; scores: Map<string, number> }>,
    config: RouterConfig
  ): MemoryEntryV2[] {
    const weights: Record<QueryStrategy, number> = {
      semantic: config.semanticWeight,
      keyword: config.keywordWeight,
      temporal: config.temporalWeight,
      relational: config.relationalWeight,
      hybrid: 1.0,
    };

    // Aggregate scores
    const aggregated = new Map<string, { entry: MemoryEntryV2; score: number }>();

    for (const source of sources) {
      const weight = weights[source.strategy];
      for (const [entryId, score] of source.scores) {
        const entry = source.entries.find((e) => e.id === entryId);
        if (!entry) continue;

        const existing = aggregated.get(entryId);
        if (existing) {
          existing.score += score * weight;
        } else {
          aggregated.set(entryId, { entry, score: score * weight });
        }
      }
    }

    // Filter by threshold and sort
    const results = Array.from(aggregated.values())
      .filter((r) => r.score >= config.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, config.maxResults)
      .map((r) => r.entry);

    return results;
  }
}

// ---------------------------------------------------------------------------
// QueryRouter
// ---------------------------------------------------------------------------

export class QueryRouter {
  private readonly classifier = new QueryClassifier();
  private readonly fusion = new ResultFusion();
  private readonly config: RouterConfig;

  constructor(
    private readonly memoryCore: MemoryCoreV2,
    private readonly vectorService?: VectorServiceV2,
    config?: Partial<RouterConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Route a query and return results. */
  async route(query: string, opts?: Partial<MemoryQuery>): Promise<RoutedResult> {
    const startTime = Date.now();

    // Classify query
    const plan = this.classifier.classify(query);

    // Execute based on strategy
    const sources: RoutedResult["sources"] = [];

    switch (plan.strategy) {
      case "semantic":
        sources.push(await this.executeSemantic(query, opts));
        break;
      case "keyword":
        sources.push(await this.executeKeyword(query, opts));
        break;
      case "temporal":
        sources.push(await this.executeTemporal(query, opts));
        break;
      case "relational":
        sources.push(await this.executeRelational(query, opts));
        break;
      case "hybrid":
        sources.push(...(await this.executeHybrid(query, opts)));
        break;
    }

    // Fuse results
    const fusionInput = sources.map((s) => ({
      strategy: s.strategy,
      entries: s.entries,
      scores: new Map(s.entries.map((e, i) => [e.id, 1 - i / s.entries.length])),
    }));

    const fused = this.fusion.fuse(fusionInput, this.config);

    const executionTimeMs = Date.now() - startTime;

    return {
      results: fused,
      plan,
      sources,
      executionTimeMs,
    };
  }

  // -------------------------------------------------------------------------
  // Strategy executors
  // -------------------------------------------------------------------------

  private async executeSemantic(
    query: string,
    opts?: Partial<MemoryQuery>
  ): Promise<RoutedResult["sources"][0]> {
    if (!this.vectorService) {
      return { strategy: "semantic", entries: [], score: 0 };
    }

    const results = await this.vectorService.semanticQuery(query, this.config.maxResults);

    // Fetch full entries
    const entries: MemoryEntryV2[] = [];
    for (const r of results) {
      const entry = await this.memoryCore.read(r.entryId);
      if (entry) entries.push(entry);
    }

    return {
      strategy: "semantic",
      entries,
      score: results.length > 0 ? results[0].semanticScore : 0,
    };
  }

  private async executeKeyword(
    query: string,
    opts?: Partial<MemoryQuery>
  ): Promise<RoutedResult["sources"][0]> {
    const result = await this.memoryCore.query({
      text: query,
      limit: this.config.maxResults,
      ...opts,
    });

    return {
      strategy: "keyword",
      entries: result.entries,
      score: result.entries.length > 0 ? 1 : 0,
    };
  }

  private async executeTemporal(
    query: string,
    opts?: Partial<MemoryQuery>
  ): Promise<RoutedResult["sources"][0]> {
    // Extract time range from query
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const result = await this.memoryCore.query({
      text: query,
      timeRange: { from: oneWeekAgo.toISOString() },
      limit: this.config.maxResults,
      ...opts,
    });

    return {
      strategy: "temporal",
      entries: result.entries,
      score: result.entries.length > 0 ? 1 : 0,
    };
  }

  private async executeRelational(
    query: string,
    opts?: Partial<MemoryQuery>
  ): Promise<RoutedResult["sources"][0]> {
    // First find seed entries
    const seed = await this.memoryCore.query({
      text: query,
      limit: 5,
      ...opts,
    });

    // Then find related entries
    const related: MemoryEntryV2[] = [];
    for (const entry of seed.entries) {
      const neighbors = await this.memoryCore.findRelated(entry.id, 1);
      related.push(...neighbors);
    }

    // Deduplicate
    const seen = new Set(seed.entries.map((e) => e.id));
    const uniqueRelated = related.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    return {
      strategy: "relational",
      entries: [...seed.entries, ...uniqueRelated].slice(0, this.config.maxResults),
      score: uniqueRelated.length > 0 ? 0.8 : 0.5,
    };
  }

  private async executeHybrid(
    query: string,
    opts?: Partial<MemoryQuery>
  ): Promise<RoutedResult["sources"]> {
    // Execute multiple strategies in parallel
    const [semantic, keyword, temporal] = await Promise.all([
      this.executeSemantic(query, opts),
      this.executeKeyword(query, opts),
      this.executeTemporal(query, opts),
    ]);

    return [semantic, keyword, temporal].filter((s) => s.entries.length > 0);
  }
}
