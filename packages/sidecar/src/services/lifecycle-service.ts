/**
 * LifecycleService — memory lifecycle management.
 *
 * Phase D: Handles memory decay, capacity control, conflict detection,
 *   and garbage collection for all memory stores.
 *
 * D1: Decay scoring based on age and access frequency
 * D2: Capacity control — auto-compact JSONL files when over limit
 * D3: Conflict detection — optimistic locking via summary.json version
 * D4: Garbage collection — clean stale shared entries and expired drafts
 */

import { existsSync, readdirSync } from "fs";
import { readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { readJsonl, writeJsonl } from "../utils/jsonl.js";

import type { MemoryEntryV2, getMemoryAgeDays, isMemoryExpired } from "../models/schema-v2.js";
import type { SharedEntry } from "./shared-service.js";

// Backward compatibility type
import type { MemoryEntry } from "./openviking-service.js";

// ---------------------------------------------------------------------------
// D1: Decay scoring
// ---------------------------------------------------------------------------

/** How much a memory loses per day of age (0-1 range) */
const DECAY_RATE_PER_DAY = 0.02;
/** Minimum decay score — entries below this are eligible for eviction */
const MIN_DECAY_SCORE = 0.1;
/** Maximum age in days before an entry is considered for archival */
const _MAX_AGE_DAYS = 180;

/**
 * Compute a decay score for a memory entry.
 * Supports both V1 (MemoryEntry) and V2 (MemoryEntryV2) entries.
 * Score ranges from 1.0 (brand new) to ~0 (very old).
 * Type bonuses: decisions and patterns decay slower than facts.
 */
export function computeDecayScore(entry: MemoryEntry | MemoryEntryV2, now = Date.now()): number {
  // V2 entries use timeline.createdAt
  const createdAt = "timeline" in entry 
    ? entry.timeline.createdAt 
    : entry.createdAt;
  const ageMs = now - new Date(createdAt).getTime();
  const ageDays = ageMs / 86_400_000;

  // Base decay: exponential with configurable rate
  let score = Math.exp(-DECAY_RATE_PER_DAY * ageDays);

  // Type bonus: more important types decay slower
  if (entry.type === "decision") score *= 1.3;
  else if (entry.type === "pattern") score *= 1.2;
  else if (entry.type === "entity") score *= 1.1;
  // facts and unresolved get no bonus

  // Content length bonus: longer entries tend to be more substantive
  const content = "timeline" in entry ? entry.content : entry.content;
  if (content.length > 50) score *= 1.1;

  // V2: Access frequency bonus - frequently accessed memories decay slower
  if ("metadata" in entry && entry.metadata.accessCount) {
    const accessBonus = Math.min(entry.metadata.accessCount * 0.05, 0.3);
    score *= (1 + accessBonus);
  }

  return Math.min(1, Math.max(0, score));
}

// ---------------------------------------------------------------------------
// D2: Capacity control
// ---------------------------------------------------------------------------

/** Max memory entries per scope before compaction */
const MAX_MEMORY_ENTRIES = 1000;
/** After compaction, target this many entries */
const TARGET_ENTRIES = 750;

export interface CompactResult {
  path: string;
  before: number;
  after: number;
  removed: number;
}

/**
 * Compact a memories.jsonl file:
 * 1. Score all entries with decay
 * 2. Remove entries below MIN_DECAY_SCORE
 * 3. If still over TARGET_ENTRIES, keep highest-scoring entries
 * 4. Rewrite file
 */
export async function compactMemoryFile(
  memoriesPath: string
): Promise<CompactResult | null> {
  if (!existsSync(memoriesPath)) return null;

  const entries = await readJsonl<MemoryEntry>(memoriesPath);
  if (entries.length <= MAX_MEMORY_ENTRIES) {
    return null; // No compaction needed
  }

  const now = Date.now();
  const scored = entries.map((e) => ({
    entry: e,
    decay: computeDecayScore(e, now),
  }));

  // Remove entries below minimum
  let surviving = scored.filter((s) => s.decay >= MIN_DECAY_SCORE);

  // If still over target, keep highest-scoring
  if (surviving.length > TARGET_ENTRIES) {
    surviving.sort((a, b) => b.decay - a.decay);
    surviving = surviving.slice(0, TARGET_ENTRIES);
  }

  // Restore chronological order
  surviving.sort(
    (a, b) =>
      new Date(a.entry.createdAt).getTime() -
      new Date(b.entry.createdAt).getTime(),
  );

  const kept = surviving.map((s) => s.entry);
  await writeJsonl(memoriesPath, kept);

  return {
    path: memoriesPath,
    before: entries.length,
    after: kept.length,
    removed: entries.length - kept.length,
  };
}

// ---------------------------------------------------------------------------
// D3: Conflict detection — optimistic version locking
// ---------------------------------------------------------------------------

interface SummaryMeta {
  lastCommit: string;
  agentId: string;
  projectId?: string;
  scope: string;
  version?: number;
}

/**
 * Read summary.json and return current version.
 * Returns 0 if file doesn't exist or has no version field.
 */
export async function readSummaryVersion(summaryPath: string): Promise<number> {
  if (!existsSync(summaryPath)) return 0;
  try {
    const raw = await readFile(summaryPath, "utf-8");
    const meta = JSON.parse(raw) as SummaryMeta;
    return meta.version ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Attempt to update summary.json with version check.
 * Returns true if successful, false if version conflict detected.
 */
export async function updateSummaryWithVersion(
  summaryPath: string,
  update: Partial<SummaryMeta>,
  expectedVersion: number,
): Promise<boolean> {
  const currentVersion = await readSummaryVersion(summaryPath);
  if (currentVersion !== expectedVersion) {
    return false; // Conflict!
  }

  let existing: SummaryMeta = {
    lastCommit: "",
    agentId: "",
    scope: "project",
  };
  if (existsSync(summaryPath)) {
    try {
      existing = JSON.parse(
        await readFile(summaryPath, "utf-8"),
      ) as SummaryMeta;
    } catch {
      // corrupt file — overwrite
    }
  }

  const merged: SummaryMeta = {
    ...existing,
    ...update,
    version: currentVersion + 1,
  };

  await writeFile(summaryPath, JSON.stringify(merged, null, 2), "utf-8");
  return true;
}

// ---------------------------------------------------------------------------
// D4: Garbage collection
// ---------------------------------------------------------------------------

export interface GCResult {
  sharedRetracted: number;
  draftsRemoved: number;
  memoriesCompacted: CompactResult[];
}

/** Max age for retracted shared entries before permanent deletion */
const RETRACTED_MAX_AGE_DAYS = 30;
/** Max age for unreviewed skill drafts */
const DRAFT_MAX_AGE_DAYS = 60;

/**
 * Run garbage collection across all stores:
 *
 * 1. Purge retracted shared entries older than 30 days
 * 2. Remove expired skill drafts older than 60 days
 * 3. Compact any memory files that exceed capacity
 */
export async function runGarbageCollection(opts: {
  carriersRoot: string;
  openVikingBasePath: string;
  draftDir: string;
}): Promise<GCResult> {
  const result: GCResult = {
    sharedRetracted: 0,
    draftsRemoved: 0,
    memoriesCompacted: [],
  };

  // 1. Clean retracted shared entries
  const sharedBase = join(opts.carriersRoot, "shared");
  if (existsSync(sharedBase)) {
    result.sharedRetracted = await purgeRetractedShared(sharedBase);
  }

  // 2. Clean expired skill drafts
  if (existsSync(opts.draftDir)) {
    result.draftsRemoved = await purgeExpiredDrafts(opts.draftDir);
  }

  // 3. Compact memory files
  const agentsBase = join(
    opts.openVikingBasePath,
    "org",
    "default",
    "agents",
  );
  if (existsSync(agentsBase)) {
    const agents = readdirSync(agentsBase, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const agent of agents) {
      for (const scope of ["private", "project"]) {
        const memPath = join(agentsBase, agent, scope, "memories.jsonl");
        const compactResult = await compactMemoryFile(memPath);
        if (compactResult) {
          result.memoriesCompacted.push(compactResult);
        }
      }
    }
  }

  return result;
}

async function purgeRetractedShared(sharedBase: string): Promise<number> {
  let purged = 0;
  const cutoff = Date.now() - RETRACTED_MAX_AGE_DAYS * 86_400_000;

  // Scan all published-memory.jsonl files
  for (const subDir of ["org", "projects"]) {
    const base = join(sharedBase, subDir);
    if (!existsSync(base)) continue;

    const paths =
      subDir === "org"
        ? [join(base, "published-memory.jsonl")]
        : readdirSync(base, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => join(base, d.name, "published-memory.jsonl"));

    for (const filePath of paths) {
      if (!existsSync(filePath)) continue;
      const entries = await readJsonl<SharedEntry>(filePath);
      const before = entries.length;

      const kept = entries.filter((e) => {
        if (e.status !== "retracted") return true;
        const ts = new Date(e.createdAt).getTime();
        return ts >= cutoff;
      });

      if (kept.length < before) {
        await writeJsonl(filePath, kept);
        purged += before - kept.length;
      }
    }
  }

  return purged;
}

async function purgeExpiredDrafts(draftDir: string): Promise<number> {
  let removed = 0;
  const cutoff = Date.now() - DRAFT_MAX_AGE_DAYS * 86_400_000;

  const files = readdirSync(draftDir, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith(".md"));

  for (const f of files) {
    const filePath = join(draftDir, f.name);
    try {
      const content = await readFile(filePath, "utf-8");
      // Extract generation timestamp from the file
      const match = content.match(/自动生成于\s+(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)/);
      if (match) {
        const ts = new Date(match[1]).getTime();
        if (!isNaN(ts) && ts < cutoff) {
          await unlink(filePath);
          removed++;
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return removed;
}
