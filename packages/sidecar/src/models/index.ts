export interface RecallRequest {
  agentId: string;
  projectId?: string;
  scope?: "private" | "project" | "shared" | "auto";
  depth?: "l0" | "l1" | "l2";
  query?: string;
  taskType?: string;
}

export interface RecallResponse {
  memoryBrief: string;
  sources: string[];
  budgetUsed: number;
  taskType?: string;
}

export interface CommitRequest {
  agentId: string;
  projectId?: string;
  facts?: string[];
  decisions?: string[];
  entities?: string[];
  patterns?: string[];
  unresolved?: string[];
  visibility?: "private" | "project_shared" | "org_shared";
  /** P0-1: Tool call names from this session (for experience distillation) */
  toolCalls?: Array<{ name: string }>;
  /** P0-1: Total assistant turn count (proxy for conversation depth) */
  turnCount?: number;
  /** P0-1: Pre-built session summary (plugin side) */
  sessionSummary?: string;
}

export interface CommitResponse {
  ok: true;
  committed: number;
  publishCandidates: string[];
  v2?: {
    mode: "off" | "shadow" | "v2-recall" | "v2-write";
    status: "off" | "queued" | "written" | "failed" | "unavailable";
    eventId?: string;
    candidateCount?: number;
    candidateIds?: string[];
    sourceRefs?: string[];
    legacyRole?: "primary" | "fallback";
    legacyStatus?: "written" | "failed";
    error?: string;
  };
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}
