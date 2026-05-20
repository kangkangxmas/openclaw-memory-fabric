import { useState } from "react";
import type { AppContext } from "../App";
import type { RecallResponse, MemoryResponse, GraphResponse } from "../types";
import { api } from "../api/client";
import { MetricsRow } from "../components/MetricsRow";

interface OverviewProps {
  ctx: AppContext;
}

interface Snapshot {
  recall: RecallResponse | null;
  memories: MemoryResponse | null;
  graph: GraphResponse | null;
}

export function Overview({ ctx }: OverviewProps) {
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
      label: "记忆数",
      value: snapshot.memories?.totalEntries ?? "--",
    },
    {
      label: "读取范围",
      value: snapshot.memories?.scopesRead?.length ?? "--",
    },
    {
      label: "图谱节点",
      value: snapshot.graph?.nodeCount ?? "--",
    },
    {
      label: "图谱边",
      value: snapshot.graph?.edgeCount ?? "--",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">总览</h1>
        <button
          onClick={loadAll}
          disabled={loading || !ctx.agentId}
          className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
        >
          {loading ? "加载中..." : "加载完整快照"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 text-sm rounded-lg p-3 border border-red-200">
          {error}
        </div>
      )}

      <MetricsRow metrics={metrics} />

      {/* Memory Brief */}
      <div className="bg-panel rounded-xl border border-line shadow-card">
        <div className="px-4 py-3 border-b border-line">
          <h2 className="text-sm font-bold text-ink">记忆摘要</h2>
        </div>
        <div className="p-4">
          <pre className="text-sm text-ink whitespace-pre-wrap">
            {snapshot.recall?.memoryBrief ??
              "尚未加载。点击「加载完整快照」查看。"}
          </pre>
        </div>
      </div>

      {/* Graph Report */}
      {snapshot.graph?.report && (
        <div className="bg-panel rounded-xl border border-line shadow-card">
          <div className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-bold text-ink">图谱报告</h2>
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
