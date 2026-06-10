import { createHash } from "crypto";
import { join } from "path";
import type { SidecarConfig } from "../config/index.js";
import { appendJsonl, ensureDir, readJsonl } from "../utils/jsonl.js";
import { resolveV2BaseDir } from "../utils/v2-paths.js";
import { validateId } from "../utils/path-guard.js";

export type EventSourceType =
  | "session"
  | "message"
  | "tool_call"
  | "file"
  | "diff"
  | "attachment"
  | "runtime"
  | "error";

export interface LedgerEvent {
  eventId: string;
  agentId: string;
  projectId?: string;
  sourceType: EventSourceType;
  sourceUri?: string;
  occurredAt: string;
  contentHash: string;
  summary: string;
  payload?: unknown;
  retention: "standard" | "short" | "long";
}

export interface AppendLedgerEventInput {
  agentId: string;
  projectId?: string;
  sourceType: EventSourceType;
  sourceUri?: string;
  occurredAt?: string;
  summary?: string;
  content?: string;
  payload?: unknown;
  retention?: "standard" | "short" | "long";
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function compactTimestamp(value: string): string {
  return value.replace(/[-:.TZ]/g, "").slice(0, 14);
}

export class EventLedgerService {
  private readonly root: string;

  constructor(cfg: SidecarConfig["openviking"]) {
    this.root = join(resolveV2BaseDir(cfg), "events");
  }

  async append(input: AppendLedgerEventInput): Promise<LedgerEvent> {
    validateId(input.agentId, "agentId");
    if (input.projectId) validateId(input.projectId, "projectId");

    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const hashInput = JSON.stringify({
      agentId: input.agentId,
      projectId: input.projectId,
      sourceType: input.sourceType,
      sourceUri: input.sourceUri,
      summary: input.summary,
      content: input.content,
      payload: input.payload,
    });
    const contentHash = sha256(hashInput);
    const eventId = `evt_${compactTimestamp(occurredAt)}_${contentHash.slice(-12)}`;

    const event: LedgerEvent = {
      eventId,
      agentId: input.agentId,
      projectId: input.projectId,
      sourceType: input.sourceType,
      sourceUri: input.sourceUri,
      occurredAt,
      contentHash,
      summary: (input.summary || input.content || input.sourceType).slice(0, 300),
      payload: input.payload,
      retention: input.retention ?? "standard",
    };

    const dir = this.agentDir(input.agentId);
    await ensureDir(dir);
    await appendJsonl(this.filePath(input.agentId), event);
    return event;
  }

  async list(opts: { agentId: string; projectId?: string; limit?: number }): Promise<LedgerEvent[]> {
    validateId(opts.agentId, "agentId");
    if (opts.projectId) validateId(opts.projectId, "projectId");
    const events = await readJsonl<LedgerEvent>(this.filePath(opts.agentId));
    const filtered = opts.projectId ? events.filter((event) => event.projectId === opts.projectId) : events;
    return filtered
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
      .slice(0, Math.max(1, Math.min(opts.limit ?? 50, 500)));
  }

  private agentDir(agentId: string): string {
    return join(this.root, agentId);
  }

  private filePath(agentId: string): string {
    return join(this.agentDir(agentId), "events.jsonl");
  }
}
