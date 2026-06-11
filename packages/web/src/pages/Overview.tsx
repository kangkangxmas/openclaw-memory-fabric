import { useState } from "react";
import type { AppContext } from "../App";
import type { RecallResponse, MemoryResponse, GraphResponse } from "../types";
import { api } from "../api/client";
import { MetricsRow } from "../components/MetricsRow";
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";

interface OverviewProps {
  ctx: AppContext;
}

interface Snapshot {
  recall: RecallResponse | null;
  memories: MemoryResponse | null;
  graph: GraphResponse | null;
}

export function Overview({ ctx }: OverviewProps) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<Snapshot>({
    recall: null,
    memories: null,
    graph: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = async () => {
    if (!ctx.agentId) return;
    setLoading(true);
    setError(null);
    try {
      const [recall, memories, graph] = await Promise.all([
        api
          .postRecall({
            agentId: ctx.agentId,
            projectId: ctx.projectId,
            scope: ctx.scope,
            depth: ctx.depth,
          })
          .catch(() => null),
        api
          .postInspectMemories({
            agentId: ctx.agentId,
            projectId: ctx.projectId,
            scope: ctx.scope,
            limit: 100,
          })
          .catch(() => null),
        api
          .postInspectGraph(ctx.projectId)
          .catch(() => null),
      ]);
      setSnapshot({ recall, memories, graph });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const metrics = [
    {
      label: t("overview.metric.memories"),
      value: snapshot.memories?.totalEntries ?? "--",
    },
    {
      label: t("overview.metric.scopes"),
      value: snapshot.memories?.scopesRead?.length ?? "--",
    },
    {
      label: t("overview.metric.nodes"),
      value: snapshot.graph?.nodeCount ?? "--",
    },
    {
      label: t("overview.metric.edges"),
      value: snapshot.graph?.edgeCount ?? "--",
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("overview.title")}
        description={t("overview.desc")}
        eyebrow="Memory Fabric"
        actions={
        <button
          onClick={loadAll}
          disabled={loading || !ctx.agentId}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent/90 disabled:opacity-50"
        >
          {loading ? t("overview.loading") : t("overview.load")}
        </button>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <MetricsRow metrics={metrics} />

      <div className="rounded-lg border border-line bg-panel/85 p-4 shadow-card">
        <div className="text-sm font-semibold text-ink">{t("overview.pipeline.title")}</div>
        <div className="mt-1 text-sm text-muted">{t("overview.pipeline.desc")}</div>
        <div className="mt-4 grid grid-cols-5 gap-2 text-xs">
          {[
            "map.step.events",
            "map.step.candidates",
            "map.step.cards",
            "map.step.carriers",
            "map.step.bench",
          ].map((key, index) => (
            <div key={key} className="rounded-lg border border-line bg-deep px-3 py-3">
              <div className="text-[11px] text-accent-2">0{index + 1}</div>
              <div className="mt-1 font-medium text-ink">{t(key)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Memory Brief */}
      <div className="rounded-lg border border-line bg-panel/85 shadow-card">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{t("overview.brief")}</h2>
        </div>
        <div className="p-4">
          <pre className="text-sm text-ink whitespace-pre-wrap">
            {snapshot.recall?.memoryBrief ??
              t("overview.empty")}
          </pre>
        </div>
      </div>

      {/* Graph Report */}
      {snapshot.graph?.report && (
        <div className="rounded-lg border border-line bg-panel/85 shadow-card">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">{t("overview.graph")}</h2>
          </div>
          <div className="p-4">
            <pre className="text-sm text-ink whitespace-pre-wrap">
              {snapshot.graph.report}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
