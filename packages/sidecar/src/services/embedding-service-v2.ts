/**
 * Embedding Service V2 — Enhanced embedding generation with Schema V2 support.
 *
 * Features:
 * - Generates MemoryEmbedding structures compatible with Schema V2
 * - Batch embedding for multiple texts
 * - Model versioning and dimension tracking
 * - Enhanced caching with TTL
 * - Health check endpoint
 */

import type { MemoryEmbedding } from "../models/schema-v2.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingConfigV2 {
  baseUrl: string;      // e.g. http://127.0.0.1:11434
  model: string;        // e.g. nomic-embed-text
  apiKey?: string;
  timeoutMs?: number;
  /** Model version for embedding invalidation */
  modelVersion?: string;
  /** Expected dimensions (auto-detected if not set) */
  dimensions?: number;
}

interface OllamaEmbedResponse {
  embedding: number[];
}

interface OpenAIEmbedResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

interface CacheEntry {
  vector: number[];
  createdAt: number;
  modelVersion: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CACHE_MAX = 512;
const DEFAULT_CACHE_TTL_MS = 3600_000; // 1 hour
const DEFAULT_TIMEOUT_MS = 10_000;

// Known model dimensions
const MODEL_DIMENSIONS: Record<string, number> = {
  "nomic-embed-text": 768,
  "mxbai-embed-large": 1024,
  "all-minilm": 384,
};

// ---------------------------------------------------------------------------
// EmbeddingServiceV2
// ---------------------------------------------------------------------------

export class EmbeddingServiceV2 {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly config: Required<Pick<EmbeddingConfigV2, "timeoutMs" | "modelVersion">> &
    EmbeddingConfigV2;
  private detectedDimensions: number | null = null;

  constructor(config: EmbeddingConfigV2) {
    this.config = {
      ...config,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      modelVersion: config.modelVersion ?? "1.0",
    };
  }

  // -------------------------------------------------------------------------
  // Core embedding methods
  // -------------------------------------------------------------------------

  /** Generate a MemoryEmbedding for the given text. */
  async embed(text: string): Promise<MemoryEmbedding | null> {
    const vector = await this.embedVector(text);
    if (!vector) return null;

    return {
      model: this.config.model,
      dimensions: vector.length,
      vector,
      generatedAt: new Date().toISOString(),
      version: this.config.modelVersion,
    };
  }

  /** Generate raw vector (internal use). */
  async embedVector(text: string): Promise<number[] | null> {
    // Check cache
    const key = this.cacheKey(text);
    const cached = this.getFromCache(key);
    if (cached) return cached;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs
    );

    try {
      // Try Ollama native endpoint first
      const vec = await this.embedOllama(text, controller.signal);
      if (vec) {
        this.setCache(key, vec);
        return vec;
      }

      // Fallback to OpenAI-compatible endpoint
      const vec2 = await this.embedOpenAI(text, controller.signal);
      if (vec2) {
        this.setCache(key, vec2);
        return vec2;
      }

      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Batch embed multiple texts. */
  async embedBatch(texts: string[]): Promise<(MemoryEmbedding | null)[]> {
    // Check cache first for all
    const results: (MemoryEmbedding | null)[] = new Array(texts.length).fill(null);
    const pending: { index: number; text: string }[] = [];

    for (let i = 0; i < texts.length; i++) {
      const key = this.cacheKey(texts[i]);
      const cached = this.getFromCache(key);
      if (cached) {
        results[i] = {
          model: this.config.model,
          dimensions: cached.length,
          vector: cached,
          generatedAt: new Date().toISOString(),
          version: this.config.modelVersion,
        };
      } else {
        pending.push({ index: i, text: texts[i] });
      }
    }

    // Process pending in parallel with concurrency limit
    const CONCURRENCY = 5;
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);
      const embeddings = await Promise.all(
        batch.map((p) => this.embed(p.text))
      );
      for (let j = 0; j < batch.length; j++) {
        results[batch[j].index] = embeddings[j];
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Provider implementations
  // -------------------------------------------------------------------------

  private async embedOllama(
    text: string,
    signal: AbortSignal
  ): Promise<number[] | null> {
    try {
      const res = await fetch(`${this.config.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey
            ? { Authorization: `Bearer ${this.config.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          prompt: text,
        }),
        signal,
      });

      if (!res.ok) return null;

      const data = (await res.json()) as OllamaEmbedResponse;
      return data.embedding ?? null;
    } catch {
      return null;
    }
  }

  private async embedOpenAI(
    text: string,
    signal: AbortSignal
  ): Promise<number[] | null> {
    try {
      const res = await fetch(`${this.config.baseUrl}/v1/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.apiKey
            ? { Authorization: `Bearer ${this.config.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          input: text,
        }),
        signal,
      });

      if (!res.ok) return null;

      const data = (await res.json()) as OpenAIEmbedResponse;
      return data.data?.[0]?.embedding ?? null;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Caching
  // -------------------------------------------------------------------------

  private cacheKey(text: string): string {
    // Use first 200 chars + model version for cache key
    return `${this.config.modelVersion}:${text.slice(0, 200)}`;
  }

  private getFromCache(key: string): number[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.createdAt > DEFAULT_CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }

    // Check model version
    if (entry.modelVersion !== this.config.modelVersion) {
      this.cache.delete(key);
      return null;
    }

    // Move to end (LRU)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.vector;
  }

  private setCache(key: string, vector: number[]): void {
    this.cache.set(key, {
      vector,
      createdAt: Date.now(),
      modelVersion: this.config.modelVersion,
    });

    // Evict oldest if over limit
    if (this.cache.size > DEFAULT_CACHE_MAX) {
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  /** Get expected dimensions for the configured model. */
  getDimensions(): number | null {
    if (this.detectedDimensions) return this.detectedDimensions;
    return MODEL_DIMENSIONS[this.config.model] ?? null;
  }

  /** Update detected dimensions after first successful embedding. */
  private updateDimensions(vector: number[]): void {
    if (!this.detectedDimensions) {
      this.detectedDimensions = vector.length;
    }
  }

  /** Check if embedding service is healthy. */
  async healthCheck(): Promise<{
    ok: boolean;
    model: string;
    dimensions?: number;
    error?: string;
  }> {
    try {
      const test = await this.embedVector("health check");
      if (test) {
        this.updateDimensions(test);
        return {
          ok: true,
          model: this.config.model,
          dimensions: test.length,
        };
      }
      return { ok: false, model: this.config.model, error: "Empty response" };
    } catch (err) {
      return {
        ok: false,
        model: this.config.model,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Get cache statistics. */
  getCacheStats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.cache.size,
      maxSize: DEFAULT_CACHE_MAX,
      ttlMs: DEFAULT_CACHE_TTL_MS,
    };
  }

  /** Clear the embedding cache. */
  clearCache(): void {
    this.cache.clear();
  }
}
