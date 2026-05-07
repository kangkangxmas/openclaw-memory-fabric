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

export class EmbeddingService {
  constructor(private readonly config: EmbeddingConfig) {}

  /** Generate an embedding vector for the given text. */
  async embed(text: string): Promise<number[] | null> {
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
        return this.embedOpenAI(text, controller.signal);
      }

      const data = (await res.json()) as OllamaEmbedResponse;
      return data.embedding ?? null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
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
