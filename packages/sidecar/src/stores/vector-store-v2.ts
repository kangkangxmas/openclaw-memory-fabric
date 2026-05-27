/**
 * VectorStore V2 — Enhanced in-memory vector index with JSONL persistence.
 *
 * Features:
 * - Supports MemoryEmbedding format from Schema V2
 * - Agent-scoped vector storage
 * - Metadata tracking (dimensions, model version)
 * - Batch operations
 * - Compaction to remove duplicates
 */

import { join } from "path";
import { readJsonl, writeJsonl, appendJsonl, ensureDir } from "../utils/jsonl.js";
import type { MemoryEmbedding } from "../models/schema-v2.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VectorEntryV2 {
  entryId: string;
  agentId: string;
  text: string;
  vector: number[];
  createdAt: number;
  /** V2: Model info for validation */
  model?: string;
  dimensions?: number;
  modelVersion?: string;
}

export interface StoreStats {
  totalEntries: number;
  totalAgents: number;
  avgDimensions: number;
  models: Map<string, number>;
}

// ---------------------------------------------------------------------------
// VectorStoreV2
// ---------------------------------------------------------------------------

export class VectorStoreV2 {
  private readonly memory = new Map<string, VectorEntryV2>();
  private readonly filePath: string;
  private loaded = false;

  constructor(openvikingBasePath: string) {
    this.filePath = join(openvikingBasePath, "embeddings-v2.jsonl");
  }

  /** Load all vectors from disk into memory. Call once at startup. */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const entries = await readJsonl<VectorEntryV2>(this.filePath);
      for (const e of entries) {
        if (this.validateEntry(e)) {
          this.memory.set(e.entryId, e);
        }
      }
      this.loaded = true;
    } catch {
      // File may not exist yet
      this.loaded = true;
    }
  }

  /** Add a vector and persist asynchronously. */
  async add(entry: VectorEntryV2): Promise<void> {
    if (!this.validateEntry(entry)) {
      throw new Error(`Invalid vector entry: ${(entry as Partial<VectorEntryV2>).entryId ?? 'unknown'}`);
    }

    this.memory.set(entry.entryId, entry);
    await ensureDir(join(this.filePath, ".."));
    await appendJsonl(this.filePath, entry);
  }

  /** Add multiple vectors and persist. */
  async addBatch(entries: VectorEntryV2[]): Promise<{ added: number; failed: number }> {
    let added = 0;
    let failed = 0;

    for (const entry of entries) {
      try {
        await this.add(entry);
        added++;
      } catch {
        failed++;
      }
    }
    return { added, failed };

  }

  /** Retrieve a full entry by entryId. */
  get(entryId: string): VectorEntryV2 | undefined {
    return this.memory.get(entryId);
  }

  /** Retrieve just the vector. */
  getVector(entryId: string): number[] | undefined {
    return this.memory.get(entryId)?.vector;
  }

  /** Check if an entry exists. */
  has(entryId: string): boolean {
    return this.memory.has(entryId);
  }

  /** Remove a vector. */
  async remove(entryId: string): Promise<void> {
    this.memory.delete(entryId);
    await this.compact();
  }

  /** Iterate all vectors for brute-force search. */
  entries(): IterableIterator<[string, number[]]> {
    const iter = this.memory.entries();
    return {
      [Symbol.iterator](): IterableIterator<[string, number[]]> {
        return this;
      },
      next(): IteratorResult<[string, number[]]> {
        const result = iter.next();
        if (result.done) return { done: true, value: undefined };
        return { done: false, value: [result.value[0], result.value[1].vector] };
      },
    };
  }

  /** Get all entries for an agent. */
  getByAgent(agentId: string): VectorEntryV2[] {
    return Array.from(this.memory.values()).filter((e) => e.agentId === agentId);
  }

  /** Total count. */
  size(): number {
    return this.memory.size;
  }

  /** Get store statistics. */
  getStats(): StoreStats {
    const agents = new Set<string>();
    const models = new Map<string, number>();
    let totalDimensions = 0;

    for (const entry of this.memory.values()) {
      agents.add(entry.agentId);
      totalDimensions += entry.dimensions ?? entry.vector.length;
      if (entry.model) {
        models.set(entry.model, (models.get(entry.model) ?? 0) + 1);
      }
    }

    return {
      totalEntries: this.memory.size,
      totalAgents: agents.size,
      avgDimensions: this.memory.size > 0 ? Math.round(totalDimensions / this.memory.size) : 0,
      models,
    };
  }

  /** Compact the store: rewrite file without duplicates. */
  async compact(): Promise<void> {
    const entries = Array.from(this.memory.values());
    await writeJsonl(this.filePath, entries);
  }

  /** Clear all vectors. */
  async clear(): Promise<void> {
    this.memory.clear();
    try {
      const { unlink } = await import("fs/promises");
      await unlink(this.filePath);
    } catch {
      // File may not exist
    }
    // Reset loaded state so load() will work again
    this.loaded = false;
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  private validateEntry(entry: unknown): entry is VectorEntryV2 {
    if (!entry || typeof entry !== "object") return false;
    const e = entry as Partial<VectorEntryV2>;
    return (
      typeof e.entryId === "string" &&
      typeof e.agentId === "string" &&
      typeof e.text === "string" &&
      Array.isArray(e.vector) &&
      e.vector.length > 0 &&
      e.vector.every((v) => typeof v === "number") &&
      typeof e.createdAt === "number"
    );
  }
}
