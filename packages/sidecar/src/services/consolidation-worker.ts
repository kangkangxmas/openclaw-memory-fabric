import type { AtomicMemoryCandidate, AtomicMemoryStore } from "./atomic-memory-store.js";
import type { MemoryConsolidator, ConsolidationResult } from "./memory-consolidator.js";

export interface ConsolidationWorkerStatus {
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
  lastResult?: ConsolidationResult;
}

export interface ConsolidationWorkerStartOptions {
  intervalMs?: number;
  limit?: number;
  agentId?: string;
  projectId?: string;
}

function clampLimit(value: number | undefined): number {
  return Math.max(1, Math.min(value ?? 100, 1000));
}

function clampInterval(value: number | undefined): number {
  return Math.max(1_000, Math.min(value ?? 30_000, 24 * 60 * 60 * 1000));
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
    this.state = {
      ...this.state,
      running: true,
      intervalMs: clampInterval(opts.intervalMs),
      limit: clampLimit(opts.limit),
      agentId: opts.agentId,
      projectId: opts.projectId,
      startedAt: new Date().toISOString(),
      stoppedAt: undefined,
      nextRunAt: new Date(Date.now() + clampInterval(opts.intervalMs)).toISOString(),
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
    const agentId = opts.agentId ?? this.state.agentId;
    const projectId = opts.projectId ?? this.state.projectId;
    try {
      const pending = await this.candidates.listAll({
        agentId,
        projectId,
        statuses: ["pending"],
        limit,
      });
      const groups = this.groupByScope(pending);
      const merged: ConsolidationResult = {
        processed: 0,
        promoted: 0,
        rejected: 0,
        needsReview: 0,
        superseded: 0,
        entries: [],
      };

      for (const group of groups) {
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
      }

      this.state = {
        ...this.state,
        lastRunAt: new Date().toISOString(),
        nextRunAt: this.state.running ? new Date(Date.now() + this.state.intervalMs).toISOString() : undefined,
        runCount: this.state.runCount + 1,
        lastError: undefined,
        lastResult: merged,
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
      const key = `${candidate.agentId}:${candidate.projectId ?? ""}`;
      if (!keys.has(key)) keys.set(key, { agentId: candidate.agentId, projectId: candidate.projectId });
    }
    return [...keys.values()];
  }
}
