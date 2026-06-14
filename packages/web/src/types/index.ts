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

export interface MemoryCard {
  memoryId: string;
  type: string;
  time: string;
  confidence: number;
  content: string;
  evidence: string[];
  evidenceSummary?: string;
  tokenCost?: number;
  conflict?: string;
}

export interface V2RecallPlanResponse {
  ok: boolean;
  plan: {
    query: string;
    intent: string;
    reason: string;
  };
  cards: MemoryCard[];
  rendered: string;
  executionTimeMs: number;
  relations?: V2Relation[];
}

export interface V2RecallAuditEntry {
  auditId: string;
  agentId?: string;
  projectId?: string;
  query: string;
  mode: "off" | "shadow" | "v2-recall" | "v2-write" | string;
  legacy?: {
    sourceCount?: number;
    budgetUsed?: number;
    memoryBriefChars?: number;
    sources?: string[];
    memoryBriefPreview?: string;
  };
  v2?: {
    intent?: string;
    cardCount?: number;
    evidenceCount?: number;
    renderedChars?: number;
    executionTimeMs?: number;
    memoryIds?: string[];
    evidenceRefs?: string[];
    cardPreviews?: string[];
  };
  createdAt: string;
}

export interface V2TraceResponse {
  ok: boolean;
  memoryId: string;
  status: string;
  sourceRefs: string[];
  sources: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  relations?: V2Relation[];
}

export interface V2Candidate {
  candidateId: string;
  agentId: string;
  projectId?: string;
  type: string;
  content: string;
  sourceRefs: string[];
  confidence: number;
  status: "pending" | "needs_review" | "rejected" | "promoted";
  createdAt: string;
  updatedAt: string;
  promotedMemoryId?: string;
  reviewReason?: string;
  tags: string[];
}

export interface V2CandidateStats {
  total: number;
  byStatus: Record<V2Candidate["status"], number>;
  byType: Record<string, number>;
}

export interface V2ConsolidationStatus {
  running: boolean;
  intervalMs: number;
  limit: number;
  agentId?: string;
  projectId?: string;
  startedAt?: string;
  stoppedAt?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  errorCount: number;
  lastError?: string;
  lastResult?: Record<string, unknown>;
}

export interface CarrierDriftIssue {
  filename: string;
  memoryId: string;
  type: string;
  severity: "low" | "medium" | "high";
  message: string;
}

export interface V2CarrierDriftReport {
  agentId: string;
  projectId?: string;
  checkedAt: string;
  projectionVersion: string;
  issues: CarrierDriftIssue[];
  patches: Array<{ filename: string; content: string }>;
}

export interface V2CarrierProjectionRecord {
  projectionId: string;
  agentId: string;
  projectId?: string;
  projectionVersion: string;
  status: "applied" | "rolled_back";
  appliedAt: string;
  rolledBackAt?: string;
  patches: Array<{ filename: string; content: string }>;
  rollbackPatches: Array<{ filename: string; content: string }>;
  merged: string[];
  skipped: string[];
}

export interface V2Relation {
  relationId: string;
  agentId: string;
  projectId?: string;
  type: "DECIDES" | "IMPLEMENTS" | "SUPERSEDES" | "CAUSES" | "VALIDATES" | "CONSTRAINS";
  sourceKind: string;
  sourceId: string;
  targetKind: string;
  targetId: string;
  confidence: number;
  evidenceRefs: string[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface V2BenchReport {
  generatedAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  status?: "complete" | "partial" | "failed";
  cases: number;
  completedCases?: number;
  timedOutCases?: number;
  errorCount?: number;
  recallAt5: number;
  injectionPrecision: number;
  staleRate: number;
  sourceCoverage: number;
  avgCardChars: number;
  p95LatencyMs: number;
  errors?: Array<{
    id: string;
    message: string;
  }>;
  results: Array<{
    id: string;
    hit: boolean;
    cardCount: number;
    latencyMs: number;
    status?: "pass" | "miss" | "timeout" | "error";
    error?: string;
  }>;
}

export interface V2BenchActiveRun {
  runId: string;
  state: "running";
  startedAt: string;
  casesTotal: number;
  casesCompleted: number;
  caseTimeoutMs: number;
  totalTimeoutMs: number;
  lastCaseId?: string;
}

export interface V2BenchStatus {
  ok: boolean;
  state: "idle" | "running";
  activeRun?: V2BenchActiveRun;
  latestReport: {
    generatedAt: string;
    status: "complete" | "partial" | "failed";
    cases: number;
    completedCases: number;
    recallAt5: number;
    injectionPrecision: number;
    sourceCoverage: number;
    p95LatencyMs: number;
  } | null;
}

export interface V2BenchCase {
  id: string;
  query: string;
  expectedTerms: string[];
  agentId?: string;
  projectId?: string;
}

export interface V2BenchFixtureSet {
  ok: boolean;
  source: "persisted" | "empty";
  cases: V2BenchCase[];
  count: number;
}

export interface V2BenchSeedResult {
  agentId: string;
  projectId?: string;
  requested: number;
  skippedExisting: number;
  createdEvents: number;
  createdCandidates: number;
  promoted: number;
  needsReview: number;
  rejected: number;
  memoryIds: string[];
}

export interface V2GrayStatus {
  ok: boolean;
  mode: "off" | "shadow" | "v2-recall" | "v2-write";
  agentId: string;
  projectId?: string;
  worker: V2ConsolidationStatus;
  candidateStats: V2CandidateStats;
  recallAudit: {
    count: number;
    lastAt?: string;
    avgV2CardCount: number;
    avgV2EvidenceCount: number;
    avgV2RenderedChars: number;
    avgLegacySourceCount: number;
    avgLegacyMemoryBriefChars: number;
  };
  bench: V2BenchReport | null;
  readiness: {
    modeReady: boolean;
    sourceCoverageReady: boolean;
    latencyReady: boolean;
    candidateQueueHealthy: boolean;
  };
}

export interface V2CanaryCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
  value?: unknown;
}

export interface V2CanaryStatus {
  ok: boolean;
  status: "ready" | "warn" | "fail";
  mode: "off" | "shadow" | "v2-recall" | "v2-write";
  expectedMode?: string;
  agentId: string;
  projectId?: string;
  worker: V2ConsolidationStatus;
  candidateStats: V2CandidateStats;
  candidateSourceCoverage: number;
  recallAudit: {
    count: number;
    lastAt?: string;
    avgV2CardCount: number;
    avgV2EvidenceCount: number;
    avgV2ExecutionTimeMs: number;
  };
  bench: V2BenchReport | null;
  checks: V2CanaryCheck[];
}

export interface V2ContextHealthFileSummary {
  path: string;
  bytes: number;
  archived: boolean;
  kind: "transcript" | "trajectory";
}

export interface V2ContextHealthReport {
  ok: boolean;
  generatedAt: string;
  openclawRoot: string;
  thresholds: {
    activeTranscriptMaxBytes: number;
    trajectoryArchiveBytes: number;
  };
  files: {
    sessionCount: number;
    scannedFileCount: number;
    maxTranscriptBytes: number;
    maxTrajectoryBytes: number;
    activeTranscriptWarnings: V2ContextHealthFileSummary[];
    trajectoryArchiveCandidates: V2ContextHealthFileSummary[];
  };
  compaction: {
    compactionCount: number;
    overflowCount: number;
    timeoutCount: number;
    alreadyCompactedRecentlyCount: number;
    staleBriefDetailedInjectionCount: number;
    staleBriefSkippedCount: number;
  };
  warnings: string[];
}

export type V2Mode = "off" | "shadow" | "v2-recall" | "v2-write";

export interface V2RolloutModeRow {
  agentId: string;
  projectId?: string;
  mode: V2Mode;
  source: string;
  baseMode: V2Mode;
  baseSource: string;
  canRollback: boolean;
  updatedAt?: string;
  updatedBy?: string;
  reason?: string;
  candidateStats: V2CandidateStats;
  recallAudit: {
    count: number;
    lastAt?: string;
  };
  workerActive: boolean;
  health?: {
    status: "ready" | "warn" | "fail";
    warnings: string[];
    candidateSourceCoverage: number;
    sourceLessCandidates: number;
    candidateQueueHealthy: boolean;
    modeAllowsV2Recall: boolean;
    recallAuditPresent: boolean;
  };
}

export interface V2RolloutModesResponse {
  ok: boolean;
  generatedAt: string;
  defaultMode: V2Mode;
  modes: V2RolloutModeRow[];
  overrides: Array<{
    agentId: string;
    projectId?: string;
    mode: V2Mode;
    previousMode?: V2Mode;
    previousSource?: string;
    updatedAt: string;
    updatedBy: string;
    reason?: string;
  }>;
}

export type Page =
  | "overview"
  | "memory"
  | "graph"
  | "carriers"
  | "learning"
  | "federation"
  | "v2";
