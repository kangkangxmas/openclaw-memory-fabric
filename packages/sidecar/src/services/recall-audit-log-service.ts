import { createHash } from "crypto";
import { join } from "path";
import type { SidecarConfig } from "../config/index.js";
import { appendJsonl, ensureFileDir, readJsonl } from "../utils/jsonl.js";
import { validateId } from "../utils/path-guard.js";
import { resolveV2BaseDir } from "../utils/v2-paths.js";

export interface RecallAuditLogEntry {
  auditId: string;
  agentId?: string;
  projectId?: string;
  query: string;
  mode: string;
  legacy?: {
    sourceCount?: number;
    budgetUsed?: number;
    memoryBriefChars?: number;
  };
  v2?: {
    intent?: string;
    cardCount?: number;
    evidenceCount?: number;
    renderedChars?: number;
    executionTimeMs?: number;
  };
  createdAt: string;
}

export interface CreateRecallAuditInput extends Omit<RecallAuditLogEntry, "auditId" | "createdAt"> {}

export class RecallAuditLogService {
  private readonly filePath: string;

  constructor(cfg: SidecarConfig["openviking"]) {
    this.filePath = join(resolveV2BaseDir(cfg), "recall-audit", "logs.jsonl");
  }

  async append(input: CreateRecallAuditInput): Promise<RecallAuditLogEntry> {
    if (input.agentId) validateId(input.agentId, "agentId");
    if (input.projectId) validateId(input.projectId, "projectId");
    const createdAt = new Date().toISOString();
    const auditId = `audit_${createHash("sha256").update(JSON.stringify({ ...input, createdAt })).digest("hex").slice(0, 12)}`;
    const entry: RecallAuditLogEntry = { ...input, auditId, createdAt };
    await ensureFileDir(this.filePath);
    await appendJsonl(this.filePath, entry);
    return entry;
  }

  async list(opts: { agentId?: string; projectId?: string; limit?: number } = {}): Promise<RecallAuditLogEntry[]> {
    if (opts.agentId) validateId(opts.agentId, "agentId");
    if (opts.projectId) validateId(opts.projectId, "projectId");
    const entries = await readJsonl<RecallAuditLogEntry>(this.filePath);
    return entries
      .filter((entry) => !opts.agentId || entry.agentId === opts.agentId)
      .filter((entry) => !opts.projectId || entry.projectId === opts.projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, Math.max(1, Math.min(opts.limit ?? 100, 10_000)));
  }
}
