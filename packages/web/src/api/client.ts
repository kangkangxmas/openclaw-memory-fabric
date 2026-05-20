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
};
