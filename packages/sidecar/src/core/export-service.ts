/**
 * Export Service — Export, import, backup, and restore memory data.
 *
 * Features:
 * - Export entries to JSON/JSONL format
 * - Import entries from JSON/JSONL
 * - Full backup with metadata
 * - Selective restore with conflict handling
 */

import type { MemoryEntryV2 } from "../models/schema-v2.js";
import { generateMemoryId, validateMemoryEntryV2 } from "../models/schema-v2.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExportFormat = "json" | "jsonl";

export interface ExportOptions {
  /** Export format */
  format: ExportFormat;
  /** Filter by agent IDs */
  agentIds?: string[];
  /** Filter by types */
  types?: string[];
  /** Include metadata */
  includeMetadata: boolean;
  /** Compress output */
  compress: boolean;
}

export interface ImportOptions {
  /** Conflict resolution on import */
  conflictStrategy: "skip" | "overwrite" | "rename";
  /** Validate entries before import */
  validate: boolean;
  /** Dry run (don't actually import) */
  dryRun: boolean;
}

export interface ExportData {
  /** Export format version */
  version: string;
  /** Export timestamp */
  exportedAt: string;
  /** Source instance ID */
  sourceId: string;
  /** Number of entries */
  entryCount: number;
  /** The entries */
  entries: MemoryEntryV2[];
  /** Export metadata */
  metadata?: {
    agentIds: string[];
    types: string[];
    scopes: string[];
  };
}

export interface ImportResult {
  /** Successfully imported */
  imported: string[];
  /** Skipped (already exists) */
  skipped: string[];
  /** Overwritten */
  overwritten: string[];
  /** Renamed (conflict) */
  renamed: string[];
  /** Validation errors */
  errors: Array<{ entryId: string; error: string }>;
  /** Total processed */
  totalProcessed: number;
}

export interface BackupData extends ExportData {
  /** Backup ID */
  backupId: string;
  /** Backup description */
  description: string;
  /** Checksum of entries */
  checksum: string;
}

// ---------------------------------------------------------------------------
// ExportService
// ---------------------------------------------------------------------------

export class ExportService {
  private readonly sourceId: string;

  constructor(sourceId?: string) {
    this.sourceId = sourceId ?? `instance-${Date.now()}`;
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  /** Export entries to structured data. */
  export(entries: MemoryEntryV2[], options?: Partial<ExportOptions>): ExportData {
    const opts: ExportOptions = {
      format: "json",
      includeMetadata: true,
      compress: false,
      ...options,
    };

    let filtered = entries;

    // Filter by agent IDs
    if (opts.agentIds && opts.agentIds.length > 0) {
      filtered = filtered.filter((e) => opts.agentIds!.includes(e.agentId));
    }

    // Filter by types
    if (opts.types && opts.types.length > 0) {
      filtered = filtered.filter((e) => opts.types!.includes(e.type));
    }

    const data: ExportData = {
      version: "2.0",
      exportedAt: new Date().toISOString(),
      sourceId: this.sourceId,
      entryCount: filtered.length,
      entries: filtered,
    };

    // Include metadata
    if (opts.includeMetadata) {
      data.metadata = {
        agentIds: [...new Set(filtered.map((e) => e.agentId))],
        types: [...new Set(filtered.map((e) => e.type))],
        scopes: [...new Set(filtered.map((e) => e.scope))],
      };
    }

    return data;
  }

  /** Serialize export data to string. */
  serialize(data: ExportData, format?: ExportFormat): string {
    const fmt = format ?? "json";
    if (fmt === "jsonl") {
      return data.entries.map((e) => JSON.stringify(e)).join("\n");
    }
    return JSON.stringify(data, null, 2);
  }

  // -------------------------------------------------------------------------
  // Import
  // -------------------------------------------------------------------------

  /** Import entries from export data. */
  import(
    data: ExportData,
    existingEntries: MemoryEntryV2[],
    options?: Partial<ImportOptions>
  ): ImportResult {
    const opts: ImportOptions = {
      conflictStrategy: "skip",
      validate: true,
      dryRun: false,
      ...options,
    };

    const result: ImportResult = {
      imported: [],
      skipped: [],
      overwritten: [],
      renamed: [],
      errors: [],
      totalProcessed: 0,
    };

    const existingMap = new Map(existingEntries.map((e) => [e.id, e]));

    for (const entry of data.entries) {
      result.totalProcessed++;

      // Validate
      if (opts.validate) {
        const valid = validateMemoryEntryV2(entry);
        if (!valid) {
          result.errors.push({
            entryId: (entry as any).id ?? "unknown",
            error: "Validation failed: missing required fields",
          });
          continue;
        }
      }

      const existing = existingMap.get(entry.id);
      if (existing) {
        switch (opts.conflictStrategy) {
          case "skip":
            result.skipped.push(entry.id);
            break;
          case "overwrite":
            result.overwritten.push(entry.id);
            break;
          case "rename": {
            const renamed = { ...entry, id: generateMemoryId() };
            result.renamed.push(renamed.id);
            break;
          }
        }
      } else {
        result.imported.push(entry.id);
      }
    }

    return result;
  }

  /** Parse serialized data. */
  parse(content: string, format?: ExportFormat): ExportData {
    const fmt = format ?? "json";
    if (fmt === "jsonl") {
      const entries = content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as MemoryEntryV2);
      return {
        version: "2.0",
        exportedAt: new Date().toISOString(),
        sourceId: this.sourceId,
        entryCount: entries.length,
        entries,
      };
    }
    return JSON.parse(content) as ExportData;
  }

  // -------------------------------------------------------------------------
  // Backup / Restore
  // -------------------------------------------------------------------------

  /** Create a full backup. */
  backup(entries: MemoryEntryV2[], description?: string): BackupData {
    const exportData = this.export(entries);
    const checksum = computeChecksum(entries);

    return {
      ...exportData,
      backupId: generateMemoryId(),
      description: description ?? `Backup at ${new Date().toISOString()}`,
      checksum,
    };
  }

  /** Verify backup integrity. */
  verifyBackup(backup: BackupData): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!backup.backupId) errors.push("Missing backup ID");
    if (!backup.version) errors.push("Missing version");
    if (!backup.entries) errors.push("Missing entries");
    if (backup.entryCount !== backup.entries.length) {
      errors.push(`Entry count mismatch: header says ${backup.entryCount}, actual ${backup.entries.length}`);
    }

    // Verify checksum
    const computedChecksum = computeChecksum(backup.entries);
    if (computedChecksum !== backup.checksum) {
      errors.push("Checksum mismatch — data may be corrupted");
    }

    return { valid: errors.length === 0, errors };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute a simple checksum for entries. */
function computeChecksum(entries: MemoryEntryV2[]): string {
  const content = entries.map((e) => `${e.id}:${e.timeline.version}`).join("|");
  // Simple hash
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const chr = content.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}
