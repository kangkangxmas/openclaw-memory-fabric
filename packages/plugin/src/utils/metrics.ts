/**
 * In-memory metric counters for the Memory Fabric plugin.
 * Intentionally simple — no external dependency, no persistence.
 * Surfaced via health_status tool so operators can inspect without logs.
 */

export interface PluginMetrics {
  recallCount: number;
  recallErrorCount: number;
  recallTotalMs: number;
  commitCount: number;
  commitErrorCount: number;
  commitTotalMs: number;
  degradedModeCount: number;
  sharedPublishCount: number;
  graphBootstrapCount: number;
  graphBootstrapTotalMs: number;
  graphQueryCount: number;
  graphQueryTotalMs: number;
  carrierMergeConflictCount: number;
}

function emptyMetrics(): PluginMetrics {
  return {
    recallCount: 0,
    recallErrorCount: 0,
    recallTotalMs: 0,
    commitCount: 0,
    commitErrorCount: 0,
    commitTotalMs: 0,
    degradedModeCount: 0,
    sharedPublishCount: 0,
    graphBootstrapCount: 0,
    graphBootstrapTotalMs: 0,
    graphQueryCount: 0,
    graphQueryTotalMs: 0,
    carrierMergeConflictCount: 0
  };
}

export class MetricsCollector {
  private readonly data: PluginMetrics = emptyMetrics();

  recordRecall(latencyMs: number, error = false): void {
    this.data.recallCount++;
    this.data.recallTotalMs += latencyMs;
    if (error) this.data.recallErrorCount++;
  }

  recordCommit(latencyMs: number, error = false): void {
    this.data.commitCount++;
    this.data.commitTotalMs += latencyMs;
    if (error) this.data.commitErrorCount++;
  }

  recordDegraded(): void {
    this.data.degradedModeCount++;
  }

  recordSharedPublish(): void {
    this.data.sharedPublishCount++;
  }

  recordGraphBootstrap(latencyMs: number): void {
    this.data.graphBootstrapCount++;
    this.data.graphBootstrapTotalMs += latencyMs;
  }

  recordGraphQuery(latencyMs: number): void {
    this.data.graphQueryCount++;
    this.data.graphQueryTotalMs += latencyMs;
  }

  recordCarrierMergeConflicts(count: number): void {
    this.data.carrierMergeConflictCount += count;
  }

  snapshot(): PluginMetrics & {
    recallAvgMs: number;
    commitAvgMs: number;
    graphBootstrapAvgMs: number;
    graphQueryAvgMs: number;
  } {
    const {
      recallCount,
      recallTotalMs,
      commitCount,
      commitTotalMs,
      graphBootstrapCount,
      graphBootstrapTotalMs,
      graphQueryCount,
      graphQueryTotalMs
    } = this.data;
    return {
      ...this.data,
      recallAvgMs: recallCount > 0 ? Math.round(recallTotalMs / recallCount) : 0,
      commitAvgMs: commitCount > 0 ? Math.round(commitTotalMs / commitCount) : 0,
      graphBootstrapAvgMs:
        graphBootstrapCount > 0 ? Math.round(graphBootstrapTotalMs / graphBootstrapCount) : 0,
      graphQueryAvgMs:
        graphQueryCount > 0 ? Math.round(graphQueryTotalMs / graphQueryCount) : 0
    };
  }
}
