/**
 * Memory Cache — Multi-layer caching for memory operations.
 *
 * Features:
 * - In-memory LRU cache for hot entries
 * - Query result cache with TTL
 * - Cache invalidation on data changes
 * - Size limits and eviction policies
 */

import type { MemoryEntryV2 } from "../models/schema-v2.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheConfig {
  /** Max entries in memory cache */
  maxEntries: number;
  /** Query result TTL in ms */
  queryTtlMs: number;
  /** Entry TTL in ms (0 = no expiry) */
  entryTtlMs: number;
  /** Enable query caching */
  enableQueryCache: boolean;
}

const DEFAULT_CONFIG: CacheConfig = {
  maxEntries: 1000,
  queryTtlMs: 30000, // 30 seconds
  entryTtlMs: 0, // no expiry for entries
  enableQueryCache: true,
};

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  accessCount: number;
}

// ---------------------------------------------------------------------------
// LRUCache
// ---------------------------------------------------------------------------

class LRUCache<K, V> {
  private cache = new Map<K, CacheEntry<V>>();

  constructor(
    private maxSize: number,
    private ttlMs: number
  ) {}

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (this.ttlMs > 0 && Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // Update access stats
    entry.accessCount++;
    entry.timestamp = Date.now();

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  set(key: K, value: V): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      accessCount: 1,
    });
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (this.ttlMs > 0 && Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  size(): number {
    return this.cache.size;
  }

  keys(): K[] {
    return Array.from(this.cache.keys());
  }
}

// ---------------------------------------------------------------------------
// MemoryCache
// ---------------------------------------------------------------------------

export class MemoryCache {
  private entryCache: LRUCache<string, MemoryEntryV2>;
  private queryCache: LRUCache<string, MemoryEntryV2[]>;
  private config: CacheConfig;

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.entryCache = new LRUCache(this.config.maxEntries, this.config.entryTtlMs);
    this.queryCache = new LRUCache(100, this.config.queryTtlMs);
  }

  // -------------------------------------------------------------------------
  // Entry Cache
  // -------------------------------------------------------------------------

  /** Get entry from cache. */
  getEntry(id: string): MemoryEntryV2 | undefined {
    return this.entryCache.get(id);
  }

  /** Store entry in cache. */
  setEntry(id: string, entry: MemoryEntryV2): void {
    this.entryCache.set(id, entry);
  }

  /** Remove entry from cache. */
  invalidateEntry(id: string): void {
    this.entryCache.delete(id);
    // Also invalidate related query caches
    this.invalidateQueryCaches();
  }

  // -------------------------------------------------------------------------
  // Query Cache
  // -------------------------------------------------------------------------

  /** Get cached query results. */
  getQuery(key: string): MemoryEntryV2[] | undefined {
    if (!this.config.enableQueryCache) return undefined;
    return this.queryCache.get(key);
  }

  /** Store query results in cache. */
  setQuery(key: string, results: MemoryEntryV2[]): void {
    if (!this.config.enableQueryCache) return;
    this.queryCache.set(key, results);
  }

  /** Invalidate all query caches. */
  invalidateQueryCaches(): void {
    this.queryCache.clear();
  }

  // -------------------------------------------------------------------------
  // Bulk Operations
  // -------------------------------------------------------------------------

  /** Preload entries into cache. */
  preload(entries: MemoryEntryV2[]): void {
    for (const entry of entries) {
      this.setEntry(entry.id, entry);
    }
  }

  /** Clear all caches. */
  clear(): void {
    this.entryCache.clear();
    this.queryCache.clear();
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  /** Get cache statistics. */
  getStats(): {
    entryCacheSize: number;
    queryCacheSize: number;
    totalCached: number;
  } {
    return {
      entryCacheSize: this.entryCache.size(),
      queryCacheSize: this.queryCache.size(),
      totalCached: this.entryCache.size() + this.queryCache.size(),
    };
  }

  /** Generate query cache key from options. */
  static generateQueryKey(opts: Record<string, unknown>): string {
    return JSON.stringify(opts);
  }
}
