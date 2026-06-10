import { useState } from "react";
import type { AppContext } from "../App";
import type {
  MemoryCard,
  V2BenchReport,
  V2CarrierDriftReport,
  V2CarrierProjectionRecord,
  V2Candidate,
  V2CandidateStats,
  V2ConsolidationStatus,
  V2BenchFixtureSet,
  V2BenchSeedResult,
  V2GrayStatus,
  V2RecallPlanResponse,
  V2Relation,
  V2TraceResponse,
} from "../types";
import { api } from "../api/client";

interface V2InspectorProps {
  ctx: AppContext;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function scopeForV2(scope: AppContext["scope"]): "private" | "project" | "shared" | undefined {
  return scope === "auto" ? undefined : scope;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-lg font-bold text-ink">{value}</div>
    </div>
  );
}

export function V2Inspector({ ctx }: V2InspectorProps) {
  const [query, setQuery] = useState("继续上次 Memory Fabric v2 改造任务");
  const [recall, setRecall] = useState<V2RecallPlanResponse | null>(null);
  const [trace, setTrace] = useState<V2TraceResponse | null>(null);
  const [traceId, setTraceId] = useState("");
  const [drift, setDrift] = useState<V2CarrierDriftReport | null>(null);
  const [candidates, setCandidates] = useState<V2Candidate[]>([]);
  const [candidateStats, setCandidateStats] = useState<V2CandidateStats | null>(null);
  const [worker, setWorker] = useState<V2ConsolidationStatus | null>(null);
  const [projection, setProjection] = useState<V2CarrierProjectionRecord | null>(null);
  const [relations, setRelations] = useState<V2Relation[]>([]);
  const [bench, setBench] = useState<V2BenchReport | null>(null);
  const [fixtures, setFixtures] = useState<V2BenchFixtureSet | null>(null);
  const [seed, setSeed] = useState<V2BenchSeedResult | null>(null);
  const [gray, setGray] = useState<V2GrayStatus | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (name: string, fn: () => Promise<void>) => {
    setLoading(name);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  };

  const loadRecall = async () => {
    if (!query.trim()) return;
    const res = await api.postV2RecallPlan({
      query,
      agentId: ctx.agentId || undefined,
      projectId: ctx.projectId || undefined,
      scope: scopeForV2(ctx.scope),
      limit: 8,
    });
    setRecall(res);
    const firstCard = res.cards[0];
    if (firstCard) setTraceId(firstCard.memoryId);
  };

  const loadTrace = async (memoryId = traceId) => {
    if (!memoryId.trim()) return;
    const res = await api.getV2MemoryTrace(memoryId.trim());
    setTrace(res);
    setTraceId(memoryId.trim());
  };

  const loadDrift = async () => {
    if (!ctx.agentId) return;
    const res = await api.getV2CarrierDrift(ctx.agentId, ctx.projectId || undefined);
    setDrift(res.report);
  };

  const loadOps = async () => {
    const [candidateRes, statusRes, relationRes, grayRes, fixtureRes] = await Promise.all([
      api.getV2Candidates(ctx.agentId || undefined, ctx.projectId || undefined),
      api.getV2ConsolidationStatus(ctx.agentId || undefined, ctx.projectId || undefined),
      api.getV2GraphRelations(ctx.agentId || undefined, ctx.projectId || undefined),
      api.getV2GrayStatus(ctx.agentId || undefined, ctx.projectId || undefined),
      api.getV2BenchFixtures(),
    ]);
    setCandidates(candidateRes.candidates);
    setCandidateStats(statusRes.candidateStats);
    setWorker(statusRes.status);
    setRelations(relationRes.relations);
    setGray(grayRes);
    setFixtures(fixtureRes);
    if (grayRes.bench) setBench(grayRes.bench);
  };

  const reviewCandidate = async (candidate: V2Candidate, decision: "approve" | "reject") => {
    await api.reviewV2Candidate(candidate.candidateId, decision, candidate.agentId);
    await loadOps();
  };

  const startWorker = async () => {
    const res = await api.startV2ConsolidationWorker(ctx.agentId || undefined, ctx.projectId || undefined);
    setWorker(res.status);
  };

  const stopWorker = async () => {
    const res = await api.stopV2ConsolidationWorker();
    setWorker(res.status);
  };

  const applyProjection = async () => {
    if (!ctx.agentId) return;
    const res = await api.applyV2CarrierProjection(ctx.agentId, ctx.projectId || undefined);
    setProjection(res.projection);
    await loadDrift();
  };

  const rollbackProjection = async () => {
    if (!projection) return;
    const res = await api.rollbackV2CarrierProjection(projection.projectionId);
    setProjection(res.projection);
    await loadDrift();
  };

  const loadBench = async () => {
    const res = await api.postV2BenchRun({
      agentId: ctx.agentId || undefined,
      projectId: ctx.projectId || undefined,
    });
    setBench(res.report);
  };

  const loadFixtureBench = async () => {
    const res = await api.postV2BenchRun({
      agentId: ctx.agentId || undefined,
      projectId: ctx.projectId || undefined,
      useFixtures: true,
      limit: 50,
    });
    setBench(res.report);
  };

  const loadLatestBench = async () => {
    const res = await api.getV2BenchReport();
    setBench(res.report);
  };

  const seedBench = async (useFixtures = false) => {
    const res = await api.postV2BenchSeed(ctx.agentId || undefined, ctx.projectId || undefined, useFixtures);
    setSeed(res.result);
    await loadOps();
  };

  const conflictCards = (recall?.cards ?? []).filter((card) => card.conflict);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">V2 Inspector</h1>
          <p className="mt-1 text-sm text-muted">
            Source Trace、Carrier Drift、Injection Inspector、Quality Metrics
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            onClick={() => void run("ops", loadOps)}
            disabled={!!loading}
            className="px-4 py-2 border border-line rounded-lg text-sm text-ink hover:bg-line/40 disabled:opacity-50"
          >
            刷新状态
          </button>
          <button
            onClick={() => void run("bench-latest", loadLatestBench)}
            disabled={!!loading}
            className="px-4 py-2 border border-line rounded-lg text-sm text-ink hover:bg-line/40 disabled:opacity-50"
          >
            最新 Bench
          </button>
          <button
            onClick={() => void run("bench-seed", () => seedBench())}
            disabled={!!loading}
            className="px-4 py-2 border border-line rounded-lg text-sm text-ink hover:bg-line/40 disabled:opacity-50"
          >
            Seed Bench
          </button>
          <button
            onClick={() => void run("bench-seed-fixtures", () => seedBench(true))}
            disabled={!!loading}
            className="px-4 py-2 border border-line rounded-lg text-sm text-ink hover:bg-line/40 disabled:opacity-50"
          >
            Seed Fixtures
          </button>
          <button
            onClick={() => void run("bench-fixtures", loadFixtureBench)}
            disabled={!!loading}
            className="px-4 py-2 border border-line rounded-lg text-sm text-ink hover:bg-line/40 disabled:opacity-50"
          >
            Fixture Bench
          </button>
          <button
            onClick={() => void run("bench", loadBench)}
            disabled={!!loading}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
          >
            {loading === "bench" ? "运行中..." : "运行 Bench"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <div className="rounded-xl border border-line bg-panel p-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-ink">Consolidation Worker</div>
              <div className="text-xs text-muted">
                {worker?.running ? "running" : "stopped"} · {worker?.runCount ?? 0} runs · {worker?.errorCount ?? 0} errors
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void run("worker-start", startWorker)}
                disabled={!!loading}
                className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium disabled:opacity-50"
              >
                Start
              </button>
              <button
                onClick={() => void run("worker-stop", stopWorker)}
                disabled={!!loading}
                className="px-3 py-1.5 border border-line rounded-lg text-xs text-ink disabled:opacity-50"
              >
                Stop
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Metric label="Candidates" value={candidateStats?.total ?? 0} />
            <Metric label="Pending" value={candidateStats?.byStatus.pending ?? 0} />
            <Metric label="Needs Review" value={candidateStats?.byStatus.needs_review ?? 0} />
            <Metric label="Promoted" value={candidateStats?.byStatus.promoted ?? 0} />
            <Metric label="Fixtures" value={fixtures?.count ?? 0} />
          </div>
          {gray && (
            <div className="mt-3 rounded-lg border border-line bg-bg px-3 py-2 text-xs text-ink">
              <div className="flex items-center justify-between gap-2">
                <span>Mode: {gray.mode}</span>
                <span>Audit: {gray.recallAudit.count}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1 text-muted">
                <span>mode {gray.readiness.modeReady ? "ready" : "wait"}</span>
                <span>queue {gray.readiness.candidateQueueHealthy ? "ready" : "wait"}</span>
                <span>source {gray.readiness.sourceCoverageReady ? "ready" : "wait"}</span>
                <span>latency {gray.readiness.latencyReady ? "ready" : "wait"}</span>
              </div>
            </div>
          )}
          {seed && (
            <div className="mt-3 rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">
              Seeded {seed.createdCandidates} candidates, promoted {seed.promoted}, skipped {seed.skippedExisting}
            </div>
          )}
          {worker?.lastError && (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {worker.lastError}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-line bg-panel shadow-card overflow-hidden">
          <div className="border-b border-line px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-ink">Candidate Review</div>
              <div className="text-xs text-muted">pending queue and manual gates</div>
            </div>
            <button
              onClick={() => void run("ops", loadOps)}
              disabled={!!loading}
              className="px-3 py-1.5 border border-line rounded-lg text-xs text-ink disabled:opacity-50"
            >
              刷新
            </button>
          </div>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <tbody>
                {candidates.slice(0, 10).map((candidate) => (
                  <tr key={candidate.candidateId} className="border-b border-line/50 align-top">
                    <td className="px-4 py-3">
                      <div className="font-mono text-muted">{candidate.candidateId}</div>
                      <div className="mt-1 text-ink">{candidate.content}</div>
                      {candidate.reviewReason && (
                        <div className="mt-1 text-red-700">{candidate.reviewReason}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{candidate.type}</td>
                    <td className="px-4 py-3 text-muted">{candidate.status}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => void run("candidate-approve", () => reviewCandidate(candidate, "approve"))}
                        disabled={!!loading || candidate.status === "promoted"}
                        className="mr-2 px-2 py-1 border border-line rounded text-xs text-ink disabled:opacity-40"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => void run("candidate-reject", () => reviewCandidate(candidate, "reject"))}
                        disabled={!!loading || candidate.status === "promoted"}
                        className="px-2 py-1 border border-line rounded text-xs text-red-700 disabled:opacity-40"
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
                {candidates.length === 0 && (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-muted" colSpan={4}>
                      暂无候选记忆
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run("recall", loadRecall)}
            placeholder="输入 v2 召回问题..."
            className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={() => void run("recall", loadRecall)}
            disabled={loading === "recall" || !query.trim()}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
          >
            {loading === "recall" ? "规划中..." : "召回计划"}
          </button>
          <button
            onClick={() => void run("drift", loadDrift)}
            disabled={loading === "drift" || !ctx.agentId}
            className="px-4 py-2 border border-line rounded-lg text-sm text-ink hover:bg-line/40 disabled:opacity-50"
          >
            {loading === "drift" ? "审计中..." : "Drift"}
          </button>
        </div>

        {recall && (
          <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
            <div className="rounded-xl border border-line bg-panel shadow-card overflow-hidden">
              <div className="border-b border-line px-4 py-3">
                <div className="text-sm font-bold text-ink">
                  Injection Inspector
                </div>
                <div className="mt-1 text-xs text-muted">
                  {recall.plan.intent} | {recall.executionTimeMs}ms | {recall.plan.reason}
                </div>
              </div>
              <div className="divide-y divide-line/60">
                {recall.cards.map((card: MemoryCard) => (
                  <button
                    key={card.memoryId}
                    onClick={() => void run("trace", () => loadTrace(card.memoryId))}
                    className="block w-full px-4 py-3 text-left hover:bg-bg/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono text-muted">{card.memoryId}</span>
                      <span className="rounded bg-accent/10 px-2 py-0.5 text-xs text-accent">
                        {card.type} · {pct(card.confidence)}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-ink">{card.content}</div>
                    <div className="mt-2 text-xs text-muted">
                      Evidence: {card.evidence.join(", ") || "none"}
                    </div>
                    {card.conflict && (
                      <div className="mt-2 text-xs text-red-700">{card.conflict}</div>
                    )}
                  </button>
                ))}
                {recall.cards.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-muted">
                    没有生成 memory cards
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-line bg-panel p-4 shadow-card">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-ink">Conflict Center</div>
                  <div className="text-xs text-muted">Carrier drift and projection patches</div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => void run("projection-apply", applyProjection)}
                    disabled={!!loading || !ctx.agentId}
                    className="px-2 py-1 bg-accent text-white rounded text-xs disabled:opacity-50"
                  >
                    Apply
                  </button>
                  <button
                    onClick={() => void run("projection-rollback", rollbackProjection)}
                    disabled={!!loading || !projection || projection.status !== "applied"}
                    className="px-2 py-1 border border-line rounded text-xs text-ink disabled:opacity-50"
                  >
                    Rollback
                  </button>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {conflictCards.length === 0 && (!drift || drift.issues.length === 0) && (
                  <div className="text-sm text-muted">暂无冲突或漂移</div>
                )}
                {conflictCards.map((card) => (
                  <div key={card.memoryId} className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                    {card.memoryId}: {card.conflict}
                  </div>
                ))}
                {drift?.issues.slice(0, 6).map((issue) => (
                  <div key={`${issue.filename}-${issue.memoryId}`} className="rounded-lg bg-bg px-3 py-2 text-xs text-ink">
                    <span className="font-bold">{issue.severity}</span> · {issue.filename}: {issue.message}
                  </div>
                ))}
                {projection && (
                  <div className="rounded-lg bg-bg px-3 py-2 text-xs text-ink">
                    Projection {projection.projectionId} · {projection.status} · merged {projection.merged.length}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-panel shadow-card overflow-hidden">
          <div className="border-b border-line px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-ink">Source Trace</div>
              <div className="text-xs text-muted">memory id to sourceRefs to L0 events</div>
            </div>
            <button
              onClick={() => void run("trace", () => loadTrace())}
              disabled={loading === "trace" || !traceId.trim()}
              className="px-3 py-1.5 border border-line rounded-lg text-xs text-ink hover:bg-line/40 disabled:opacity-50"
            >
              查询
            </button>
          </div>
          <div className="p-4 space-y-3">
            <input
              value={traceId}
              onChange={(e) => setTraceId(e.target.value)}
              placeholder="memory id"
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {trace && (
              <pre className="max-h-80 overflow-auto rounded-lg bg-bg p-3 text-xs text-ink">
                {JSON.stringify(trace, null, 2)}
              </pre>
            )}
            <div className="rounded-lg border border-line">
              <div className="border-b border-line px-3 py-2 text-xs font-bold text-ink">
                Relation Trace
              </div>
              <div className="max-h-52 overflow-auto divide-y divide-line/50">
                {(trace?.relations ?? relations).slice(0, 12).map((relation) => (
                  <div key={relation.relationId} className="px-3 py-2 text-xs">
                    <div className="font-mono text-muted">{relation.relationId}</div>
                    <div className="mt-1 text-ink">
                      {relation.type}: {relation.sourceKind}:{relation.sourceId} {"->"} {relation.targetKind}:{relation.targetId}
                    </div>
                  </div>
                ))}
                {(trace?.relations ?? relations).length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-muted">暂无关系 trace</div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-panel shadow-card overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <div className="text-sm font-bold text-ink">Quality Metrics</div>
            <div className="text-xs text-muted">
              Memory Bench v0{bench ? ` · ${bench.generatedAt}` : ""}
            </div>
          </div>
          <div className="p-4">
            {bench ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <Metric label="Recall@5" value={pct(bench.recallAt5)} />
                  <Metric label="Precision" value={pct(bench.injectionPrecision)} />
                  <Metric label="Stale Rate" value={pct(bench.staleRate)} />
                  <Metric label="Source Coverage" value={pct(bench.sourceCoverage)} />
                  <Metric label="Avg Card Chars" value={Math.round(bench.avgCardChars)} />
                  <Metric label="P95 Latency" value={`${bench.p95LatencyMs}ms`} />
                </div>
                <div className="max-h-52 overflow-auto rounded-lg border border-line">
                  <table className="w-full text-xs">
                    <tbody>
                      {bench.results.slice(0, 12).map((row) => (
                        <tr key={row.id} className="border-b border-line/50">
                          <td className="px-3 py-2 text-ink">{row.id}</td>
                          <td className="px-3 py-2 text-right text-muted">{row.cardCount} cards</td>
                          <td className="px-3 py-2 text-right text-muted">{row.latencyMs}ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-muted">
                点击「运行 Bench」查看质量指标
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
