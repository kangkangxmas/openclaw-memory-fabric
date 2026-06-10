/**
 * VectorService V2 — Semantic + TF-IDF hybrid retrieval with Schema V2 support.
 *
 * Features:
 * - Supports MemoryEmbedding format from Schema V2
 * - Enhanced hybrid scoring with configurable weights
 * - Batch indexing for multiple entries
 * - Vector store persistence
 * - Backward compatible with V1 VectorService
 */

import type { EmbeddingServiceV2 } from "./embedding-service-v2.js";
import type { MemoryEntryV2, MemoryEmbedding } from "../models/schema-v2.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HybridResultV2 {
  entryId: string;
  semanticScore: number;
  tfidfScore: number;
  hybridScore: number;
  /** V2: Source of the match */
  source?: "semantic" | "tfidf" | "hybrid";
}

export interface IndexOptions {
  /** Whether to overwrite existing vector */
  overwrite?: boolean;
  /** Optional pre-computed embedding */
  embedding?: MemoryEmbedding;
}

interface VectorStoreLike {
  add(entry: { entryId: string; agentId: string; text: string; vector: number[]; createdAt: number }): Promise<void>;
  entries(): IterableIterator<[string, number[]]>;
  has(entryId: string): boolean;
  remove(entryId: string): Promise<void>;
  size(): number;
  clear(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface HybridConfig {
  /** Weight for semantic score (0-1) */
  semanticWeight: number;
  /** Weight for TF-IDF score (0-1) */
  tfidfWeight: number;
  /** Minimum semantic score threshold */
  semanticThreshold: number;
  /** Minimum TF-IDF score threshold */
  tfidfThreshold: number;
}

const DEFAULT_HYBRID_CONFIG: HybridConfig = {
  semanticWeight: 0.6,
  tfidfWeight: 0.4,
  semanticThreshold: 0.1,
  tfidfThreshold: 0.01,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function normalizeScores(scores: Map<string, number>): Map<string, number> {
  const max = Math.max(...scores.values(), 1);
  const normalized = new Map<string, number>();
  for (const [id, score] of scores) {
    normalized.set(id, score / max);
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// VectorServiceV2
// ---------------------------------------------------------------------------

export class VectorServiceV2 {
  private readonly config: HybridConfig;

  constructor(
    private readonly store: VectorStoreLike,
    private readonly embedder: EmbeddingServiceV2,
    config?: Partial<HybridConfig>
  ) {
    this.config = { ...DEFAULT_HYBRID_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Query methods
  // -------------------------------------------------------------------------

  /**
   * Hybrid query: semantic (cosine) + TF-IDF combined.
   *
   * @param query       user query string
   * @param tfidfScores map of entryId → TF-IDF score (from OpenVikingService)
   * @param topK        number of results to return
   */
  async hybridQuery(
    query: string,
    tfidfScores: Map<string, number>,
    topK = 10
  ): Promise<HybridResultV2[]> {
    const queryVec = await this.embedder.embedVector(query);
    const normalizedTfidf = normalizeScores(tfidfScores);

    // If embedding failed, return pure TF-IDF results
    if (!queryVec) {
      return Array.from(normalizedTfidf.entries())
        .filter(([, score]) => score >= this.config.tfidfThreshold)
        .map(([entryId, tfidfScore]) => ({
          entryId,
          semanticScore: 0,
          tfidfScore,
          hybridScore: tfidfScore * this.config.tfidfWeight,
          source: "tfidf" as const,
        }))
        .sort((a, b) => b.hybridScore - a.hybridScore)
        .slice(0, topK);
    }

    const results: HybridResultV2[] = [];

    for (const [entryId, vec] of this.store.entries()) {
      if (vec.length !== queryVec.length) continue;

      const semanticScore = cosineSimilarity(queryVec, vec);
      const tfidfScore = normalizedTfidf.get(entryId) ?? 0;

      // Apply thresholds
      if (semanticScore < this.config.semanticThreshold && tfidfScore < this.config.tfidfThreshold) {
        continue;
      }

      const hybridScore = semanticScore * this.config.semanticWeight + tfidfScore * this.config.tfidfWeight;

      let source: "semantic" | "tfidf" | "hybrid" = "hybrid";
      if (semanticScore === 0) source = "tfidf";
      else if (tfidfScore === 0) source = "semantic";

      results.push({ entryId, semanticScore, tfidfScore, hybridScore, source });
    }

    // Also include TF-IDF-only results that aren't in vector store
    for (const [entryId, tfidfScore] of normalizedTfidf) {
      if (results.some((r) => r.entryId === entryId)) continue;
      if (tfidfScore >= this.config.tfidfThreshold) {
        results.push({
          entryId,
          semanticScore: 0,
          tfidfScore,
          hybridScore: tfidfScore * this.config.tfidfWeight,
          source: "tfidf" as const,
        });
      }
    }

    return results
      .sort((a, b) => b.hybridScore - a.hybridScore)
      .slice(0, topK);
  }

  /** Pure semantic query (no TF-IDF). */
  async semanticQuery(query: string, topK = 10): Promise<HybridResultV2[]> {
    const queryVec = await this.embedder.embedVector(query);
    if (!queryVec) return [];

    const results: HybridResultV2[] = [];
    for (const [entryId, vec] of this.store.entries()) {
      if (vec.length !== queryVec.length) continue;
      const semanticScore = cosineSimilarity(queryVec, vec);
      if (semanticScore >= this.config.semanticThreshold) {
        results.push({
          entryId,
          semanticScore,
          tfidfScore: 0,
          hybridScore: semanticScore,
          source: "semantic" as const,
        });
      }
    }

    return results
      .sort((a, b) => b.hybridScore - a.hybridScore)
      .slice(0, topK);
  }

  // -------------------------------------------------------------------------
  // Indexing methods
  // -------------------------------------------------------------------------

  /** Store a vector for an entry. */
  async index(entryId: string, agentId: string, text: string, opts?: IndexOptions): Promise<void> {
    // Check if already indexed and not overwriting
    if (!opts?.overwrite && this.store.has(entryId)) return;

    // Use pre-computed embedding if provided
    let vector: number[] | null = null;
    if (opts?.embedding?.vector) {
      vector = opts.embedding.vector;
    } else {
      vector = await this.embedder.embedVector(text);
    }

    if (!vector) return;

    await this.store.add({
      entryId,
      agentId,
      text,
      vector,
      createdAt: Date.now(),
    });
  }

  /** Index multiple entries in batch. */
  async indexBatch(
    items: Array<{ entryId: string; agentId: string; text: string; embedding?: MemoryEmbedding }>
  ): Promise<{ indexed: number; failed: number }> {
    let indexed = 0;
    let failed = 0;

    // Process in parallel with concurrency limit
    const CONCURRENCY = 5;
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const batch = items.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (item) => {
          try {
            await this.index(item.entryId, item.agentId, item.text, {
              embedding: item.embedding,
            });
            return true;
          } catch {
            return false;
          }
        })
      );
      for (const ok of results) {
        if (ok) indexed++;
        else failed++;
      }
    }

    return { indexed, failed };
  }

  /** Index a V2 MemoryEntry (uses getMemoryText for full content). */
  async indexEntry(entry: MemoryEntryV2): Promise<void> {
    const { getMemoryText } = await import("../models/schema-v2.js");
    const text = getMemoryText(entry);
    await this.index(entry.id, entry.agentId, text, {
      embedding: entry.embedding,
    });
  }

  // -------------------------------------------------------------------------
  // Management
  // -------------------------------------------------------------------------

  /** Remove a vector from the store. */
  async remove(entryId: string): Promise<void> {
    await this.store.remove(entryId);
  }

  /** Check if an entry is indexed. */
  has(entryId: string): boolean {
    return this.store.has(entryId);
  }

  /** Get store statistics. */
  getStats(): { size: number; dimensions?: number } {
    return {
      size: this.store.size(),
      dimensions: this.embedder.getDimensions() ?? undefined,
    };
  }

  /** Clear all vectors. */
  async clear(): Promise<void> {
    await this.store.clear();
  }
}
