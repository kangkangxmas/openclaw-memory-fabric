/**
 * Advanced Query — Aggregation, grouping, deduplication.
 *
 * Features:
 * - Aggregation (count, sum, avg by field)
 * - Grouping (by type, agent, tag, scope)
 * - Deduplication (by content similarity)
 * - Faceted search
 */

import type { MemoryEntryV2, MemoryType } from "../models/schema-v2.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AggregationOp = "count" | "sum" | "avg" | "min" | "max";

export interface AggregationSpec {
  /** Field to aggregate on */
  field: string;
  /** Aggregation operation */
  op: AggregationOp;
}

export interface AggregationResult {
  field: string;
  op: AggregationOp;
  value: number;
  groups?: Array<{ key: string; value: number }>;
}

export interface GroupResult {
  key: string;
  entries: MemoryEntryV2[];
  count: number;
}

export interface FacetResult {
  field: string;
  values: Array<{ key: string; count: number }>;
}

export interface DedupResult {
  unique: MemoryEntryV2[];
  duplicates: Array<{ kept: MemoryEntryV2; removed: MemoryEntryV2[] }>;
  totalBefore: number;
  totalAfter: number;
}

// ---------------------------------------------------------------------------
// Field Accessor
// ---------------------------------------------------------------------------

function getField(entry: MemoryEntryV2, field: string): unknown {
  const parts = field.split(".");
  let current: unknown = entry;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// AdvancedQuery
// ---------------------------------------------------------------------------

export class AdvancedQuery {
  // -------------------------------------------------------------------------
  // Aggregation
  // -------------------------------------------------------------------------

  /** Aggregate over entries. */
  aggregate(entries: MemoryEntryV2[], spec: AggregationSpec): AggregationResult {
    const values = entries
      .map((e) => getField(e, spec.field))
      .filter((v): v is number => typeof v === "number");

    let value: number;
    switch (spec.op) {
      case "count":
        value = entries.length;
        break;
      case "sum":
        value = values.reduce((a, b) => a + b, 0);
        break;
      case "avg":
        value = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        break;
      case "min":
        value = values.length > 0 ? Math.min(...values) : 0;
        break;
      case "max":
        value = values.length > 0 ? Math.max(...values) : 0;
        break;
    }

    return { field: spec.field, op: spec.op, value };
  }

  /** Aggregate with grouping. */
  aggregateGrouped(
    entries: MemoryEntryV2[],
    spec: AggregationSpec,
    groupBy: string
  ): AggregationResult {
    const groups = this.groupBy(entries, groupBy);
    const groupResults = Array.from(groups.entries()).map(([key, groupEntries]) => {
      const result = this.aggregate(groupEntries, spec);
      return { key, value: result.value };
    });

    return {
      field: spec.field,
      op: spec.op,
      value: groupResults.reduce((a, b) => a + b.value, 0),
      groups: groupResults,
    };
  }

  // -------------------------------------------------------------------------
  // Grouping
  // -------------------------------------------------------------------------

  /** Group entries by a field. */
  groupBy(entries: MemoryEntryV2[], field: string): Map<string, MemoryEntryV2[]> {
    const groups = new Map<string, MemoryEntryV2[]>();

    for (const entry of entries) {
      const value = getField(entry, field);
      const key = String(value ?? "undefined");
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }

    return groups;
  }

  /** Group entries and return structured results. */
  group(entries: MemoryEntryV2[], field: string): GroupResult[] {
    const groups = this.groupBy(entries, field);
    return Array.from(groups.entries()).map(([key, groupEntries]) => ({
      key,
      entries: groupEntries,
      count: groupEntries.length,
    }));
  }

  // -------------------------------------------------------------------------
  // Faceted Search
  // -------------------------------------------------------------------------

  /** Generate facets for a set of entries. */
  facets(entries: MemoryEntryV2[], fields: string[]): FacetResult[] {
    return fields.map((field) => {
      const valueCounts = new Map<string, number>();
      for (const entry of entries) {
        const value = getField(entry, field);
        if (Array.isArray(value)) {
          for (const v of value) {
            valueCounts.set(String(v), (valueCounts.get(String(v)) ?? 0) + 1);
          }
        } else if (value !== undefined) {
          valueCounts.set(String(value), (valueCounts.get(String(value)) ?? 0) + 1);
        }
      }

      return {
        field,
        values: Array.from(valueCounts.entries())
          .map(([key, count]) => ({ key, count }))
          .sort((a, b) => b.count - a.count),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------

  /** Deduplicate entries by content similarity. */
  deduplicate(
    entries: MemoryEntryV2[],
    options?: { similarity?: number; keyField?: string }
  ): DedupResult {
    const similarity = options?.similarity ?? 1.0; // 1.0 = exact match
    const keyField = options?.keyField ?? "content";

    const unique: MemoryEntryV2[] = [];
    const duplicates: Array<{ kept: MemoryEntryV2; removed: MemoryEntryV2[] }> = [];
    const seen = new Map<string, MemoryEntryV2>();

    for (const entry of entries) {
      const keyValue = String(getField(entry, keyField) ?? "");

      if (similarity >= 1.0) {
        // Exact dedup
        const existing = seen.get(keyValue);
        if (existing) {
          const dup = duplicates.find((d) => d.kept.id === existing.id);
          if (dup) {
            dup.removed.push(entry);
          } else {
            duplicates.push({ kept: existing, removed: [entry] });
          }
        } else {
          seen.set(keyValue, entry);
          unique.push(entry);
        }
      } else {
        // Fuzzy dedup (simple prefix-based for now)
        let matched = false;
        for (const [existingKey, existingEntry] of seen) {
          const overlap = computeOverlap(keyValue, existingKey);
          if (overlap >= similarity) {
            const dup = duplicates.find((d) => d.kept.id === existingEntry.id);
            if (dup) {
              dup.removed.push(entry);
            } else {
              duplicates.push({ kept: existingEntry, removed: [entry] });
            }
            matched = true;
            break;
          }
        }
        if (!matched) {
          seen.set(keyValue, entry);
          unique.push(entry);
        }
      }
    }

    return {
      unique,
      duplicates,
      totalBefore: entries.length,
      totalAfter: unique.length,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute simple word overlap ratio between two strings. */
function computeOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}
