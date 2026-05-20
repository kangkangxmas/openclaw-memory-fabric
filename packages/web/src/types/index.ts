/* Types aligned with sidecar models */

export interface RecallRequest {
  agentId: string;
  projectId?: string;
  scope?: Scope;
  depth?: Depth;
  query?: string;
}

export interface RecallResponse {
  memoryBrief: string;
  sources: string[];
  budgetUsed: number;
}

export interface CarrierReadRequest {
  agentId: string;
  projectId?: string;
  files?: string[];
}

export interface CarrierFile {
  filename: string;
  exists: boolean;
  content?: string;
}

export interface CarrierReadResponse {
  carriers: CarrierFile[];
}

export interface MemoryQuery {
  agentId: string;
  projectId?: string;
  scope?: Scope;
  query?: string;
  limit?: number;
}

export interface MemoryEntry {
  createdAt: string;
  type: string;
  scope: string;
  content: string;
}

export interface MemoryResponse {
  totalEntries: number;
  scopesRead: string[];
  entries: MemoryEntry[];
}

export interface GraphNode {
  id: string;
  mentions: number;
  type: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface GraphResponse {
  nodeCount: number;
  edgeCount: number;
  report: string;
  topNodes: GraphNode[];
  topEdges: GraphEdge[];
}

export interface ExperienceEntry {
  id: string;
  agentId: string;
  projectId: string;
  timestamp: string;
  taskType: string;
  toolsUsed: string[];
  turnCount: number;
  success: boolean;
  patterns: string[];
  lessons: string[];
  outcome: string;
  selfScore?: number;
  scoreRationale?: string;
}

export interface PatternEntry {
  id: string;
  pattern: string;
  frequency: number;
  confidence: number;
  agentId: string;
  examples: string[];
  detectedAt: string;
}

export interface SkillDraft {
  id: string;
  name: string;
  description: string;
  trigger: string;
  body: string;
  sourcePatternId: string;
  createdAt: string;
}

export interface ReportEntry {
  agentId: string;
  totalEntries: number;
  avgScore: number;
  dimensions: Record<string, number>;
  rationale: string;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  uptimeSeconds: number;
  components: {
    openviking: { reachable: boolean };
    graphify: { available: boolean };
    carriers: { writable: boolean };
  };
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

export type Scope = "private" | "project" | "shared" | "auto";
export type Depth = "l0" | "l1" | "l2";

export interface LearningCurvePoint {
  date: string;
  experiences: number;
  avgScore: number | null;
  successRate: number;
  patterns: number;
}

export interface FederationEntry {
  id: string;
  sourceProject: string;
  targetProject: string;
  type: string;
  content: string;
  exportedBy: string;
  exportedAt: string;
  status: "active" | "revoked";
}

export interface ProjectDependency {
  from: string;
  to: string;
  sharedEntities: string[];
  strength: number;
  lastUpdated: string;
}

export interface DependencyGraph {
  projects: string[];
  dependencies: ProjectDependency[];
  generatedAt: string;
}

export interface ApprovalEntry {
  id: string;
  sourceAgent: string;
  projectId: string;
  content: string;
  type: string;
  status: "pending" | "approved" | "rejected";
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export type Page =
  | "overview"
  | "memory"
  | "graph"
  | "carriers"
  | "learning"
  | "federation";
