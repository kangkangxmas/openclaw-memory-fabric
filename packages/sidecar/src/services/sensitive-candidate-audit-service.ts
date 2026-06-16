import { createHash } from "crypto";
import { join } from "path";
import type { SidecarConfig } from "../config/index.js";
import { appendJsonl, ensureFileDir, readJsonl } from "../utils/jsonl.js";
import { resolveV2BaseDir } from "../utils/v2-paths.js";

export type SensitiveCandidateAuditAction = "reject" | "quarantine" | "retract" | "delete";

export interface SensitiveCandidateAuditEntry {
  auditId: string;
  createdAt: string;
  action: SensitiveCandidateAuditAction;
  agentId: string;
  projectId?: string;
  candidateId: string;
  reason: string;
  promotedMemoryId?: string;
  previousMemoryStatus?: string;
  newMemoryStatus?: string;
  reviewedBy: string;
}

export interface ListSensitiveCandidateAuditOptions {
  agentId?: string;
  projectId?: string;
  candidateId?: string;
  limit?: number;
}

export class SensitiveCandidateAuditService {
  private readonly filePath: string;

  constructor(cfg: SidecarConfig["openviking"]) {
    this.filePath = join(resolveV2BaseDir(cfg), "ops", "sensitive-candidate-audit.jsonl");
  }

  async append(input: Omit<SensitiveCandidateAuditEntry, "auditId" | "createdAt">): Promise<SensitiveCandidateAuditEntry> {
    const createdAt = new Date().toISOString();
    const auditId = `sensitive_audit_${createHash("sha256")
      .update(JSON.stringify({ ...input, createdAt }))
      .digest("hex")
      .slice(0, 16)}`;
    const entry: SensitiveCandidateAuditEntry = {
      auditId,
      createdAt,
      ...input,
    };
    await ensureFileDir(this.filePath);
    await appendJsonl(this.filePath, entry);
    return entry;
  }

  async list(opts: ListSensitiveCandidateAuditOptions = {}): Promise<SensitiveCandidateAuditEntry[]> {
    const entries = await readJsonl<SensitiveCandidateAuditEntry>(this.filePath);
    return entries
      .filter((entry) => !opts.agentId || entry.agentId === opts.agentId)
      .filter((entry) => !opts.projectId || entry.projectId === opts.projectId)
      .filter((entry) => !opts.candidateId || entry.candidateId === opts.candidateId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, Math.max(1, Math.min(opts.limit ?? 100, 1000)));
  }
}
