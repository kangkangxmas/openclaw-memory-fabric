export type MemoryScope = "private" | "project" | "shared" | "auto";

export type RecallDepth = "l0" | "l1" | "l2";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type GraphifyAutoRefresh = "manual" | "on-demand" | "scheduled";

export type OpenVikingMode = "local" | "remote";

export type DefaultVisibility = "private" | "project_shared" | "org_shared";

export interface RecallBudget {
  l0Tokens: number;
  l1Tokens: number;
  l2Tokens: number;
}

export interface SidecarConfig {
  baseUrl: string;
  timeoutMs: number;
}

export interface OpenVikingConfig {
  mode: OpenVikingMode;
  basePath: string;
  targetRoot: string;
}

export interface GraphifyConfig {
  basePath: string;
  autoBootstrap: boolean;
  autoRefresh: GraphifyAutoRefresh;
}

export interface PublishPolicyConfig {
  defaultVisibility: DefaultVisibility;
  allowOrgShared: boolean;
}

export interface ObservabilityConfig {
  logLevel: LogLevel;
  emitMetrics: boolean;
}

export interface MemoryFabricConfig {
  defaultScope: MemoryScope;
  recallBudget: RecallBudget;
  sidecar: SidecarConfig;
  openviking: OpenVikingConfig;
  graphify: GraphifyConfig;
  publishPolicy: PublishPolicyConfig;
  observability: ObservabilityConfig;
}

// Tool types

export interface HealthStatus {
  ok: true;
  packageName: string;
  version: string;
  phase: string;
  sidecarUrl: string;
  defaultScope: MemoryScope;
  uptimeSeconds: number;
}

// Core memory types

export interface MemoryBrief {
  agentId: string;
  projectId?: string;
  scope: MemoryScope;
  structuralNeeded: boolean;
  summary: string;
  keyFacts: string[];
  decisions: string[];
  entities: string[];
  unknowns: string[];
  nextBestActions: string[];
  sources: string[];
}

export interface DistillResult {
  facts: string[];
  decisions: string[];
  entities: string[];
  patterns: string[];
  unresolved: string[];
  publishCandidates: string[];
}

export interface SelfModel {
  currentGoal: string;
  understood: string[];
  uncertain: string[];
  missingEvidence: string[];
  preferredNextActions: string[];
  confidence: "low" | "medium" | "high";
  updatedAt: string;
}

export type TaskType =
  | "code_review"
  | "debug"
  | "architecture"
  | "devops"
  | "qa"
  | "documentation"
  | "refactor"
  | "general";

export interface StructuralBrief {
  projectId: string;
  freshness: "fresh" | "stale" | "missing";
  coreNodes: string[];
  communities: string[];
  keyPaths: Array<{ from: string; to: string; why: string }>;
  unknowns: string[];
  recommendedRetrievalTargets: string[];
  summary: string;
}
