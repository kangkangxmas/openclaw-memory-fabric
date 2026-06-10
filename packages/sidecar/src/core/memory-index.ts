/**
 * Memory Index — In-memory indexing for fast queries.
 *
 * Features:
 * - Inverted index for text search
 * - Type index for fast type filtering
 * - Tag index for tag-based queries
 * - Agent/Project index for scope filtering
 * - Time index for temporal queries
 * - Auto-rebuild on data changes
 */

import type { MemoryEntryV2, MemoryType } from "../models/schema-v2.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexConfig {
  /** Max entries before forcing rebuild */
  rebuildThreshold: number;
  /** Enable text tokenization */
  enableTextIndex: boolean;
  /** Min token length */
  minTokenLength: number;
  /** Stop words to ignore */
  stopWords: Set<string>;
}

const DEFAULT_CONFIG: IndexConfig = {
  rebuildThreshold: 1000,
  enableTextIndex: true,
  minTokenLength: 2,
  stopWords: new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "dare",
    "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by",
    "from", "as", "into", "through", "during", "before", "after", "above",
    "below", "between", "under", "again", "further", "then", "once", "here",
    "there", "when", "where", "why", "how", "all", "each", "few", "more",
    "most", "other", "some", "such", "no", "nor", "not", "only", "own",
    "same", "so", "than", "too", "very", "just", "and", "but", "if", "or",
    "because", "until", "while", "this", "that", "these", "those", "i",
    "me", "my", "myself", "we", "our", "ours", "ourselves", "you", "your",
    "yours", "yourself", "yourselves", "he", "him", "his", "himself", "she",
    "her", "hers", "herself", "it", "its", "itself", "they", "them", "their",
    "theirs", "themselves", "what", "which", "who", "whom", "whose", "am",
  ]),
};

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function tokenize(text: string, config: IndexConfig): string[] {
  const normalized = text.toLowerCase();
  const tokens: string[] = [];
  const chunks = normalized.match(/[\p{L}\p{N}_]+/gu) ?? [];

  for (const chunk of chunks) {
    if (chunk.length >= config.minTokenLength && !config.stopWords.has(chunk)) {
      tokens.push(chunk);
    }
    const cjkRuns = chunk.match(/[\p{Script=Han}]+/gu) ?? [];
    for (const run of cjkRuns) {
      for (let i = 0; i < run.length - 1; i++) {
        tokens.push(run.slice(i, i + 2));
      }
    }
  }

  return [
    ...new Set(
      tokens
        .filter((t) => t.length >= config.minTokenLength)
        .filter((t) => !config.stopWords.has(t))
    ),
  ];
}

// ---------------------------------------------------------------------------
// MemoryIndex
// ---------------------------------------------------------------------------

export class MemoryIndex {
  private textIndex = new Map<string, Set<string>>(); // token -> entryIds
  private typeIndex = new Map<MemoryType, Set<string>>(); // type -> entryIds
  private tagIndex = new Map<string, Set<string>>(); // tag -> entryIds
  private agentIndex = new Map<string, Set<string>>(); // agentId -> entryIds
  private projectIndex = new Map<string, Set<string>>(); // projectId -> entryIds
  private timeIndex: Array<{ id: string; createdAt: string }> = [];
  private entryMap = new Map<string, MemoryEntryV2>(); // id -> entry
  private dirty = false;
  private config: IndexConfig;

  constructor(config?: Partial<IndexConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Build / Rebuild
  // -------------------------------------------------------------------------

  /** Build index from entries. */
  build(entries: MemoryEntryV2[]): void {
    this.clear();
    for (const entry of entries) {
      this.add(entry);
    }
    this.dirty = false;
  }

  /** Clear all indexes. */
  clear(): void {
    this.textIndex.clear();
    this.typeIndex.clear();
    this.tagIndex.clear();
    this.agentIndex.clear();
    this.projectIndex.clear();
    this.timeIndex = [];
    this.entryMap.clear();
    this.dirty = false;
  }

  // -------------------------------------------------------------------------
  // Add / Remove / Update
  // -------------------------------------------------------------------------

  /** Add entry to index. */
  add(entry: MemoryEntryV2): void {
    this.entryMap.set(entry.id, entry);

    // Text index
    if (this.config.enableTextIndex) {
      const text = `${entry.content} ${entry.metadata?.tags?.join(" ") ?? ""}`;
      const tokens = tokenize(text, this.config);
      for (const token of tokens) {
        const set = this.textIndex.get(token) ?? new Set();
        set.add(entry.id);
        this.textIndex.set(token, set);
      }
    }

    // Type index
    const typeSet = this.typeIndex.get(entry.type) ?? new Set();
    typeSet.add(entry.id);
    this.typeIndex.set(entry.type, typeSet);

    // Tag index
    for (const tag of entry.metadata?.tags ?? []) {
      const tagSet = this.tagIndex.get(tag) ?? new Set();
      tagSet.add(entry.id);
      this.tagIndex.set(tag, tagSet);
    }

    // Agent index
    const agentSet = this.agentIndex.get(entry.agentId) ?? new Set();
    agentSet.add(entry.id);
    this.agentIndex.set(entry.agentId, agentSet);

    // Project index
    if (entry.projectId) {
      const projSet = this.projectIndex.get(entry.projectId) ?? new Set();
      projSet.add(entry.id);
      this.projectIndex.set(entry.projectId, projSet);
    }

    // Time index
    this.timeIndex.push({ id: entry.id, createdAt: entry.timeline.createdAt });

    this.dirty = true;
  }

  /** Remove entry from index. */
  remove(entryId: string): void {
    const entry = this.entryMap.get(entryId);
    if (!entry) return;

    this.entryMap.delete(entryId);

    // Remove from all indexes
    for (const [token, set] of this.textIndex) {
      set.delete(entryId);
      if (set.size === 0) this.textIndex.delete(token);
    }

    for (const [type, set] of this.typeIndex) {
      set.delete(entryId);
      if (set.size === 0) this.typeIndex.delete(type);
    }

    for (const [tag, set] of this.tagIndex) {
      set.delete(entryId);
      if (set.size === 0) this.tagIndex.delete(tag);
    }

    for (const [agent, set] of this.agentIndex) {
      set.delete(entryId);
      if (set.size === 0) this.agentIndex.delete(agent);
    }

    for (const [proj, set] of this.projectIndex) {
      set.delete(entryId);
      if (set.size === 0) this.projectIndex.delete(proj);
    }

    this.timeIndex = this.timeIndex.filter((t) => t.id !== entryId);
    this.dirty = true;
  }

  /** Update entry in index. */
  update(entry: MemoryEntryV2): void {
    this.remove(entry.id);
    this.add(entry);
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  /** Search by text tokens. */
  searchText(query: string): string[] {
    const tokens = tokenize(query, this.config);
    if (tokens.length === 0) return [];
    if (tokens.length === 1) return Array.from(this.textIndex.get(tokens[0]) ?? []);

    const scores = new Map<string, number>();
    for (const token of tokens) {
      const matches = this.textIndex.get(token);
      if (!matches) continue;
      for (const id of matches) {
        scores.set(id, (scores.get(id) ?? 0) + 1);
      }
    }

    return [...scores.entries()]
      .sort((a, b) => {
        const scoreDelta = b[1] - a[1];
        if (scoreDelta !== 0) return scoreDelta;
        return a[0].localeCompare(b[0]);
      })
      .map(([id]) => id);
  }

  /** Filter by type. */
  filterByType(type: MemoryType): string[] {
    return Array.from(this.typeIndex.get(type) ?? []);
  }

  /** Filter by tag. */
  filterByTag(tag: string): string[] {
    return Array.from(this.tagIndex.get(tag) ?? []);
  }

  /** Filter by agent. */
  filterByAgent(agentId: string): string[] {
    return Array.from(this.agentIndex.get(agentId) ?? []);
  }

  /** Filter by project. */
  filterByProject(projectId: string): string[] {
    return Array.from(this.projectIndex.get(projectId) ?? []);
  }

  /** Filter by time range. */
  filterByTime(from?: string, to?: string): string[] {
    return this.timeIndex
      .filter((t) => {
        if (from && t.createdAt < from) return false;
        if (to && t.createdAt > to) return false;
        return true;
      })
      .map((t) => t.id);
  }

  /** Combined query with multiple filters. */
  query(opts: {
    text?: string;
    types?: MemoryType[];
    tags?: string[];
    agentId?: string;
    projectId?: string;
    timeRange?: { from?: string; to?: string };
  }): string[] {
    let result: Set<string> | undefined;

    // Text search
    if (opts.text) {
      const matches = this.searchText(opts.text);
      if (matches.length === 0) return [];
      result = new Set(matches);
    }

    // Type filter
    if (opts.types && opts.types.length > 0) {
      const typeMatches = new Set<string>();
      for (const type of opts.types) {
        for (const id of this.filterByType(type)) {
          typeMatches.add(id);
        }
      }
      if (!result) {
        result = typeMatches;
      } else {
        for (const id of result) {
          if (!typeMatches.has(id)) result.delete(id);
        }
      }
    }

    // Tag filter
    if (opts.tags && opts.tags.length > 0) {
      const tagMatches = new Set<string>();
      for (const tag of opts.tags) {
        for (const id of this.filterByTag(tag)) {
          tagMatches.add(id);
        }
      }
      if (!result) {
        result = tagMatches;
      } else {
        for (const id of result) {
          if (!tagMatches.has(id)) result.delete(id);
        }
      }
    }

    // Agent filter
    if (opts.agentId) {
      const agentMatches = new Set(this.filterByAgent(opts.agentId));
      if (!result) {
        result = agentMatches;
      } else {
        for (const id of result) {
          if (!agentMatches.has(id)) result.delete(id);
        }
      }
    }

    // Project filter
    if (opts.projectId) {
      const projMatches = new Set(this.filterByProject(opts.projectId));
      if (!result) {
        result = projMatches;
      } else {
        for (const id of result) {
          if (!projMatches.has(id)) result.delete(id);
        }
      }
    }

    // Time filter
    if (opts.timeRange) {
      const timeMatches = new Set(this.filterByTime(opts.timeRange.from, opts.timeRange.to));
      if (!result) {
        result = timeMatches;
      } else {
        for (const id of result) {
          if (!timeMatches.has(id)) result.delete(id);
        }
      }
    }

    return result ? Array.from(result) : [];
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  /** Get index statistics. */
  getStats(): {
    totalEntries: number;
    textTokens: number;
    types: number;
    tags: number;
    agents: number;
    projects: number;
  } {
    return {
      totalEntries: this.entryMap.size,
      textTokens: this.textIndex.size,
      types: this.typeIndex.size,
      tags: this.tagIndex.size,
      agents: this.agentIndex.size,
      projects: this.projectIndex.size,
    };
  }

  /** Check if index needs rebuild. */
  needsRebuild(): boolean {
    return this.dirty && this.entryMap.size > this.config.rebuildThreshold;
  }
}
