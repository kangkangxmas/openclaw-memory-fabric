export interface RecallRequest {
  agentId: string;
  projectId?: string;
  scope?: "private" | "project" | "shared" | "auto";
  depth?: "l0" | "l1" | "l2";
  query?: string;
}

export interface RecallResponse {
  memoryBrief: string;
  sources: string[];
  budgetUsed: number;
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
}

export interface CommitResponse {
  ok: true;
  committed: number;
  publishCandidates: string[];
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}
