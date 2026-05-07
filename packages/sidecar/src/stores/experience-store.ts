/**
 * ExperienceStore — JSONL-based experience entry storage.
 *
 * Each entry records a distilled summary of an agent session.
 * Stored alongside OpenViking memories at:
 *   {openviking.basePath}/org/default/agents/{agentId}/experiences.jsonl
 *
 * Zero external dependencies — consistent with the project's JSONL pattern.
 */

import { join } from "path";
import { readJsonl, appendJsonl, ensureDir } from "../utils/jsonl.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExperienceEntry {
  id: string;
  agentId: string;
  projectId?: string;
  /** Unix ms timestamp */
  timestamp: number;
  /** Classified task label, e.g. "code_review", "debug", "architecture" */
  taskType: string;
  /** Ordered list of tool names used in this session */
  toolsUsed: string[];
  /** Total tool call count */
  toolCount: number;
  /** Number of assistant turns (proxy for conversation depth) */
  turnCount: number;
  /** Subjective success assessment */
  success: boolean;
  /** Extracted reusable patterns (max 3) */
  patterns: string[];
  /** Extracted lessons (max 2) */
  lessons: string[];
  /** Estimated token cost for this session */
  tokenCost: number;
  /** Short outcome summary */
  outcome: string;
  /** P2-2: Self-assessment score (0-100) */
  selfScore?: number;
  /** P2-2: Explanation for the selfScore */
  scoreRationale?: string;
}

export interface ExperienceQuery {
  agentId: string;
  since?: number;
  until?: number;
  projectId?: string;
  taskType?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXPERIENCES_FILENAME = "experiences.jsonl";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newId(): string {
  return `exp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function storeDir(basePath: string, agentId: string): string {
  return join(basePath, "org", "default", "agents", agentId);
}

function storePath(basePath: string, agentId: string): string {
  return join(storeDir(basePath, agentId), EXPERIENCES_FILENAME);
}

/** Synchronous guard — skip sorting when count is the only concern. */
function queryUnsafe(
  entries: ExperienceEntry[],
  q: ExperienceQuery
): ExperienceEntry[] {
  let filtered = entries;
  const { since, until, projectId, taskType, limit } = q;

  if (since !== undefined) filtered = filtered.filter((e) => e.timestamp >= since);
  if (until !== undefined) filtered = filtered.filter((e) => e.timestamp <= until);
  if (projectId !== undefined) filtered = filtered.filter((e) => e.projectId === projectId);
  if (taskType !== undefined) filtered = filtered.filter((e) => e.taskType === taskType);

  // Newest-first sort if ordering matters (skip for count-only calls)
  filtered.sort((a, b) => b.timestamp - a.timestamp);

  const maxResults = limit ?? 100;
  return filtered.slice(0, maxResults);
}

// ---------------------------------------------------------------------------
// ExperienceStore
// ---------------------------------------------------------------------------

export class ExperienceStore {
  constructor(private readonly openvikingBasePath: string) {}

  /** Append a new experience entry and return its persistent path. */
  async append(
    entry: Omit<ExperienceEntry, "id">
  ): Promise<{ id: string; path: string }> {
    const dir = storeDir(this.openvikingBasePath, entry.agentId);
    await ensureDir(dir);

    const full: ExperienceEntry = {
      id: newId(),
      ...entry,
      timestamp: entry.timestamp ?? Date.now()
    };

    const filePath = join(dir, EXPERIENCES_FILENAME);
    await appendJsonl(filePath, full);

    return { id: full.id, path: filePath };
  }

  /** Query recent entries for an agent with optional filters. */
  async query(query: ExperienceQuery): Promise<ExperienceEntry[]> {
    const filePath = storePath(this.openvikingBasePath, query.agentId);
    const entries = await readJsonl<ExperienceEntry>(filePath);
    return queryUnsafe(entries, query);
  }

  /** Count entries by taskType for a time range. Avoids sort overhead. */
  async countByType(
    agentId: string,
    since: number
  ): Promise<Map<string, number>> {
    const filePath = storePath(this.openvikingBasePath, agentId);
    const entries = await readJsonl<ExperienceEntry>(filePath);

    const sinceSafe = since ?? 0;
    const counts = new Map<string, number>();
    for (const e of entries) {
      if (e.timestamp < sinceSafe) continue;
      counts.set(e.taskType, (counts.get(e.taskType) ?? 0) + 1);
    }
    return counts;
  }

  /** Total experience entries for an agent. */
  async totalCount(agentId: string): Promise<number> {
    const filePath = storePath(this.openvikingBasePath, agentId);
    return (await readJsonl<unknown>(filePath)).length;
  }
}
