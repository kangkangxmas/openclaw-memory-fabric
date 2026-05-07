/**
 * PatternStore — JSONL-based pattern persistence.
 *
 * Stores detected patterns alongside agent experiences:
 *   {openviking.basePath}/org/default/agents/{agentId}/patterns.jsonl
 */

import { join } from "path";
import { readJsonl, appendJsonl, ensureDir } from "../utils/jsonl.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Pattern {
  id: string;
  agentId: string;
  taskType: string;
  frequency: number;
  successRate: number;
  commonTools: string[];
  commonLessons: string[];
  firstSeen: number;
  lastSeen: number;
  confidence: number;
  detectedAt: number;
}

export interface PatternQuery {
  agentId: string;
  taskType?: string;
  minConfidence?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PATTERNS_FILENAME = "patterns.jsonl";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function storeDir(basePath: string, agentId: string): string {
  return join(basePath, "org", "default", "agents", agentId);
}

function storePath(basePath: string, agentId: string): string {
  return join(storeDir(basePath, agentId), PATTERNS_FILENAME);
}

// ---------------------------------------------------------------------------
// PatternStore
// ---------------------------------------------------------------------------

export class PatternStore {
  constructor(private readonly openvikingBasePath: string) {}

  /** Append a pattern and return its persistent path. */
  async append(pattern: Pattern): Promise<{ id: string; path: string }> {
    const dir = storeDir(this.openvikingBasePath, pattern.agentId);
    await ensureDir(dir);

    const filePath = join(dir, PATTERNS_FILENAME);
    await appendJsonl(filePath, pattern);

    return { id: pattern.id, path: filePath };
  }

  /** Query patterns for an agent with optional filters. */
  async query(q: PatternQuery): Promise<Pattern[]> {
    const filePath = storePath(this.openvikingBasePath, q.agentId);
    const entries = await readJsonl<Pattern>(filePath);

    let filtered = entries;
    if (q.taskType !== undefined) {
      filtered = filtered.filter((p) => p.taskType === q.taskType);
    }
    if (q.minConfidence !== undefined) {
      filtered = filtered.filter((p) => p.confidence >= q.minConfidence!);
    }

    // Newest-first
    filtered.sort((a, b) => b.detectedAt - a.detectedAt);

    const maxResults = q.limit ?? 100;
    return filtered.slice(0, maxResults);
  }

  /** Get patterns grouped by taskType. */
  async getByTaskType(agentId: string): Promise<Map<string, Pattern[]>> {
    const all = await this.query({ agentId });
    const map = new Map<string, Pattern[]>();
    for (const p of all) {
      const arr = map.get(p.taskType) ?? [];
      arr.push(p);
      map.set(p.taskType, arr);
    }
    return map;
  }

  /** Total patterns for an agent. */
  async totalCount(agentId: string): Promise<number> {
    const filePath = storePath(this.openvikingBasePath, agentId);
    return (await readJsonl<unknown>(filePath)).length;
  }
}
