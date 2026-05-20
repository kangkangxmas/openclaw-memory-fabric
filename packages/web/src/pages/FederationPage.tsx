import { useState } from "react";
import type { AppContext } from "../App";
import type {
  FederationEntry,
  DependencyGraph,
  ApprovalEntry,
} from "../types";
import { api } from "../api/client";

interface FederationPageProps {
  ctx: AppContext;
}

type Tab = "imports" | "dependencies" | "approvals";

export function FederationPage({ ctx }: FederationPageProps) {
  const [tab, setTab] = useState<Tab>("imports");
  const [imports, setImports] = useState<FederationEntry[]>([]);
  const [deps, setDeps] = useState<DependencyGraph | null>(null);
  const [approvals, setApprovals] = useState<ApprovalEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTab = async (t: Tab) => {
    setTab(t);
    setLoading(true);
    try {
      switch (t) {
        case "imports": {
          const r = await api.getFederationImport(ctx.projectId);
          setImports(r.entries ?? []);
          break;
        }
        case "dependencies": {
          const r = await api.getDependencyGraph();
          setDeps(r);
          break;
        }
        case "approvals": {
          const r = await api.getPendingApprovals(ctx.projectId);
          setApprovals(r.entries ?? []);
          break;
        }
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (
    entryId: string,
    decision: "approved" | "rejected",
  ) => {
    await api.reviewApproval(entryId, decision, ctx.agentId || "inspector");
    // Reload
    const r = await api.getPendingApprovals(ctx.projectId);
    setApprovals(r.entries ?? []);
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: "imports", label: "联邦导入" },
    { key: "dependencies", label: "项目依赖" },
    { key: "approvals", label: "待审批" },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-ink">联邦管理</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-bg rounded-lg p-1 border border-line">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => loadTab(key)}
            className={`flex-1 px-3 py-2 rounded-md text-sm transition-colors ${
              tab === key
                ? "bg-panel text-accent font-medium shadow-sm"
                : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="text-center text-muted text-sm py-8">加载中...</div>
      )}

      {/* Imports */}
      {tab === "imports" && !loading && (
        <div className="space-y-3">
          {imports.length === 0 && (
            <div className="text-center text-muted text-sm py-8">
              暂无联邦导入条目
            </div>
          )}
          {imports.map((entry) => (
            <div
              key={entry.id}
              className="bg-panel rounded-xl border border-line shadow-card p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-xs bg-accent/10 text-accent">
                    {entry.type}
                  </span>
                  <span className="text-xs text-muted">
                    from {entry.sourceProject}
                  </span>
                </div>
                <span className="text-xs text-muted font-mono">
                  {new Date(entry.exportedAt).toLocaleString("zh-CN")}
                </span>
              </div>
              <p className="text-sm text-ink">{entry.content}</p>
              <div className="text-xs text-muted mt-1">
                by {entry.exportedBy}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dependencies */}
      {tab === "dependencies" && !loading && deps && (
        <div className="space-y-4">
          <div className="bg-panel rounded-xl border border-line shadow-card p-4">
            <h3 className="text-sm font-bold text-ink mb-3">
              项目节点 ({deps.projects.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {deps.projects.map((p) => (
                <span
                  key={p}
                  className="px-3 py-1 rounded-full bg-accent/10 text-accent text-xs font-medium"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>

          {deps.dependencies.length > 0 && (
            <div className="bg-panel rounded-xl border border-line shadow-card overflow-hidden">
              <div className="px-4 py-3 border-b border-line">
                <h3 className="text-sm font-bold text-ink">
                  依赖关系 ({deps.dependencies.length})
                </h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-bg/50 text-left">
                    <th className="px-4 py-2 text-xs font-bold text-muted">
                      源项目
                    </th>
                    <th className="px-4 py-2 text-xs font-bold text-muted">
                      目标项目
                    </th>
                    <th className="px-4 py-2 text-xs font-bold text-muted">
                      强度
                    </th>
                    <th className="px-4 py-2 text-xs font-bold text-muted">
                      共享实体
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {deps.dependencies.map((d, i) => (
                    <tr
                      key={i}
                      className="border-b border-line/50 hover:bg-bg/30"
                    >
                      <td className="px-4 py-2 font-mono text-xs">
                        {d.from}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {d.to}
                      </td>
                      <td className="px-4 py-2">
                        <span className="text-xs font-bold text-accent">
                          {d.strength}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs text-muted">
                        {d.sharedEntities.slice(0, 3).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {deps.dependencies.length === 0 && (
            <div className="text-center text-muted text-sm py-8">
              暂无项目间依赖关系
            </div>
          )}
        </div>
      )}

      {/* Approvals */}
      {tab === "approvals" && !loading && (
        <div className="space-y-3">
          {approvals.length === 0 && (
            <div className="text-center text-muted text-sm py-8">
              暂无待审批条目
            </div>
          )}
          {approvals.map((entry) => (
            <div
              key={entry.id}
              className="bg-panel rounded-xl border border-line shadow-card p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700">
                    待审核
                  </span>
                  <span className="text-xs text-muted">{entry.type}</span>
                </div>
                <span className="text-xs text-muted font-mono">
                  {new Date(entry.submittedAt).toLocaleString("zh-CN")}
                </span>
              </div>
              <p className="text-sm text-ink mb-3">{entry.content}</p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">
                  by {entry.sourceAgent} | {entry.projectId}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleReview(entry.id, "approved")}
                    className="px-3 py-1 bg-accent text-white rounded text-xs font-medium hover:bg-accent/90"
                  >
                    批准
                  </button>
                  <button
                    onClick={() => handleReview(entry.id, "rejected")}
                    className="px-3 py-1 bg-red-500 text-white rounded text-xs font-medium hover:bg-red-600"
                  >
                    拒绝
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
