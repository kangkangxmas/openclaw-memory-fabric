import type { AtomicMemoryCandidate, AtomicMemoryStore } from "./atomic-memory-store.js";
import type { MemoryConsolidator, ConsolidationResult } from "./memory-consolidator.js";

export interface ConsolidationWorkerScope {
  agentId: string;
  projectId?: string;
}

export interface ConsolidationWorkerScopeResult extends ConsolidationWorkerScope {
  result?: ConsolidationResult;
  error?: string;
  lastRunAt: string;
}

export interface ConsolidationWorkerStatus {
  running: boolean;
  intervalMs: number;
  limit: number;
  agentId?: string;
  projectId?: string;
  scopes?: ConsolidationWorkerScope[];
  startedAt?: string;
  stoppedAt?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  errorCount: number;
  lastError?: string;
  lastResult?: ConsolidationResult;
  lastScopeResults?: ConsolidationWorkerScopeResult[];
}

export interface ConsolidationWorkerStartOptions {
  intervalMs?: number;
  limit?: number;
  agentId?: string;
  projectId?: string;
  scopes?: ConsolidationWorkerScope[];
}

function clampLimit(value: number | undefined): number {
  return Math.max(1, Math.min(value ?? 100, 1000));
}

function clampInterval(value: number | undefined): number {
  return Math.max(1_000, Math.min(value ?? 30_000, 24 * 60 * 60 * 1000));
}

function scopeKey(scope: ConsolidationWorkerScope): string {
  return `${scope.agentId}:${scope.projectId ?? ""}`;
}

function normalizeScopes(opts: ConsolidationWorkerStartOptions): ConsolidationWorkerScope[] | undefined {
  const scoped = new Map<string, ConsolidationWorkerScope>();
  for (const scope of opts.scopes ?? []) {
    if (!scope.agentId) continue;
    scoped.set(scopeKey(scope), { agentId: scope.agentId, projectId: scope.projectId });
  }
  if (scoped.size > 0) return [...scoped.values()];
  if (opts.agentId) return [{ agentId: opts.agentId, projectId: opts.projectId }];
  return undefined;
}

export class ConsolidationWorker {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private state: ConsolidationWorkerStatus = {
    running: false,
    intervalMs: 30_000,
    limit: 100,
    runCount: 0,
    errorCount: 0,
  };

  constructor(
    private readonly candidates: AtomicMemoryStore,
    private readonly consolidator: MemoryConsolidator
  ) {}

  start(opts: ConsolidationWorkerStartOptions = {}): ConsolidationWorkerStatus {
    if (this.timer) clearInterval(this.timer);
    const scopes = normalizeScopes(opts);
    const intervalMs = clampInterval(opts.intervalMs);
    const legacyScope = scopes && scopes.length === 1 ? scopes[0] : undefined;
    this.state = {
      ...this.state,
      running: true,
      intervalMs,
      limit: clampLimit(opts.limit),
      agentId: scopes ? legacyScope?.agentId : opts.agentId,
      projectId: scopes ? legacyScope?.projectId : opts.projectId,
      scopes,
      startedAt: new Date().toISOString(),
      stoppedAt: undefined,
      nextRunAt: new Date(Date.now() + intervalMs).toISOString(),
    };
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.state.intervalMs);
    return this.status();
  }

  stop(): ConsolidationWorkerStatus {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.state = {
      ...this.state,
      running: false,
      stoppedAt: new Date().toISOString(),
      nextRunAt: undefined,
    };
    return this.status();
  }

  status(): ConsolidationWorkerStatus {
    return { ...this.state };
  }

  async runOnce(opts: ConsolidationWorkerStartOptions = {}): Promise<ConsolidationWorkerStatus> {
    if (this.inFlight) return this.status();
    this.inFlight = true;
    const limit = clampLimit(opts.limit ?? this.state.limit);
    const scopes = normalizeScopes(opts) ?? this.state.scopes;
    const agentId = opts.agentId ?? (scopes ? undefined : this.state.agentId);
    const projectId = opts.projectId ?? (scopes ? undefined : this.state.projectId);
    try {
      const merged: ConsolidationResult = {
        processed: 0,
        promoted: 0,
        rejected: 0,
        needsReview: 0,
        superseded: 0,
        entries: [],
      };
      const groups = scopes ?? await this.pendingScopes({ agentId, projectId, limit });
      const scopeResults: ConsolidationWorkerScopeResult[] = [];
      const scopeErrors: string[] = [];

      for (const group of groups) {
        const lastRunAt = new Date().toISOString();
        try {
          const result = await this.consolidator.run({
            agentId: group.agentId,
            projectId: group.projectId,
            limit,
            statuses: ["pending"],
          });
          merged.processed += result.processed;
          merged.promoted += result.promoted;
          merged.rejected += result.rejected;
          merged.needsReview += result.needsReview;
          merged.superseded += result.superseded;
          merged.entries.push(...result.entries);
          scopeResults.push({ ...group, result, lastRunAt });
        } catch (error) {
          scopeResults.push({
            ...group,
            lastRunAt,
            error: error instanceof Error ? error.message : String(error),
          });
          scopeErrors.push(`${group.agentId}/${group.projectId ?? "*"}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      this.state = {
        ...this.state,
        lastRunAt: new Date().toISOString(),
        nextRunAt: this.state.running ? new Date(Date.now() + this.state.intervalMs).toISOString() : undefined,
        runCount: this.state.runCount + 1,
        errorCount: this.state.errorCount + (scopeErrors.length > 0 ? 1 : 0),
        lastError: scopeErrors.length > 0 ? scopeErrors.join("; ") : undefined,
        lastResult: merged,
        lastScopeResults: scopeResults,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        lastRunAt: new Date().toISOString(),
        nextRunAt: this.state.running ? new Date(Date.now() + this.state.intervalMs).toISOString() : undefined,
        errorCount: this.state.errorCount + 1,
        lastError: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.inFlight = false;
    }
    return this.status();
  }

  private groupByScope(candidates: AtomicMemoryCandidate[]): Array<{ agentId: string; projectId?: string }> {
    const keys = new Map<string, { agentId: string; projectId?: string }>();
    for (const candidate of candidates) {
      const key = scopeKey(candidate);
      if (!keys.has(key)) keys.set(key, { agentId: candidate.agentId, projectId: candidate.projectId });
    }
    return [...keys.values()];
  }

  private async pendingScopes(opts: {
    agentId?: string;
    projectId?: string;
    limit: number;
  }): Promise<Array<{ agentId: string; projectId?: string }>> {
    const pending = await this.candidates.listAll({
      agentId: opts.agentId,
      projectId: opts.projectId,
      statuses: ["pending"],
      limit: opts.limit,
    });
    return this.groupByScope(pending);
  }
}
