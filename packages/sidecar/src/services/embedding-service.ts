/**
 * EmbeddingService — generates text embeddings via local Ollama.
 *
 * P2-1: Calls the Ollama /api/embeddings endpoint (or OpenAI-compatible
 *   /embeddings if the model supports it). Falls back to null if unavailable.
 *
 * Supported models (local):
 *   - mxbai-embed-large
 *   - nomic-embed-text
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingConfig {
  baseUrl: string;    // e.g. http://127.0.0.1:11434
  model: string;      // e.g. nomic-embed-text
  apiKey?: string;
  timeoutMs?: number;
}

interface OllamaEmbedResponse {
  embedding: number[];
}

// ---------------------------------------------------------------------------
// EmbeddingService
// ---------------------------------------------------------------------------

/** E2: Simple LRU cache for embedding results */
const CACHE_MAX = 512;

export class EmbeddingService {
  private readonly cache = new Map<string, number[]>();

  constructor(private readonly config: EmbeddingConfig) {}

  /** Generate an embedding vector for the given text (with LRU cache). */
  async embed(text: string): Promise<number[] | null> {
    // E2: Check cache first
    const key = text.slice(0, 200); // truncate key for memory efficiency
    const cached = this.cache.get(key);
    if (cached) {
      // Move to end (most recent)
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs ?? 10_000
    );

    try {
      // Try Ollama native /api/embeddings first
      const res = await fetch(
        `${this.config.baseUrl}/api/embeddings`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.config.apiKey
              ? { Authorization: `Bearer ${this.config.apiKey}` }
              : {})
          },
          body: JSON.stringify({
            model: this.config.model,
            prompt: text
          }),
          signal: controller.signal
        }
      );

      if (!res.ok) {
        // Fallback: OpenAI-compatible /v1/embeddings
        const vec = await this.embedOpenAI(text, controller.signal);
        if (vec) this.cacheSet(key, vec);
        return vec;
      }

      const data = (await res.json()) as OllamaEmbedResponse;
      const result = data.embedding ?? null;
      if (result) this.cacheSet(key, result);
      return result;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private cacheSet(key: string, vec: number[]): void {
    this.cache.set(key, vec);
    if (this.cache.size > CACHE_MAX) {
      // Evict oldest (first inserted)
      const first = this.cache.keys().next().value;
      if (first !== undefined) this.cache.delete(first);
    }
  }

  private async embedOpenAI(
    text: string,
    signal: AbortSignal
  ): Promise<number[] | null> {
    try {
      const res = await fetch(
        `${this.config.baseUrl}/v1/embeddings`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.config.apiKey
              ? { Authorization: `Bearer ${this.config.apiKey}` }
              : {})
          },
          body: JSON.stringify({
            model: this.config.model,
            input: text
          }),
          signal
        }
      );

      if (!res.ok) return null;
      const data = (await res.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      return data.data?.[0]?.embedding ?? null;
    } catch {
      return null;
    }
  }
}
