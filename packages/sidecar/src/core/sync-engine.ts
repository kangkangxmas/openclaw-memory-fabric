/**
 * Sync Engine — Multi-instance synchronization and conflict resolution.
 *
 * Features:
 * - Snapshot-based sync state tracking
 * - Three-way merge for conflict resolution
 * - Vector clock for causal ordering
 * - Incremental sync (only changes since last sync)
 * - Configurable conflict strategies (last-write-wins, manual, merge)
 */

import type { MemoryEntryV2 } from "../models/schema-v2.js";
import { generateMemoryId } from "../models/schema-v2.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConflictStrategy = "last-write-wins" | "source-wins" | "target-wins" | "merge";

export interface SyncConfig {
  /** Conflict resolution strategy */
  conflictStrategy: ConflictStrategy;
  /** Sync batch size */
  batchSize: number;
  /** Max retries for failed syncs */
  maxRetries: number;
}

const DEFAULT_SYNC_CONFIG: SyncConfig = {
  conflictStrategy: "last-write-wins",
  batchSize: 100,
  maxRetries: 3,
};

export interface SyncSnapshot {
  /** Unique snapshot ID */
  id: string;
  /** Source instance ID */
  sourceId: string;
  /** Target instance ID */
  targetId: string;
  /** Last synced timestamp */
  lastSyncAt: string;
  /** Number of entries synced */
  entriesSynced: number;
  /** Number of conflicts resolved */
  conflictsResolved: number;
  /** Sync duration in ms */
  durationMs: number;
}

export interface SyncResult {
  /** Created entries on target */
  created: string[];
  /** Updated entries on target */
  updated: string[];
  /** Deleted entries on target */
  deleted: string[];
  /** Conflicts encountered */
  conflicts: SyncConflict[];
  /** Snapshot of this sync */
  snapshot: SyncSnapshot;
}

export interface SyncConflict {
  /** Entry ID */
  entryId: string;
  /** Source version */
  source: MemoryEntryV2;
  /** Target version */
  target: MemoryEntryV2;
  /** Resolved strategy */
  resolvedBy: ConflictStrategy;
  /** Resolved entry */
  resolved: MemoryEntryV2;
}

// ---------------------------------------------------------------------------
// Vector Clock
// ---------------------------------------------------------------------------

class VectorClock {
  private clock = new Map<string, number>();

  tick(nodeId: string): void {
    this.clock.set(nodeId, (this.clock.get(nodeId) ?? 0) + 1);
  }

  merge(other: VectorClock): void {
    for (const [nodeId, ts] of other.clock) {
      const current = this.clock.get(nodeId) ?? 0;
      this.clock.set(nodeId, Math.max(current, ts));
    }
  }

  happensBefore(other: VectorClock): boolean {
    let atLeastOneLess = false;
    for (const [nodeId, ts] of this.clock) {
      const otherTs = other.clock.get(nodeId) ?? 0;
      if (ts > otherTs) return false;
      if (ts < otherTs) atLeastOneLess = true;
    }
    return atLeastOneLess;
  }

  isConcurrent(other: VectorClock): boolean {
    return !this.happensBefore(other) && !other.happensBefore(this);
  }

  toJSON(): Record<string, number> {
    return Object.fromEntries(this.clock);
  }

  static fromJSON(data: Record<string, number>): VectorClock {
    const vc = new VectorClock();
    for (const [k, v] of Object.entries(data)) {
      vc.clock.set(k, v);
    }
    return vc;
  }
}

// ---------------------------------------------------------------------------
// SyncEngine
// ---------------------------------------------------------------------------

export class SyncEngine {
  private config: SyncConfig;
  private snapshots = new Map<string, SyncSnapshot>(); // key: sourceId:targetId

  constructor(config?: Partial<SyncConfig>) {
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Sync Operations
  // -------------------------------------------------------------------------

  /**
   * Sync entries from source to target.
   * Both source and target are arrays of entries (representing different instances).
   */
  sync(
    sourceEntries: MemoryEntryV2[],
    targetEntries: MemoryEntryV2[],
    sourceId: string,
    targetId: string
  ): SyncResult {
    const startTime = Date.now();
    const created: string[] = [];
    const updated: string[] = [];
    const deleted: string[] = [];
    const conflicts: SyncConflict[] = [];

    const targetMap = new Map(targetEntries.map((e) => [e.id, e]));
    const sourceMap = new Map(sourceEntries.map((e) => [e.id, e]));

    // Find created (in source but not in target)
    for (const [id, entry] of sourceMap) {
      if (!targetMap.has(id)) {
        created.push(id);
      }
    }

    // Find deleted (in target but not in source)
    for (const [id] of targetMap) {
      if (!sourceMap.has(id)) {
        deleted.push(id);
      }
    }

    // Find updated (in both, check version/timestamp)
    for (const [id, sourceEntry] of sourceMap) {
      const targetEntry = targetMap.get(id);
      if (targetEntry) {
        const sourceTime = new Date(sourceEntry.timeline.updatedAt).getTime();
        const targetTime = new Date(targetEntry.timeline.updatedAt).getTime();

        if (sourceTime !== targetTime || sourceEntry.timeline.version !== targetEntry.timeline.version) {
          // Check for conflict
          const sourceVc = sourceEntry.metadata?.custom?.vectorClock
            ? VectorClock.fromJSON(sourceEntry.metadata.custom.vectorClock as Record<string, number>)
            : new VectorClock();
          const targetVc = targetEntry.metadata?.custom?.vectorClock
            ? VectorClock.fromJSON(targetEntry.metadata.custom.vectorClock as Record<string, number>)
            : new VectorClock();

          if (sourceVc.isConcurrent(targetVc)) {
            // Conflict: resolve based on strategy
            const resolved = this.resolveConflict(sourceEntry, targetEntry);
            conflicts.push({
              entryId: id,
              source: sourceEntry,
              target: targetEntry,
              resolvedBy: this.config.conflictStrategy,
              resolved,
            });
          }
          updated.push(id);
        }
      }
    }

    // Build snapshot
    const snapshotKey = `${sourceId}:${targetId}`;
    const snapshot: SyncSnapshot = {
      id: generateMemoryId(),
      sourceId,
      targetId,
      lastSyncAt: new Date().toISOString(),
      entriesSynced: created.length + updated.length,
      conflictsResolved: conflicts.length,
      durationMs: Date.now() - startTime,
    };
    this.snapshots.set(snapshotKey, snapshot);

    return { created, updated, deleted, conflicts, snapshot };
  }

  // -------------------------------------------------------------------------
  // Conflict Resolution
  // -------------------------------------------------------------------------

  private resolveConflict(source: MemoryEntryV2, target: MemoryEntryV2): MemoryEntryV2 {
    switch (this.config.conflictStrategy) {
      case "source-wins":
        return source;
      case "target-wins":
        return target;
      case "last-write-wins": {
        const sourceTime = new Date(source.timeline.updatedAt).getTime();
        const targetTime = new Date(target.timeline.updatedAt).getTime();
        return sourceTime >= targetTime ? source : target;
      }
      case "merge":
        return this.mergeEntries(source, target);
      default:
        return source;
    }
  }

  /** Merge two entries by combining their content and metadata. */
  private mergeEntries(source: MemoryEntryV2, target: MemoryEntryV2): MemoryEntryV2 {
    const sourceTime = new Date(source.timeline.updatedAt).getTime();
    const targetTime = new Date(target.timeline.updatedAt).getTime();
    const latestVersion = Math.max(source.timeline.version, target.timeline.version);

    // Merge tags
    const sourceTags = source.metadata?.tags ?? [];
    const targetTags = target.metadata?.tags ?? [];
    const mergedTags = [...new Set([...sourceTags, ...targetTags])];

    // Merge relations
    const sourceRels = source.relations ?? [];
    const targetRels = target.relations ?? [];
    const relKeys = new Set<string>();
    const mergedRels = [...sourceRels, ...targetRels].filter((r) => {
      const key = `${r.type}:${r.targetId}`;
      if (relKeys.has(key)) return false;
      relKeys.add(key);
      return true;
    });

    // Use the later content
    const content = sourceTime >= targetTime ? source.content : target.content;

    return {
      ...target,
      content,
      timeline: {
        ...target.timeline,
        updatedAt: new Date(Math.max(sourceTime, targetTime)).toISOString(),
        version: latestVersion + 1,
      },
      metadata: {
        ...target.metadata,
        tags: mergedTags,
      },
      relations: mergedRels.length > 0 ? mergedRels : undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Incremental Sync
  // -------------------------------------------------------------------------

  /** Get entries changed since last sync. */
  getChangesSince(entries: MemoryEntryV2[], since: string): MemoryEntryV2[] {
    const sinceTime = new Date(since).getTime();
    return entries.filter((e) => new Date(e.timeline.updatedAt).getTime() > sinceTime);
  }

  // -------------------------------------------------------------------------
  // Snapshot Management
  // -------------------------------------------------------------------------

  /** Get last sync snapshot. */
  getLastSnapshot(sourceId: string, targetId: string): SyncSnapshot | undefined {
    return this.snapshots.get(`${sourceId}:${targetId}`);
  }

  /** Get all snapshots. */
  getAllSnapshots(): SyncSnapshot[] {
    return Array.from(this.snapshots.values());
  }

  /** Clear all snapshots. */
  clearSnapshots(): void {
    this.snapshots.clear();
  }
}
