import { useState, useCallback } from "react";
import type { AppContext } from "../App";
import type { GraphNode, GraphEdge } from "../types";
import { api } from "../api/client";

// Dynamically import to avoid SSR issues
import ForceGraph2D from "react-force-graph-2d";

interface GraphViewProps {
  ctx: AppContext;
}

const NODE_COLORS: Record<string, string> = {
  symbol: "#0f766e",
  entity: "#b45309",
  person: "#7c3aed",
  place: "#0369a1",
  topic: "#be123c",
  module: "#0f766e",
  concept: "#b45309",
  file: "#64748b",
};

interface FGNode {
  id: string;
  name: string;
  type: string;
  mentions: number;
  color: string;
  val: number;
}

interface FGLink {
  source: string;
  target: string;
  weight: number;
}

interface FGGraphData {
  nodes: FGNode[];
  links: FGLink[];
}

export function GraphView({ ctx }: GraphViewProps) {
  const [graphData, setGraphData] = useState<FGGraphData | null>(null);
  const [report, setReport] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FGNode | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  // Graph query
  const [queryText, setQueryText] = useState("");
  const [queryResult, setQueryResult] = useState<string>("");

  const loadGraph = async () => {
    if (!ctx.projectId) return;
    setLoading(true);
    try {
      const res = await api.postInspectGraph(ctx.projectId);
      setReport(res.report);

      const nodes: FGNode[] = res.topNodes.map((n: GraphNode) => ({
        id: n.id,
        name: n.id,
        type: n.type,
        mentions: n.mentions,
        color: NODE_COLORS[n.type] || "#64748b",
        val: Math.max(2, Math.sqrt(n.mentions) * 3),
      }));

      const nodeIds = new Set(nodes.map((n) => n.id));
      const links: FGLink[] = res.topEdges
        .filter(
          (e: GraphEdge) => nodeIds.has(e.source) && nodeIds.has(e.target),
        )
        .map((e: GraphEdge) => ({
          source: e.source,
          target: e.target,
          weight: e.weight,
        }));

      setGraphData({ nodes, links });
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const handleNodeClick = useCallback((node: FGNode) => {
    setSelected(node);
  }, []);

  const runQuery = async () => {
    if (!queryText || !ctx.projectId) return;
    try {
      const res = await api.postGraphQuery({
        projectId: ctx.projectId,
        query: queryText,
      });
      setQueryResult(JSON.stringify(res, null, 2));
    } catch (e) {
      setQueryResult(e instanceof Error ? e.message : String(e));
    }
  };

  // Highlight searched nodes
  const highlightSet = new Set<string>();
  if (searchTerm && graphData) {
    const lower = searchTerm.toLowerCase();
    graphData.nodes.forEach((n) => {
      if (n.id.toLowerCase().includes(lower)) highlightSet.add(n.id);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">知识图谱</h1>
        <button
          onClick={loadGraph}
          disabled={loading}
          className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
        >
          {loading ? "加载中..." : "加载图谱"}
        </button>
      </div>

      {/* Graph canvas */}
      {graphData && (
        <>
          {/* Search */}
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索节点..."
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />

          {/* Legend */}
          <div className="flex flex-wrap gap-3 text-xs">
            {Object.entries(NODE_COLORS).map(([type, color]) => (
              <span key={type} className="flex items-center gap-1">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ background: color }}
                />
                {type}
              </span>
            ))}
          </div>

          <div className="bg-panel rounded-xl border border-line shadow-card overflow-hidden">
            <ForceGraph2D
              graphData={graphData}
              width={800}
              height={500}
              nodeLabel="name"
              nodeColor={(node: FGNode) =>
                highlightSet.has(node.id)
                  ? "#ef4444"
                  : node.color
              }
              nodeRelSize={4}
              nodeVal={(node: FGNode) => node.val}
              linkWidth={(link: FGLink) =>
                Math.max(1, link.weight * 2)
              }
              linkColor={() => "rgba(38,31,19,0.15)"}
              onNodeClick={handleNodeClick}
              backgroundColor="#f3efe4"
              cooldownTicks={100}
            />
          </div>

          {/* Selected node info */}
          {selected && (
            <div className="bg-panel rounded-xl border border-line shadow-card p-4">
              <h3 className="text-sm font-bold text-ink mb-2">
                节点详情
              </h3>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted">ID</dt>
                  <dd className="font-mono">{selected.id}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">类型</dt>
                  <dd>
                    <span
                      className="inline-block px-2 py-0.5 rounded text-xs text-white"
                      style={{ background: selected.color }}
                    >
                      {selected.type}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">引用次数</dt>
                  <dd>{selected.mentions}</dd>
                </div>
              </dl>
            </div>
          )}
        </>
      )}

      {/* Graph report */}
      {report && (
        <div className="bg-panel rounded-xl border border-line shadow-card">
          <div className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-bold text-ink">图谱报告</h2>
          </div>
          <div className="p-4">
            <pre className="text-sm text-ink whitespace-pre-wrap">
              {report}
            </pre>
          </div>
        </div>
      )}

      {/* Graph query */}
      <div className="bg-panel rounded-xl border border-line shadow-card p-4 space-y-3">
        <h3 className="text-sm font-bold text-ink">图谱查询</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runQuery()}
            placeholder="输入查询关键词..."
            className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={runQuery}
            className="px-4 py-2 bg-accent-2 text-white rounded-lg text-sm font-medium hover:bg-accent-2/90"
          >
            查询
          </button>
        </div>
        {queryResult && (
          <pre className="text-xs font-mono bg-ink text-green-400 rounded-lg p-3 overflow-auto max-h-64">
            {queryResult}
          </pre>
        )}
      </div>
    </div>
  );
}
