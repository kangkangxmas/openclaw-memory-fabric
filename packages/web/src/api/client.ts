import type {
  RecallRequest,
  RecallResponse,
  CarrierReadRequest,
  CarrierReadResponse,
  MemoryQuery,
  MemoryResponse,
  GraphResponse,
  HealthResponse,
  GraphQueryRequest,
  GraphPathRequest,
  GraphExplainRequest,
  ExperienceEntry,
  PatternEntry,
  SkillDraft,
  ReportEntry,
  LearningCurvePoint,
  FederationEntry,
  DependencyGraph,
  ApprovalEntry,
  V2RecallPlanResponse,
  V2RecallAuditEntry,
  V2TraceResponse,
  V2CarrierDriftReport,
  V2CarrierProjectionRecord,
  V2Candidate,
  V2CandidateStats,
  V2ConsolidationStatus,
  V2BenchCase,
  V2BenchFixtureSet,
  V2BenchReport,
  V2BenchSeedResult,
  V2GrayStatus,
  V2Relation,
} from "../types";

const BASE = "";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(`${BASE}${url}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  getHealth: () => get<HealthResponse>("/health"),

  getAgents: () =>
    get<{ ok: boolean; agents: string[] }>("/inspect/agents"),

  getProjects: (agentId: string) =>
    get<{ ok: boolean; projects: string[] }>(
      `/inspect/projects?agentId=${encodeURIComponent(agentId)}`,
    ),

  postRecall: (req: RecallRequest) =>
    post<RecallResponse>("/recall", req),

  postCarrierRead: (req: CarrierReadRequest) =>
    post<CarrierReadResponse>("/carrier/read", req),

  postInspectMemories: (req: MemoryQuery) =>
    post<MemoryResponse>("/inspect/memories", req),

  postInspectGraph: (projectId: string) =>
    post<GraphResponse>("/inspect/graph", { projectId }),

  getExperiences: (agentId: string) =>
    get<{ ok: boolean; count: number; entries: ExperienceEntry[] }>(
      `/inspect/experiences?agentId=${encodeURIComponent(agentId)}`,
    ),

  getPatterns: (agentId: string) =>
    get<{ ok: boolean; count: number; patterns: PatternEntry[] }>(
      `/patterns?agentId=${encodeURIComponent(agentId)}`,
    ),

  getSkillDrafts: () =>
    get<{ ok: boolean; count: number; drafts: SkillDraft[] }>(
      "/skills/drafts",
    ),

  getReport: (agentId: string, days = 30) =>
    get<{ ok: boolean; agentId: string; totalEntries: number; reports: ReportEntry[] }>(
      `/report?agentId=${encodeURIComponent(agentId)}&days=${days}`,
    ),

  getLearningCurve: (agentId: string, days = 30) =>
    get<{ ok: boolean; agentId: string; days: number; curve: LearningCurvePoint[] }>(
      `/inspect/learning-curve?agentId=${encodeURIComponent(agentId)}&days=${days}`,
    ),

  postGraphQuery: (req: GraphQueryRequest) =>
    post<{ nodes: GraphResponse["topNodes"] }>("/graph/query", req),

  postGraphPath: (req: GraphPathRequest) =>
    post<{ path: string[]; found: boolean }>("/graph/path", req),

  postGraphExplain: (req: GraphExplainRequest) =>
    post<{ explanation: string }>("/graph/explain", req),

  // Federation
  getFederationImport: (projectId: string) =>
    get<{ project: string; count: number; entries: FederationEntry[] }>(
      `/federation/import?projectId=${encodeURIComponent(projectId)}`,
    ),

  getDependencyGraph: () => get<DependencyGraph>("/federation/dependencies"),

  getPendingApprovals: (projectId?: string) =>
    get<{ ok: boolean; count: number; entries: ApprovalEntry[] }>(
      `/federation/approval/pending${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
    ),

  reviewApproval: (entryId: string, decision: "approved" | "rejected", reviewedBy: string) =>
    post<{ ok: boolean }>("/federation/approval/review", { entryId, decision, reviewedBy }),

  postV2RecallPlan: (req: {
    query: string;
    agentId?: string;
    projectId?: string;
    scope?: "private" | "project" | "shared";
    limit?: number;
  }) => post<V2RecallPlanResponse>("/v2/recall/plan", req),

  getV2RecallAudit: (agentId?: string, projectId?: string, limit = 20) =>
    get<{ ok: boolean; entries: V2RecallAuditEntry[]; count: number }>(
      `/v2/recall/audit${[
        agentId ? `agentId=${encodeURIComponent(agentId)}` : "",
        projectId ? `projectId=${encodeURIComponent(projectId)}` : "",
        `limit=${encodeURIComponent(String(limit))}`,
      ].filter(Boolean).join("&").replace(/^(.+)$/, "?$1")}`,
    ),

  getV2MemoryTrace: (memoryId: string) =>
    get<V2TraceResponse>(`/v2/memories/${encodeURIComponent(memoryId)}/trace`),

  getV2CarrierDrift: (agentId: string, projectId?: string) =>
    get<{ ok: boolean; report: V2CarrierDriftReport }>(
      `/v2/carriers/drift?agentId=${encodeURIComponent(agentId)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`,
    ),

  getV2Candidates: (agentId?: string, projectId?: string, status?: string) =>
    get<{ ok: boolean; candidates: V2Candidate[]; count: number }>(
      `/v2/memories/candidates${[
        agentId ? `agentId=${encodeURIComponent(agentId)}` : "",
        projectId ? `projectId=${encodeURIComponent(projectId)}` : "",
        status ? `status=${encodeURIComponent(status)}` : "",
      ].filter(Boolean).join("&").replace(/^(.+)$/, "?$1")}`,
    ),

  getV2CandidateStats: (agentId?: string, projectId?: string) =>
    get<{ ok: boolean; stats: V2CandidateStats }>(
      `/v2/memories/candidates/stats${[
        agentId ? `agentId=${encodeURIComponent(agentId)}` : "",
        projectId ? `projectId=${encodeURIComponent(projectId)}` : "",
      ].filter(Boolean).join("&").replace(/^(.+)$/, "?$1")}`,
    ),

  reviewV2Candidate: (candidateId: string, decision: "approve" | "reject", agentId?: string, reason?: string) =>
    post<{ ok: boolean; candidate?: V2Candidate; error?: string }>(
      `/v2/memories/candidates/${encodeURIComponent(candidateId)}/review`,
      { agentId, decision, reviewedBy: "inspector", reason },
    ),

  getV2ConsolidationStatus: (agentId?: string, projectId?: string) =>
    get<{ ok: boolean; status: V2ConsolidationStatus; candidateStats: V2CandidateStats }>(
      `/v2/consolidation/status${[
        agentId ? `agentId=${encodeURIComponent(agentId)}` : "",
        projectId ? `projectId=${encodeURIComponent(projectId)}` : "",
      ].filter(Boolean).join("&").replace(/^(.+)$/, "?$1")}`,
    ),

  startV2ConsolidationWorker: (agentId?: string, projectId?: string) =>
    post<{ ok: boolean; status: V2ConsolidationStatus }>("/v2/consolidation/worker/start", {
      agentId,
      projectId,
      intervalMs: 30_000,
      limit: 100,
    }),

  stopV2ConsolidationWorker: () =>
    post<{ ok: boolean; status: V2ConsolidationStatus }>("/v2/consolidation/worker/stop", {}),

  applyV2CarrierProjection: (agentId: string, projectId?: string) =>
    post<{ ok: boolean; projection: V2CarrierProjectionRecord }>("/v2/carriers/projection/apply", {
      agentId,
      projectId,
      limit: 100,
    }),

  rollbackV2CarrierProjection: (projectionId: string) =>
    post<{ ok: boolean; projection: V2CarrierProjectionRecord; error?: string }>("/v2/carriers/projection/rollback", {
      projectionId,
    }),

  getV2GraphRelations: (agentId?: string, projectId?: string, memoryId?: string) =>
    get<{ ok: boolean; relations: V2Relation[]; count: number }>(
      `/v2/graph/relations${[
        agentId ? `agentId=${encodeURIComponent(agentId)}` : "",
        projectId ? `projectId=${encodeURIComponent(projectId)}` : "",
        memoryId ? `memoryId=${encodeURIComponent(memoryId)}` : "",
      ].filter(Boolean).join("&").replace(/^(.+)$/, "?$1")}`,
    ),

  postV2BenchRun: (opts?: {
    agentId?: string;
    projectId?: string;
    limit?: number;
    useFixtures?: boolean;
    cases?: V2BenchCase[];
  }) => post<{ ok: boolean; report: V2BenchReport }>("/v2/bench/run", opts ?? {}),

  getV2BenchReport: () => get<{ ok: boolean; report: V2BenchReport | null }>("/v2/bench/report"),

  getV2BenchFixtures: () => get<V2BenchFixtureSet>("/v2/bench/fixtures"),

  postV2BenchFixtures: (cases: V2BenchCase[], mode: "replace" | "append" = "replace") =>
    post<V2BenchFixtureSet>("/v2/bench/fixtures", { cases, mode }),

  postV2BenchSeed: (agentId?: string, projectId?: string, useFixtures = false) =>
    post<{ ok: boolean; result: V2BenchSeedResult }>("/v2/bench/seed", {
      agentId,
      projectId,
      limit: 50,
      useFixtures,
    }),

  getV2GrayStatus: (agentId?: string, projectId?: string) =>
    get<V2GrayStatus>(
      `/v2/gray/status${[
        agentId ? `agentId=${encodeURIComponent(agentId)}` : "",
        projectId ? `projectId=${encodeURIComponent(projectId)}` : "",
      ].filter(Boolean).join("&").replace(/^(.+)$/, "?$1")}`,
    ),
};
