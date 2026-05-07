/**
 * VectorService — semantic + TF-IDF hybrid retrieval.
 *
 * P2-1: Provides cosine-similarity-based semantic search backed by an
 *   in-memory vector index. Falls back to TF-IDF when embeddings are missing.
 *   Hybrid score = cosine × 0.6 + normalizedTFIDF × 0.4
 */

import type { VectorStore } from "../stores/vector-store.js";
import type { EmbeddingService } from "./embedding-service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HybridResult {
  entryId: string;
  semanticScore: number;
  tfidfScore: number;
  hybridScore: number;
}

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

// ---------------------------------------------------------------------------
// VectorService
// ---------------------------------------------------------------------------

export class VectorService {
  constructor(
    private readonly store: VectorStore,
    private readonly embedder: EmbeddingService
  ) {}

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
  ): Promise<HybridResult[]> {
    const queryVec = await this.embedder.embed(query);

    // If embedding failed, return pure TF-IDF results
    if (!queryVec) {
      return Array.from(tfidfScores.entries())
        .map(([entryId, tfidfScore]) => ({
          entryId,
          semanticScore: 0,
          tfidfScore,
          hybridScore: tfidfScore * 0.4
        }))
        .sort((a, b) => b.hybridScore - a.hybridScore)
        .slice(0, topK);
    }

    const results: HybridResult[] = [];
    const maxTfidf = Math.max(...tfidfScores.values(), 1);

    for (const [entryId, vec] of this.store.entries()) {
      if (vec.length !== queryVec.length) continue;

      const semanticScore = cosineSimilarity(queryVec, vec);
      const tfidfScore = tfidfScores.get(entryId) ?? 0;
      const normalizedTfidf = tfidfScore / maxTfidf;
      const hybridScore = semanticScore * 0.6 + normalizedTfidf * 0.4;

      results.push({ entryId, semanticScore, tfidfScore, hybridScore });
    }

    return results
      .sort((a, b) => b.hybridScore - a.hybridScore)
      .slice(0, topK);
  }

  /** Pure semantic query (no TF-IDF). */
  async semanticQuery(query: string, topK = 10): Promise<HybridResult[]> {
    const queryVec = await this.embedder.embed(query);
    if (!queryVec) return [];

    const results: HybridResult[] = [];
    for (const [entryId, vec] of this.store.entries()) {
      if (vec.length !== queryVec.length) continue;
      const semanticScore = cosineSimilarity(queryVec, vec);
      results.push({ entryId, semanticScore, tfidfScore: 0, hybridScore: semanticScore });
    }

    return results
      .sort((a, b) => b.hybridScore - a.hybridScore)
      .slice(0, topK);
  }

  /** Store a vector for an entry. */
  async index(entryId: string, agentId: string, text: string): Promise<void> {
    const vector = await this.embedder.embed(text);
    if (!vector) return;

    await this.store.add({
      entryId,
      agentId,
      text,
      vector,
      createdAt: Date.now()
    });
  }
}
