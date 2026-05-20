import type { SidecarConfig } from "../types/index.js";

// ---------------------------------------------------------------------------
// Request / Response shapes (mirror sidecar models)
// ---------------------------------------------------------------------------

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
}

export interface DistillRequest {
  agentId: string;
  projectId?: string;
  messages: Array<{ role: string; content: string }>;
}

export interface DistillResponse {
  facts: string[];
  decisions: string[];
  entities: string[];
  patterns: string[];
  unresolved: string[];
  publishCandidates: string[];
}

export interface CarrierReadRequest {
  agentId: string;
  projectId?: string;
  files?: string[];
}

export interface CarrierReadResult {
  filename: string;
  content: string;
  exists: boolean;
}

export interface CarrierReadResponse {
  carriers: CarrierReadResult[];
}

export interface CarrierMergeRequest {
  agentId: string;
  projectId?: string;
  patches: Array<{ filename: string; content: string }>;
}

export interface CarrierMergeResponse {
  merged: string[];
  skipped: string[];
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  phase: string;
  uptimeSeconds?: number;
  lastRefreshTime?: string;
  components?: {
    openviking?: { reachable: boolean; basePath: string };
    graphify?: { available: boolean; basePath: string };
    carriers?: { writable: boolean; root: string };
  };
}

export interface BootstrapRequest {
  projectId: string;
  paths: string[];
  mode?: "auto" | "full";
}

export interface BootstrapResponse {
  ok: boolean;
  projectId: string;
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
}

export interface StructuralBriefResponse {
  projectId: string;
  freshness: "fresh" | "stale" | "missing";
  coreNodes: string[];
  communities: string[];
  keyPaths: Array<{ from: string; to: string; why: string }>;
  unknowns: string[];
  recommendedRetrievalTargets: string[];
  summary: string;
}

export interface GraphQueryRequest {
  projectId: string;
  query: string;
  budget?: number;
}
export interface GraphPathRequest {
  projectId: string;
  from: string;
  to: string;
}
export interface GraphExplainRequest {
  projectId: string;
  query: string;
}

export interface SharedPublishItem {
  type: "fact" | "decision" | "entity" | "pattern" | "note";
  content: string;
  tags?: string[];
}

export interface SharedPublishRequest {
  sourceAgent: string;
  projectId: string;
  visibility?: "project_shared" | "org_shared";
  items: SharedPublishItem[];
}

export interface SharedPublishResponse {
  published: number;
  ids: string[];
  targetPath: string;
}

export interface SharedForgetRequest {
  projectId: string;
  query: string;
  sourceAgent?: string;
}

export interface SharedForgetResponse {
  retracted: number;
  notFound: number;
}

// ---------------------------------------------------------------------------
// SidecarClient
// ---------------------------------------------------------------------------

export class SidecarClientError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly status: number,
    message: string
  ) {
    super(`[sidecar] ${endpoint} → ${status}: ${message}`);
    this.name = "SidecarClientError";
  }
}

export class SidecarClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(cfg: SidecarConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    this.timeoutMs = cfg.timeoutMs;
  }

  // -------------------------------------------------------------------------
  // Generic request helper
  // -------------------------------------------------------------------------

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new SidecarClientError(path, res.status, text || res.statusText);
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // -------------------------------------------------------------------------
  // Public methods
  // -------------------------------------------------------------------------

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/health");
  }

  async recall(req: RecallRequest): Promise<RecallResponse> {
    return this.request<RecallResponse>("POST", "/recall", req);
  }

  async commit(req: CommitRequest): Promise<CommitResponse> {
    return this.request<CommitResponse>("POST", "/commit", req);
  }

  async distill(req: DistillRequest): Promise<DistillResponse> {
    return this.request<DistillResponse>("POST", "/distill", req);
  }

  async carrierRead(req: CarrierReadRequest): Promise<CarrierReadResponse> {
    return this.request<CarrierReadResponse>("POST", "/carrier/read", req);
  }

  async carrierMerge(req: CarrierMergeRequest): Promise<CarrierMergeResponse> {
    return this.request<CarrierMergeResponse>("POST", "/carrier/merge", req);
  }

  async carrierInit(agentId: string, projectId?: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>("POST", "/carrier/init", { agentId, projectId });
  }

  async bootstrap(req: BootstrapRequest): Promise<BootstrapResponse> {
    return this.request<BootstrapResponse>("POST", "/bootstrap", req);
  }

  async graphBrief(projectId: string): Promise<StructuralBriefResponse> {
    return this.request<StructuralBriefResponse>("POST", "/graph/brief", { projectId });
  }

  async graphQuery(req: GraphQueryRequest): Promise<{ nodes: unknown[] }> {
    return this.request<{ nodes: unknown[] }>("POST", "/graph/query", req);
  }

  async graphPath(req: GraphPathRequest): Promise<{ path: string[]; found: boolean }> {
    return this.request<{ path: string[]; found: boolean }>("POST", "/graph/path", req);
  }

  async graphExplain(req: GraphExplainRequest): Promise<{ explanation: string }> {
    return this.request<{ explanation: string }>("POST", "/graph/explain", req);
  }

  async sharedPublish(req: SharedPublishRequest): Promise<SharedPublishResponse> {
    return this.request<SharedPublishResponse>("POST", "/shared/publish", req);
  }

  async sharedForget(req: SharedForgetRequest): Promise<SharedForgetResponse> {
    return this.request<SharedForgetResponse>("POST", "/shared/forget", req);
  }

  async graphMaybeRefresh(opts: {
    projectId: string;
    paths: string[];
    autoRefresh: string;
  }): Promise<{ triggered: boolean; reason?: string }> {
    return this.request<{ triggered: boolean; reason?: string }>("POST", "/graph/maybe-refresh", opts);
  }
}
