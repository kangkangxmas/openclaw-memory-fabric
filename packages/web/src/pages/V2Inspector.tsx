import { useEffect, useMemo, useState } from "react";
import type { AppContext } from "../App";
import type {
  MemoryCard,
  V2BenchFixtureSet,
  V2BenchReport,
  V2BenchSeedResult,
  V2CanaryStatus,
  V2CarrierDriftReport,
  V2CarrierProjectionRecord,
  V2Candidate,
  V2CandidateStats,
  V2ConsolidationStatus,
  V2GrayStatus,
  V2Mode,
  V2RecallAuditEntry,
  V2RecallPlanResponse,
  V2RolloutModeRow,
  V2RolloutModesResponse,
  V2TraceResponse,
} from "../types";
import { api } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";

const CANARY_AGENT_ID = "product";
const CANARY_PROJECT_ID = "Product";
const CANARY_EXPECTED_MODE = "v2-write";

interface V2InspectorProps {
  ctx: AppContext;
}

type CandidateFilter = V2Candidate["status"] | "all";
type CandidateRetryStatus = Extract<V2Candidate["status"], "needs_review" | "rejected">;
type CandidateSort = "updated_desc" | "confidence_asc" | "source_refs_asc";
type TraceRecord = Record<string, unknown>;
type RolloutScope = Pick<V2RolloutModeRow, "agentId" | "projectId">;

const candidateFilters: CandidateFilter[] = ["all", "pending", "needs_review", "rejected", "promoted"];
const candidateSorts: CandidateSort[] = ["updated_desc", "confidence_asc", "source_refs_asc"];
const rolloutModes: V2Mode[] = ["off", "shadow", "v2-recall", "v2-write"];
const rolloutScopeStorageKey = "memory-fabric:v2-rollout-scopes";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function clip(value: string | undefined, limit = 96): string {
  if (!value) return "";
  return value.length > limit ? `${value.slice(0, limit - 1)}...` : value;
}

function scopeForV2(scope: AppContext["scope"]): "private" | "project" | "shared" | undefined {
  return scope === "auto" ? undefined : scope;
}

function formatTime(value: string | undefined): string {
  if (!value) return "-";
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString();
}

function textField(record: TraceRecord | undefined, keys: string[]): string {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function isCandidateRetryStatus(status: CandidateFilter): status is CandidateRetryStatus {
  return status === "needs_review" || status === "rejected";
}

function jsonPreview(value: unknown, limit = 240): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return clip(value, limit);
  try {
    return clip(JSON.stringify(value), limit);
  } catch {
    return String(value);
  }
}

function rolloutKey(row: Pick<V2RolloutModeRow, "agentId" | "projectId">): string {
  return `${row.agentId}::${row.projectId ?? ""}`;
}

function normalizeRolloutScope(scope: RolloutScope): RolloutScope | null {
  const agentId = scope.agentId.trim();
  const projectId = scope.projectId?.trim();
  if (!agentId) return null;
  return { agentId, projectId: projectId || undefined };
}

function statusBadgeClass(status: "pass" | "warn" | "fail" | "ready" | string): string {
  if (status === "pass" || status === "ready") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  if (status === "warn") return "border-amber-400/30 bg-amber-400/10 text-amber-200";
  if (status === "fail" || status === "rejected") return "border-red-400/30 bg-red-400/10 text-red-200";
  if (status === "promoted") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  if (status === "needs_review") return "border-amber-400/30 bg-amber-400/10 text-amber-200";
  return "border-line bg-deep text-muted";
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-line bg-deep px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 break-words text-lg font-bold text-ink">{value}</div>
    </div>
  );
}

function CompactBadge({ children, status }: { children: React.ReactNode; status?: string }) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs ${statusBadgeClass(status ?? "default")}`}>
      {children}
    </span>
  );
}

export function V2Inspector({ ctx }: V2InspectorProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [recall, setRecall] = useState<V2RecallPlanResponse | null>(null);
  const [trace, setTrace] = useState<V2TraceResponse | null>(null);
  const [traceId, setTraceId] = useState("");
  const [drift, setDrift] = useState<V2CarrierDriftReport | null>(null);
  const [candidates, setCandidates] = useState<V2Candidate[]>([]);
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilter>("all");
  const [candidateSearch, setCandidateSearch] = useState("");
  const [candidateSort, setCandidateSort] = useState<CandidateSort>("updated_desc");
  const [candidateStats, setCandidateStats] = useState<V2CandidateStats | null>(null);
  const [worker, setWorker] = useState<V2ConsolidationStatus | null>(null);
  const [projection, setProjection] = useState<V2CarrierProjectionRecord | null>(null);
  const [bench, setBench] = useState<V2BenchReport | null>(null);
  const [fixtures, setFixtures] = useState<V2BenchFixtureSet | null>(null);
  const [seed, setSeed] = useState<V2BenchSeedResult | null>(null);
  const [gray, setGray] = useState<V2GrayStatus | null>(null);
  const [canary, setCanary] = useState<V2CanaryStatus | null>(null);
  const [recallAudit, setRecallAudit] = useState<V2RecallAuditEntry[]>([]);
  const [rollout, setRollout] = useState<V2RolloutModesResponse | null>(null);
  const [modeDrafts, setModeDrafts] = useState<Record<string, V2Mode>>({});
  const [manualScopes, setManualScopes] = useState<RolloutScope[]>([]);
  const [manualAgentId, setManualAgentId] = useState("");
  const [manualProjectId, setManualProjectId] = useState("");
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

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(rolloutScopeStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as RolloutScope[];
      const next = new Map<string, RolloutScope>();
      for (const item of parsed) {
        const scope = normalizeRolloutScope(item);
        if (scope) next.set(rolloutKey(scope), scope);
      }
      setManualScopes([...next.values()]);
    } catch {
      /* ignore malformed local state */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(rolloutScopeStorageKey, JSON.stringify(manualScopes));
    } catch {
      /* ignore unavailable storage */
    }
  }, [manualScopes]);

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
    const id = memoryId.trim();
    const res = await api.getV2MemoryTrace(id);
    setTrace(res);
    setTraceId(id);
  };

  const loadDrift = async () => {
    if (!ctx.agentId) return;
    const res = await api.getV2CarrierDrift(ctx.agentId, ctx.projectId || undefined);
    setDrift(res.report);
  };

  const loadRolloutScopes = async (): Promise<RolloutScope[]> => {
    const scopeMap = new Map<string, RolloutScope>();
    const add = (scope: RolloutScope) => {
      const normalized = normalizeRolloutScope(scope);
      if (normalized) scopeMap.set(rolloutKey(normalized), normalized);
    };

    for (const scope of manualScopes) add(scope);
    add({ agentId: CANARY_AGENT_ID, projectId: CANARY_PROJECT_ID });
    add({ agentId: ctx.agentId, projectId: ctx.projectId || undefined });

    const agents = ctx.agents.length > 0 ? ctx.agents : ctx.agentId ? [ctx.agentId] : [];
    await Promise.all(agents.map(async (agentId) => {
      try {
        const res = await api.getProjects(agentId);
        if (res.ok && res.projects.length > 0) {
          for (const projectId of res.projects) add({ agentId, projectId });
        } else {
          add({ agentId });
        }
      } catch {
        add({ agentId });
      }
    }));

    return [...scopeMap.values()].sort((a, b) => a.agentId.localeCompare(b.agentId) || (a.projectId ?? "").localeCompare(b.projectId ?? ""));
  };

  const loadOps = async () => {
    const agentId = ctx.agentId || undefined;
    const projectId = ctx.projectId || undefined;
    const rolloutScopes = await loadRolloutScopes();
    const [candidateRes, statusRes, grayRes, fixtureRes, auditRes, canaryRes, rolloutRes] = await Promise.all([
      api.getV2Candidates(agentId, projectId),
      api.getV2ConsolidationStatus(agentId, projectId),
      api.getV2GrayStatus(agentId, projectId),
      api.getV2BenchFixtures(),
      api.getV2RecallAudit(agentId, projectId, 12),
      api.getV2CanaryStatus({ agentId: CANARY_AGENT_ID, projectId: CANARY_PROJECT_ID, expectedMode: CANARY_EXPECTED_MODE }),
      api.getV2RolloutModes({ scopes: rolloutScopes, agentId, projectId }),
    ]);
    setCandidates(candidateRes.candidates);
    setCandidateStats(statusRes.candidateStats);
    setWorker(statusRes.status);
    setGray(grayRes);
    setFixtures(fixtureRes);
    setRecallAudit(auditRes.entries);
    setCanary(canaryRes);
    setRollout(rolloutRes);
    setModeDrafts((prev) => {
      const next = { ...prev };
      for (const row of rolloutRes.modes) {
        const key = rolloutKey(row);
        if (!next[key]) next[key] = row.mode;
      }
      return next;
    });
    if (grayRes.bench) setBench(grayRes.bench);
    if (canaryRes.bench) setBench(canaryRes.bench);
  };

  useEffect(() => {
    if (!ctx.agentId) return;
    void run("ops", loadOps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.agentId, ctx.projectId]);

  useEffect(() => {
    if (!ctx.agentId) return;
    void run("ops", loadOps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualScopes]);

  const reviewCandidate = async (candidate: V2Candidate, decision: "approve" | "reject") => {
    const messageKey = decision === "approve" ? "v2.confirm.approveCandidate" : "v2.confirm.rejectCandidate";
    if (!window.confirm(`${t(messageKey)}\n${candidate.candidateId}`)) return;
    await api.reviewV2Candidate(candidate.candidateId, decision, candidate.agentId);
    await loadOps();
  };

  const retryCandidates = async () => {
    const statuses: CandidateRetryStatus[] =
      candidateFilter === "all" ? ["needs_review", "rejected"] : isCandidateRetryStatus(candidateFilter) ? [candidateFilter] : [];
    if (statuses.length === 0) return;
    if (!window.confirm(t("v2.confirm.retryCandidates"))) return;
    await api.retryV2Candidates(ctx.agentId || undefined, ctx.projectId || undefined, statuses, 100);
    await loadOps();
  };

  const startWorker = async () => {
    const res = await api.startV2ConsolidationWorker(CANARY_AGENT_ID, CANARY_PROJECT_ID);
    setWorker(res.status);
    await loadOps();
  };

  const stopWorker = async () => {
    if (!window.confirm(t("v2.confirm.stopWorker"))) return;
    const res = await api.stopV2ConsolidationWorker();
    setWorker(res.status);
    await loadOps();
  };

  const startWorkerFor = async (row: V2RolloutModeRow) => {
    if (!window.confirm(`${t("v2.confirm.startWorkerFor")}\n${row.agentId} / ${row.projectId || "*"}`)) return;
    const res = await api.startV2ConsolidationWorker(row.agentId, row.projectId);
    setWorker(res.status);
    await loadOps();
  };

  const setRolloutDraft = (row: V2RolloutModeRow, mode: V2Mode) => {
    setModeDrafts((prev) => ({ ...prev, [rolloutKey(row)]: mode }));
  };

  const applyRolloutMode = async (row: V2RolloutModeRow) => {
    const mode = modeDrafts[rolloutKey(row)] ?? row.mode;
    if (mode === row.mode) return;
    if (!window.confirm(`${t("v2.confirm.setMode")}\n${row.agentId} / ${row.projectId || "*"}: ${row.mode} -> ${mode}`)) return;
    await api.setV2RolloutMode({
      agentId: row.agentId,
      projectId: row.projectId,
      mode,
      reason: "inspector rollout change",
    });
    await loadOps();
  };

  const rollbackRolloutMode = async (row: V2RolloutModeRow) => {
    if (!window.confirm(`${t("v2.confirm.rollbackMode")}\n${row.agentId} / ${row.projectId || "*"}`)) return;
    await api.rollbackV2RolloutMode({
      agentId: row.agentId,
      projectId: row.projectId,
      reason: "inspector rollback",
    });
    await loadOps();
  };

  const emergencyOff = async (row: V2RolloutModeRow) => {
    if (!window.confirm(`${t("v2.confirm.emergencyOff")}\n${row.agentId} / ${row.projectId || "*"}`)) return;
    await api.setV2RolloutMode({
      agentId: row.agentId,
      projectId: row.projectId,
      mode: "off",
      reason: "inspector emergency off",
    });
    await loadOps();
  };

  const addManualScope = async () => {
    const scope = normalizeRolloutScope({ agentId: manualAgentId, projectId: manualProjectId });
    if (!scope) return;
    setManualScopes((prev) => {
      const next = new Map(prev.map((item) => [rolloutKey(item), item]));
      next.set(rolloutKey(scope), scope);
      return [...next.values()].sort((a, b) => a.agentId.localeCompare(b.agentId) || (a.projectId ?? "").localeCompare(b.projectId ?? ""));
    });
    setManualAgentId("");
    setManualProjectId("");
  };

  const removeManualScope = async (scope: RolloutScope) => {
    setManualScopes((prev) => prev.filter((item) => rolloutKey(item) !== rolloutKey(scope)));
  };

  const applyProjection = async () => {
    if (!ctx.agentId) return;
    if (!window.confirm(t("v2.confirm.applyProjection"))) return;
    const res = await api.applyV2CarrierProjection(ctx.agentId, ctx.projectId || undefined);
    setProjection(res.projection);
    await loadDrift();
  };

  const rollbackProjection = async () => {
    if (!projection) return;
    if (!window.confirm(t("v2.confirm.rollbackProjection"))) return;
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
    if (!window.confirm(t(useFixtures ? "v2.confirm.seedFixtures" : "v2.confirm.seedBench"))) return;
    const res = await api.postV2BenchSeed(ctx.agentId || undefined, ctx.projectId || undefined, useFixtures);
    setSeed(res.result);
    await loadOps();
  };

  const conflictCards = (recall?.cards ?? []).filter((card) => card.conflict);
  const reviewReasonCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const candidate of candidates) {
      if (!candidate.reviewReason) continue;
      counts.set(candidate.reviewReason, (counts.get(candidate.reviewReason) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [candidates]);

  const sortedCandidates = useMemo(() => {
    const priority: Record<V2Candidate["status"], number> = {
      needs_review: 0,
      pending: 1,
      rejected: 2,
      promoted: 3,
    };
    const search = candidateSearch.trim().toLowerCase();
    return [...candidates]
      .filter((candidate) => candidateFilter === "all" || candidate.status === candidateFilter)
      .filter((candidate) => {
        if (!search) return true;
        return [
          candidate.candidateId,
          candidate.agentId,
          candidate.projectId ?? "",
          candidate.type,
          candidate.status,
          candidate.content,
          candidate.reviewReason ?? "",
          candidate.promotedMemoryId ?? "",
          ...candidate.tags,
          ...candidate.sourceRefs,
        ].join("\n").toLowerCase().includes(search);
      })
      .sort((a, b) => {
        const statusDelta = priority[a.status] - priority[b.status];
        if (statusDelta !== 0) return statusDelta;
        if (candidateSort === "confidence_asc") return a.confidence - b.confidence;
        if (candidateSort === "source_refs_asc") return a.sourceRefs.length - b.sourceRefs.length;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [candidateFilter, candidateSearch, candidateSort, candidates]);

  const traceEvents = trace?.events ?? [];
  const traceSources = trace?.sources ?? [];
  const traceRelations = trace?.relations ?? [];
  const failingChecks = canary?.checks.filter((check) => check.status !== "pass") ?? [];
  const traceEventIds = new Set(traceEvents.map((event) => textField(event, ["eventId", "event_id", "id"])).filter(Boolean));
  const missingTraceEventRefs = trace?.sourceRefs.filter((ref) => !traceEventIds.has(ref)) ?? [];
  const traceHealthIssues = trace
    ? [
        ...(trace.sourceRefs.length === 0
          ? [{ id: "sourceRefs", status: "fail", message: t("v2.trace.health.sourceRefsMissing") }]
          : []),
        ...(trace.sourceRefs.length > 0 && traceEvents.length === 0
          ? [{ id: "events", status: "fail", message: t("v2.trace.health.eventsMissing") }]
          : []),
        ...(missingTraceEventRefs.length > 0
          ? [{
              id: "eventRefs",
              status: "fail",
              message: `${t("v2.trace.health.eventsMissingRefs")}: ${missingTraceEventRefs.slice(0, 4).join(", ")}`,
            }]
          : []),
        ...(trace.sourceRefs.length > 0 && traceSources.length === 0
          ? [{ id: "sources", status: "warn", message: t("v2.trace.health.sourcesMissing") }]
          : []),
        ...(traceRelations.length === 0
          ? [{ id: "relations", status: "warn", message: t("v2.trace.health.relationsMissing") }]
          : []),
      ]
    : [];
  const selectedContext = `${ctx.agentId || "-"} / ${ctx.projectId || "-"}`;
  const canaryContext = `${CANARY_AGENT_ID} / ${CANARY_PROJECT_ID}`;
  const workerContext = `${worker?.agentId ?? "-"} / ${worker?.projectId ?? "-"}`;
  const selectedDiffersFromCanary = !!ctx.agentId && (ctx.agentId !== CANARY_AGENT_ID || (ctx.projectId || "") !== CANARY_PROJECT_ID);
  const rolloutRows = rollout?.modes ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("v2.title")}
        description={t("v2.desc")}
        eyebrow="Memory Fabric v2"
        actions={
        <>
          <button
            onClick={() => void run("ops", loadOps)}
            disabled={!!loading}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
          >
            {loading === "ops" ? t("common.loading") : t("v2.refresh")}
          </button>
          <button
            onClick={() => void run("bench-latest", loadLatestBench)}
            disabled={!!loading}
            className="px-4 py-2 border border-line rounded-lg text-sm text-ink hover:bg-line/40 disabled:opacity-50"
          >
            {t("v2.latestBench")}
          </button>
        </>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-line bg-panel/85 p-4 shadow-card">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-sm font-bold text-ink">{t("v2.context.title")}</div>
            <div className="mt-1 text-xs text-muted">{t("v2.context.desc")}</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[760px] xl:grid-cols-4">
            <Metric label={t("v2.context.selected")} value={selectedContext} />
            <Metric label={t("v2.context.canary")} value={canaryContext} />
            <Metric label={t("v2.context.mode")} value={canary?.mode ?? gray?.mode ?? "-"} />
            <Metric label={t("v2.context.worker")} value={workerContext} />
          </div>
        </div>
        {selectedDiffersFromCanary && (
          <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            {t("v2.context.mismatch")}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-line bg-panel/85 shadow-card overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold text-ink">{t("v2.rollout.title")}</h2>
                {rollout && <CompactBadge>{t("v2.rollout.default")}: {rollout.defaultMode}</CompactBadge>}
              </div>
              <div className="mt-1 text-xs text-muted">{t("v2.rollout.desc")}</div>
            </div>
            <button
              onClick={() => void run("ops", loadOps)}
              disabled={!!loading}
              className="w-fit px-3 py-1.5 border border-line rounded-lg text-xs text-ink disabled:opacity-50"
            >
              {t("common.refresh")}
            </button>
          </div>
        </div>
        <div className="border-b border-line px-4 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="text-xs font-bold text-ink">{t("v2.rollout.addScope")}</div>
              <div className="mt-1 text-xs text-muted">{t("v2.rollout.addScopeDesc")}</div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={manualAgentId}
                onChange={(event) => setManualAgentId(event.target.value)}
                placeholder={t("v2.rollout.agentPlaceholder")}
                className="rounded-lg border border-line bg-deep px-3 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <input
                value={manualProjectId}
                onChange={(event) => setManualProjectId(event.target.value)}
                placeholder={t("v2.rollout.projectPlaceholder")}
                className="rounded-lg border border-line bg-deep px-3 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                onClick={() => void run("rollout-add-scope", addManualScope)}
                disabled={!!loading || !manualAgentId.trim()}
                className="px-3 py-2 border border-line rounded-lg text-xs text-ink disabled:opacity-50"
              >
                {t("v2.rollout.add")}
              </button>
            </div>
          </div>
          {manualScopes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {manualScopes.map((scope) => (
                <button
                  key={rolloutKey(scope)}
                  onClick={() => void run(`rollout-remove-${rolloutKey(scope)}`, () => removeManualScope(scope))}
                  className="rounded border border-line bg-deep px-2 py-1 text-xs text-muted hover:border-red-400/40 hover:text-red-200"
                  title={t("v2.rollout.removeManual")}
                >
                  {scope.agentId} / {scope.projectId || t("v2.rollout.allProjects")} ×
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-xs">
            <thead className="bg-panel text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 text-left font-medium">{t("v2.rollout.scope")}</th>
                <th className="px-4 py-2 text-left font-medium">{t("v2.rollout.mode")}</th>
                <th className="px-4 py-2 text-left font-medium">{t("v2.rollout.source")}</th>
                <th className="px-4 py-2 text-left font-medium">{t("v2.rollout.health")}</th>
                <th className="px-4 py-2 text-left font-medium">{t("v2.rollout.updated")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("v2.rollout.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rolloutRows.map((row) => {
                const key = rolloutKey(row);
                const draft = modeDrafts[key] ?? row.mode;
                const changed = draft !== row.mode;
                return (
                  <tr key={key} className="border-b border-line/50 align-top">
                    <td className="px-4 py-3">
                      <div className="font-mono text-ink">{row.agentId}</div>
                      <div className="mt-1 font-mono text-muted">{row.projectId || t("v2.rollout.allProjects")}</div>
                      {row.workerActive && (
                        <div className="mt-2">
                          <CompactBadge status="pass">{t("v2.rollout.workerActive")}</CompactBadge>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <CompactBadge status={row.mode}>{row.mode}</CompactBadge>
                        <span className="text-muted">{t("v2.rollout.base")}: {row.baseMode}</span>
                      </div>
                      <select
                        value={draft}
                        onChange={(event) => setRolloutDraft(row, event.target.value as V2Mode)}
                        className="mt-2 rounded-lg border border-line bg-deep px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                      >
                        {rolloutModes.map((mode) => (
                          <option key={mode} value={mode}>{mode}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <CompactBadge status={row.source === "runtime_override" ? "warn" : "default"}>{row.source}</CompactBadge>
                      </div>
                      <div className="mt-2 text-muted">{row.baseSource}</div>
                      {row.reason && <div className="mt-1 max-w-[180px] text-muted">{clip(row.reason, 80)}</div>}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      <div className="flex flex-wrap items-center gap-2">
                        <CompactBadge status={row.health?.status ?? "default"}>{row.health?.status ?? "-"}</CompactBadge>
                        <span>{row.candidateStats.byStatus.pending} pending · {row.candidateStats.byStatus.needs_review} review</span>
                      </div>
                      <div className="mt-1">{row.recallAudit.count} audits · source {pct(row.health?.candidateSourceCoverage ?? 1)}</div>
                      {row.health && row.health.sourceLessCandidates > 0 && (
                        <div className="mt-1 text-red-200">{row.health.sourceLessCandidates} missing sourceRefs</div>
                      )}
                      {row.recallAudit.lastAt && <div className="mt-1">{formatTime(row.recallAudit.lastAt)}</div>}
                      {row.health && row.health.warnings.length > 0 && (
                        <div className="mt-2 flex max-w-[260px] flex-wrap gap-1">
                          {row.health.warnings.slice(0, 3).map((warning) => (
                            <CompactBadge key={warning} status="warn">{warning}</CompactBadge>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      <div>{formatTime(row.updatedAt)}</div>
                      <div className="mt-1">{row.updatedBy || "-"}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => void run(`rollout-set-${key}`, () => applyRolloutMode(row))}
                        disabled={!!loading || !changed}
                        className="mr-2 px-2 py-1 bg-accent text-white rounded text-xs disabled:opacity-40"
                      >
                        {t("v2.rollout.apply")}
                      </button>
                      <button
                        onClick={() => void run(`rollout-rollback-${key}`, () => rollbackRolloutMode(row))}
                        disabled={!!loading || !row.canRollback}
                        className="mr-2 px-2 py-1 border border-line rounded text-xs text-ink disabled:opacity-40"
                      >
                        {t("v2.rollout.rollback")}
                      </button>
                      <button
                        onClick={() => void run(`rollout-worker-${key}`, () => startWorkerFor(row))}
                        disabled={!!loading}
                        className="mr-2 px-2 py-1 border border-line rounded text-xs text-ink disabled:opacity-40"
                      >
                        {t("v2.rollout.worker")}
                      </button>
                      <button
                        onClick={() => void run(`rollout-off-${key}`, () => emergencyOff(row))}
                        disabled={!!loading || row.mode === "off"}
                        className="px-2 py-1 border border-red-400/40 rounded text-xs text-red-200 disabled:opacity-40"
                      >
                        {t("v2.rollout.emergencyOff")}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rolloutRows.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-center text-sm text-muted" colSpan={6}>
                    {t("common.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel/85 p-4 shadow-card">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-ink">{t("v2.canary")}</h2>
              {canary && <CompactBadge status={canary.status}>{canary.status}</CompactBadge>}
              {canary && <CompactBadge status={canary.mode}>{canary.mode}</CompactBadge>}
            </div>
            <div className="mt-1 text-xs text-muted">
              {canary
                ? `${canary.agentId}${canary.projectId ? ` / ${canary.projectId}` : ""} · source coverage ${pct(canary.candidateSourceCoverage)} · recall audits ${canary.recallAudit.count}`
                : t("v2.canary.empty")}
            </div>
          </div>
          <div className="grid min-w-full grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[560px]">
            <Metric label="Mode" value={canary?.mode ?? gray?.mode ?? "-"} />
            <Metric label="Queue" value={`${canary?.candidateStats.byStatus.pending ?? 0}/${canary?.candidateStats.byStatus.needs_review ?? 0}`} />
            <Metric label="Source Refs" value={canary ? pct(canary.candidateSourceCoverage) : "-"} />
            <Metric label="P95" value={bench ? `${bench.p95LatencyMs}ms` : "-"} />
          </div>
        </div>
        {canary && (
          <div className="mt-4 grid gap-2 lg:grid-cols-4">
            {canary.checks.map((check) => (
              <div key={check.id} className={`rounded-lg border px-3 py-2 ${statusBadgeClass(check.status)}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{check.id}</span>
                  <span className="text-xs font-bold">{check.status}</span>
                </div>
                <div className="mt-1 text-xs">{check.message}</div>
                {check.value !== undefined && (
                  <div className="mt-1 font-mono text-[11px] opacity-80">{jsonPreview(check.value, 120)}</div>
                )}
              </div>
            ))}
          </div>
        )}
        {failingChecks.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            {t("v2.attention")}: {failingChecks.map((check) => `${check.id}=${check.status}`).join(", ")}
          </div>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <div className="rounded-lg border border-line bg-panel/85 p-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-ink">{t("v2.worker")}</div>
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
                {t("v2.worker.startCanary")}
              </button>
              <button
                onClick={() => void run("worker-stop", stopWorker)}
                disabled={!!loading}
                className="px-3 py-1.5 border border-line rounded-lg text-xs text-ink disabled:opacity-50"
              >
                {t("v2.worker.stopCanary")}
              </button>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-line bg-deep px-3 py-2 text-xs">
            <span className="text-muted">{t("v2.worker.scope")}: </span>
            <span className="font-mono text-ink">
              {worker?.agentId ?? "-"} / {worker?.projectId ?? "-"}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Metric label="Candidates" value={candidateStats?.total ?? 0} />
            <Metric label="Pending" value={candidateStats?.byStatus.pending ?? 0} />
            <Metric label="Needs Review" value={candidateStats?.byStatus.needs_review ?? 0} />
            <Metric label="Promoted" value={candidateStats?.byStatus.promoted ?? 0} />
            <Metric label="Fixtures" value={fixtures?.count ?? 0} />
            <Metric label="Last Run" value={formatTime(worker?.lastRunAt)} />
          </div>
          {gray && (
            <div className="mt-3 rounded-lg border border-line bg-deep px-3 py-2 text-xs text-ink">
              <div className="flex items-center justify-between gap-2">
                <span>Gray mode: {gray.mode}</span>
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
          {worker?.lastError && (
            <div className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
              {worker.lastError}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-line bg-panel/85 shadow-card overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-sm font-bold text-ink">{t("v2.candidates")}</div>
                <div className="text-xs text-muted">
                  {sortedCandidates.length} shown · pending queue and manual gates
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {candidateFilters.map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setCandidateFilter(filter)}
                    className={`rounded-lg border px-3 py-1.5 text-xs ${
                      candidateFilter === filter
                        ? "border-accent bg-accent text-white"
                        : "border-line text-ink hover:bg-line/40"
                    }`}
                  >
                    {filter === "all" ? "all" : filter}
                  </button>
                ))}
                <button
                  onClick={() => void run("ops", loadOps)}
                  disabled={!!loading}
                  className="px-3 py-1.5 border border-line rounded-lg text-xs text-ink disabled:opacity-50"
                >
                  {t("v2.candidate.refresh")}
                </button>
              </div>
            </div>
          </div>
          <div className="border-b border-line px-4 py-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <input
                type="search"
                value={candidateSearch}
                onChange={(event) => setCandidateSearch(event.target.value)}
                placeholder={t("v2.candidate.search")}
                className="min-w-0 flex-1 rounded-lg border border-line bg-deep px-3 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <select
                value={candidateSort}
                onChange={(event) => setCandidateSort(event.target.value as CandidateSort)}
                className="rounded-lg border border-line bg-deep px-3 py-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {candidateSorts.map((sort) => (
                  <option key={sort} value={sort}>
                    {t(`v2.candidate.sort.${sort}`)}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void run("candidate-retry", retryCandidates)}
                disabled={!!loading || candidateFilter === "pending" || candidateFilter === "promoted"}
                className="px-3 py-2 border border-amber-400/40 rounded-lg text-xs text-amber-200 disabled:opacity-50"
              >
                {t("v2.candidate.retry")}
              </button>
            </div>
            {reviewReasonCounts.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {reviewReasonCounts.map(([reason, count]) => (
                  <span key={reason} className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-xs text-amber-200">
                    {reason}: {count}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-panel text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 text-left font-medium">Candidate</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Evidence</th>
                  <th className="px-4 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedCandidates.slice(0, 20).map((candidate) => (
                  <tr key={candidate.candidateId} className="border-b border-line/50 align-top">
                    <td className="px-4 py-3">
                      <div className="font-mono text-muted">{candidate.candidateId}</div>
                      <div className="mt-1 text-ink">{candidate.content}</div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <CompactBadge>{candidate.type}</CompactBadge>
                        <CompactBadge>{pct(candidate.confidence)}</CompactBadge>
                        {candidate.tags.slice(0, 3).map((tag) => (
                          <CompactBadge key={tag}>{tag}</CompactBadge>
                        ))}
                      </div>
                      {candidate.reviewReason && (
                        <div className="mt-2 rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-amber-200">{candidate.reviewReason}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      <CompactBadge status={candidate.status}>{candidate.status}</CompactBadge>
                      <div className="mt-2">{formatTime(candidate.updatedAt)}</div>
                      {candidate.promotedMemoryId && (
                        <button
                          onClick={() => void run("trace", () => loadTrace(candidate.promotedMemoryId))}
                          className="mt-2 font-mono text-accent hover:underline"
                        >
                          {candidate.promotedMemoryId}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      <div>{candidate.sourceRefs.length} sourceRefs</div>
                      <div className="mt-1 max-w-[220px] font-mono">
                        {candidate.sourceRefs.slice(0, 2).join(", ") || "none"}
                      </div>
                    </td>
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
                        disabled={!!loading || candidate.status === "promoted" || candidate.status === "rejected"}
                        className="px-2 py-1 border border-line rounded text-xs text-red-200 disabled:opacity-40"
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
                {sortedCandidates.length === 0 && (
                  <tr>
                    <td className="px-4 py-8 text-center text-sm text-muted" colSpan={4}>
                      {t("common.empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel/85 shadow-card overflow-hidden">
        <div className="border-b border-line px-4 py-3 flex items-center justify-between gap-3">
          <div>
              <div className="text-sm font-bold text-ink">{t("v2.recallAudit")}</div>
            <div className="text-xs text-muted">legacy / v2 comparison for gray rollout</div>
          </div>
          <button
            onClick={() => void run("ops", loadOps)}
            disabled={!!loading}
            className="px-3 py-1.5 border border-line rounded-lg text-xs text-ink disabled:opacity-50"
          >
            {t("common.refresh")}
          </button>
        </div>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-panel text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 text-left font-medium">Time</th>
                <th className="px-4 py-2 text-left font-medium">Query</th>
                <th className="px-4 py-2 text-left font-medium">V2</th>
                <th className="px-4 py-2 text-left font-medium">Legacy</th>
                <th className="px-4 py-2 text-left font-medium">Preview</th>
              </tr>
            </thead>
            <tbody>
              {recallAudit.map((entry) => (
                <tr key={entry.auditId} className="border-b border-line/50 align-top">
                  <td className="px-4 py-3 text-muted whitespace-nowrap">
                    {formatTime(entry.createdAt)}
                    <div className="mt-1 font-mono">{entry.mode}</div>
                  </td>
                  <td className="px-4 py-3 text-ink">{clip(entry.query, 120)}</td>
                  <td className="px-4 py-3 text-muted">
                    <div>{entry.v2?.intent ?? "unknown"}</div>
                    <div>{entry.v2?.cardCount ?? 0} cards · {entry.v2?.evidenceCount ?? 0} evidence</div>
                    <div className="mt-1 flex max-w-[260px] flex-wrap gap-1">
                      {entry.v2?.memoryIds?.slice(0, 2).map((memoryId) => (
                        <button
                          key={memoryId}
                          onClick={() => void run("trace", () => loadTrace(memoryId))}
                          className="font-mono text-accent hover:underline"
                        >
                          {memoryId}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    <div>{entry.legacy?.sourceCount ?? 0} sources</div>
                    <div>{entry.legacy?.budgetUsed ?? 0} budget</div>
                    <div className="mt-1 font-mono">{entry.legacy?.sources?.slice(0, 2).join(", ")}</div>
                  </td>
                  <td className="px-4 py-3 text-muted">
                    <div className="text-ink">{clip(entry.v2?.cardPreviews?.[0], 140)}</div>
                    {entry.legacy?.memoryBriefPreview && (
                      <div className="mt-1">{clip(entry.legacy.memoryBriefPreview, 120)}</div>
                    )}
                  </td>
                </tr>
              ))}
              {recallAudit.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-center text-sm text-muted" colSpan={5}>
                    {t("common.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void run("recall", loadRecall)}
            placeholder={t("v2.query.placeholder")}
            className="flex-1 rounded-lg border border-line bg-deep px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={() => void run("recall", loadRecall)}
            disabled={loading === "recall" || !query.trim()}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
          >
            {loading === "recall" ? t("common.loading") : t("v2.injection")}
          </button>
          <button
            onClick={() => void run("drift", loadDrift)}
            disabled={loading === "drift" || !ctx.agentId}
            className="px-4 py-2 border border-line rounded-lg text-sm text-ink hover:bg-line/40 disabled:opacity-50"
          >
            {loading === "drift" ? t("v2.drift.loading") : "Drift"}
          </button>
        </div>

        {recall && (
          <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
            <div className="rounded-lg border border-line bg-panel/85 shadow-card overflow-hidden">
              <div className="border-b border-line px-4 py-3">
                <div className="text-sm font-bold text-ink">{t("v2.injection")}</div>
                <div className="mt-1 text-xs text-muted">
                  {recall.plan.intent} | {recall.executionTimeMs}ms | {recall.plan.reason}
                </div>
              </div>
              <div className="divide-y divide-line/60">
                {recall.cards.map((card: MemoryCard) => (
                  <button
                    key={card.memoryId}
                    onClick={() => void run("trace", () => loadTrace(card.memoryId))}
                    className="block w-full px-4 py-3 text-left hover:bg-white/5"
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
                      <div className="mt-2 text-xs text-red-200">{card.conflict}</div>
                    )}
                  </button>
                ))}
                {recall.cards.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-muted">
                    {t("v2.cards.empty")}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-line bg-panel/85 p-4 shadow-card">
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
                  <div className="text-sm text-muted">{t("v2.conflicts.empty")}</div>
                )}
                {conflictCards.map((card) => (
                  <div key={card.memoryId} className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
                    {card.memoryId}: {card.conflict}
                  </div>
                ))}
                {drift?.issues.slice(0, 6).map((issue) => (
                  <div key={`${issue.filename}-${issue.memoryId}`} className="rounded-lg bg-deep px-3 py-2 text-xs text-ink">
                    <span className="font-bold">{issue.severity}</span> · {issue.filename}: {issue.message}
                  </div>
                ))}
                {projection && (
                  <div className="rounded-lg bg-deep px-3 py-2 text-xs text-ink">
                    Projection {projection.projectionId} · {projection.status} · merged {projection.merged.length}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-line bg-panel/85 shadow-card overflow-hidden">
          <div className="border-b border-line px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-ink">{t("v2.trace")}</div>
              <div className="text-xs text-muted">memory id to sourceRefs to L0 events</div>
            </div>
            <button
              onClick={() => void run("trace", () => loadTrace())}
              disabled={loading === "trace" || !traceId.trim()}
              className="px-3 py-1.5 border border-line rounded-lg text-xs text-ink hover:bg-line/40 disabled:opacity-50"
            >
              {t("common.search")}
            </button>
          </div>
          <div className="p-4 space-y-4">
            <input
              value={traceId}
              onChange={(e) => setTraceId(e.target.value)}
              placeholder="memory id"
              className="w-full rounded-lg border border-line bg-deep px-3 py-2 text-sm font-mono text-ink focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {trace ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-line bg-deep px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-mono text-xs text-muted">{trace.memoryId}</div>
                    <CompactBadge status={trace.status}>{trace.status}</CompactBadge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {trace.sourceRefs.map((ref) => (
                      <CompactBadge key={ref}>{ref}</CompactBadge>
                    ))}
                    {trace.sourceRefs.length === 0 && <span className="text-xs text-red-200">missing sourceRefs</span>}
                  </div>
                </div>

                {traceHealthIssues.length > 0 && (
                  <div className="grid gap-2 lg:grid-cols-2">
                    {traceHealthIssues.map((issue) => (
                      <div key={issue.id} className={`rounded-lg border px-3 py-2 text-xs ${statusBadgeClass(issue.status)}`}>
                        <div className="font-mono text-[11px] uppercase">{issue.id}</div>
                        <div className="mt-1">{issue.message}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-lg border border-line overflow-hidden">
                  <div className="border-b border-line px-3 py-2 text-xs font-bold text-ink">
                    L0 Events
                  </div>
                  <div className="max-h-72 overflow-auto divide-y divide-line/50">
                    {traceEvents.map((event, index) => (
                      <div key={textField(event, ["eventId", "event_id", "id"]) || index} className="px-3 py-3 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-muted">{textField(event, ["eventId", "event_id", "id"]) || `event-${index + 1}`}</span>
                          <CompactBadge>{textField(event, ["sourceType", "source_type"]) || "event"}</CompactBadge>
                          <span className="text-muted">{formatTime(textField(event, ["occurredAt", "occurred_at"]))}</span>
                        </div>
                        <div className="mt-2 text-ink">{textField(event, ["summary", "content"]) || jsonPreview(event, 160)}</div>
                        <div className="mt-2 grid gap-1 text-muted sm:grid-cols-2">
                          <span className="font-mono">hash {clip(textField(event, ["contentHash", "content_hash"]), 48)}</span>
                          <span className="font-mono">uri {textField(event, ["sourceUri", "source_uri"]) || "-"}</span>
                        </div>
                        {event.payload !== undefined && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-accent">payload</summary>
                            <pre className="mt-2 max-h-44 overflow-auto rounded bg-panel p-2 text-[11px] text-ink">
                              {JSON.stringify(event.payload, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    ))}
                    {traceEvents.length === 0 && (
                      <div className={`px-3 py-6 text-center text-sm ${trace.sourceRefs.length > 0 ? "bg-red-400/10 text-red-200" : "text-muted"}`}>
                        {t("v2.events.empty")}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-line overflow-hidden">
                    <div className="border-b border-line px-3 py-2 text-xs font-bold text-ink">
                      Sources
                    </div>
                    <div className="max-h-52 overflow-auto divide-y divide-line/50">
                      {traceSources.map((source, index) => (
                        <div key={index} className="px-3 py-2 text-xs">
                          <div className="text-ink">{textField(source, ["uri", "sourceUri", "id", "type"]) || `source-${index + 1}`}</div>
                          <div className="mt-1 font-mono text-muted">{jsonPreview(source, 180)}</div>
                        </div>
                      ))}
                      {traceSources.length === 0 && (
                        <div className={`px-3 py-6 text-center text-sm ${trace.sourceRefs.length > 0 ? "bg-amber-400/10 text-amber-200" : "text-muted"}`}>
                          {t("v2.sources.empty")}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg border border-line overflow-hidden">
                    <div className="border-b border-line px-3 py-2 text-xs font-bold text-ink">
                      Relation Trace
                    </div>
                    <div className="max-h-52 overflow-auto divide-y divide-line/50">
                      {traceRelations.slice(0, 12).map((relation) => (
                        <div key={relation.relationId} className="px-3 py-2 text-xs">
                          <div className="font-mono text-muted">{relation.relationId}</div>
                          <div className="mt-1 text-ink">
                            {relation.type}: {relation.sourceKind}:{relation.sourceId} {"->"} {relation.targetKind}:{relation.targetId}
                          </div>
                        </div>
                      ))}
                      {traceRelations.length === 0 && (
                        <div className="px-3 py-6 text-center text-sm bg-amber-400/10 text-amber-200">{t("v2.relations.empty")}</div>
                      )}
                    </div>
                  </div>
                </div>

                <details>
                  <summary className="cursor-pointer text-xs text-muted">Raw trace JSON</summary>
                  <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-deep p-3 text-xs text-ink">
                    {JSON.stringify(trace, null, 2)}
                  </pre>
                </details>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-line px-3 py-8 text-center text-sm text-muted">
                {t("v2.trace.empty")}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-line bg-panel/85 shadow-card overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <div className="text-sm font-bold text-ink">{t("v2.quality")}</div>
            <div className="text-xs text-muted">
              Memory Bench v0{bench ? ` · ${bench.generatedAt}` : ""}
            </div>
          </div>
          <div className="p-4 space-y-4">
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
              <div className="py-8 text-center text-sm text-muted">
                {t("v2.bench.empty")}
              </div>
            )}

            <div className="rounded-lg border border-line bg-deep p-3">
              <div className="text-xs font-bold text-ink">{t("v2.benchTools")}</div>
              <div className="mt-1 text-xs text-muted">
                {t("v2.seed.warning")}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => void run("bench-latest", loadLatestBench)}
                  disabled={!!loading}
                  className="px-3 py-1.5 border border-line rounded-lg text-xs text-ink disabled:opacity-50"
                >
                  Latest
                </button>
                <button
                  onClick={() => void run("bench", loadBench)}
                  disabled={!!loading}
                  className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs disabled:opacity-50"
                >
                  Run Bench
                </button>
                <button
                  onClick={() => void run("bench-fixtures", loadFixtureBench)}
                  disabled={!!loading}
                  className="px-3 py-1.5 border border-line rounded-lg text-xs text-ink disabled:opacity-50"
                >
                  Fixture Bench
                </button>
                <button
                  onClick={() => void run("bench-seed", () => seedBench())}
                  disabled={!!loading}
                  className="px-3 py-1.5 border border-amber-400/40 rounded-lg text-xs text-amber-200 disabled:opacity-50"
                >
                  Seed Bench
                </button>
                <button
                  onClick={() => void run("bench-seed-fixtures", () => seedBench(true))}
                  disabled={!!loading}
                  className="px-3 py-1.5 border border-amber-400/40 rounded-lg text-xs text-amber-200 disabled:opacity-50"
                >
                  Seed Fixtures
                </button>
              </div>
              {seed && (
                <div className="mt-3 rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">
                  Seeded {seed.createdCandidates} candidates, promoted {seed.promoted}, skipped {seed.skippedExisting}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
