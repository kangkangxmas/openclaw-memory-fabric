/**
 * VectorStore — in-memory vector index with JSONL persistence.
 *
 * P2-1: Loads all embeddings into a Map on startup for O(1) lookup.
 *   Writes are appended to embeddings.jsonl asynchronously.
 *   No external DB dependency (SQLite/PostgreSQL not required).
 */

import { join } from "path";
import { readJsonl, appendJsonl, ensureDir } from "../utils/jsonl.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VectorEntry {
  entryId: string;
  agentId: string;
  text: string;
  vector: number[];
  createdAt: number;
}

// ---------------------------------------------------------------------------
// VectorStore
// ---------------------------------------------------------------------------

export class VectorStore {
  private readonly memory = new Map<string, number[]>();
  private readonly filePath: string;

  constructor(openvikingBasePath: string) {
    this.filePath = join(openvikingBasePath, "embeddings.jsonl");
  }

  /** Load all vectors from disk into memory. Call once at startup. */
  async load(): Promise<void> {
    const entries = await readJsonl<VectorEntry>(this.filePath);
    for (const e of entries) {
      this.memory.set(e.entryId, e.vector);
    }
  }

  /** Add a vector and persist asynchronously. */
  async add(entry: VectorEntry): Promise<void> {
    this.memory.set(entry.entryId, entry.vector);
    await ensureDir(join(this.filePath, ".."));
    await appendJsonl(this.filePath, entry);
  }

  /** Retrieve a vector by entryId. */
  get(entryId: string): number[] | undefined {
    return this.memory.get(entryId);
  }

  /** Iterate all vectors for brute-force search. */
  entries(): IterableIterator<[string, number[]]> {
    return this.memory.entries();
  }

  /** Total count. */
  size(): number {
    return this.memory.size;
  }

  /** Check if an entry exists. */
  has(entryId: string): boolean {
    return this.memory.has(entryId);
  }

  /** Remove a vector. */
  async remove(entryId: string): Promise<void> {
    this.memory.delete(entryId);
  }

  /** Clear all vectors. */
  async clear(): Promise<void> {
    this.memory.clear();
  }
}
