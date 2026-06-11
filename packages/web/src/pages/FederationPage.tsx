import { useState } from "react";
import type { AppContext } from "../App";
import type {
  FederationEntry,
  DependencyGraph,
  ApprovalEntry,
} from "../types";
import { api } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";

interface FederationPageProps {
  ctx: AppContext;
}

type Tab = "imports" | "dependencies" | "approvals";

export function FederationPage({ ctx }: FederationPageProps) {
  const { language, t } = useI18n();
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
    { key: "imports", label: t("federation.tab.imports") },
    { key: "dependencies", label: t("federation.tab.dependencies") },
    { key: "approvals", label: t("federation.tab.approvals") },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t("federation.title")} description={t("federation.desc")} eyebrow="Memory Governance" />

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-line bg-panel/85 p-1 shadow-card">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => loadTab(key)}
            className={`flex-1 px-3 py-2 rounded-md text-sm transition-colors ${
              tab === key
                ? "bg-accent text-white font-medium shadow-sm"
                : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="text-center text-muted text-sm py-8">{t("common.loading")}</div>
      )}

      {/* Imports */}
      {tab === "imports" && !loading && (
        <div className="space-y-3">
          {imports.length === 0 && (
            <div className="text-center text-muted text-sm py-8">
              {t("federation.empty.imports")}
            </div>
          )}
          {imports.map((entry) => (
            <div
              key={entry.id}
              className="rounded-lg border border-line bg-panel/85 shadow-card p-4"
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
                  {new Date(entry.exportedAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}
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
          <div className="rounded-lg border border-line bg-panel/85 shadow-card p-4">
            <h3 className="text-sm font-bold text-ink mb-3">
              {t("federation.projects")} ({deps.projects.length})
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
            <div className="rounded-lg border border-line bg-panel/85 shadow-card overflow-hidden">
              <div className="px-4 py-3 border-b border-line">
                <h3 className="text-sm font-bold text-ink">
                  {t("federation.relations")} ({deps.dependencies.length})
                </h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-deep/80 text-left">
                    <th className="px-4 py-2 text-xs font-bold text-muted">
                      {t("federation.sourceProject")}
                    </th>
                    <th className="px-4 py-2 text-xs font-bold text-muted">
                      {t("federation.targetProject")}
                    </th>
                    <th className="px-4 py-2 text-xs font-bold text-muted">
                      {t("federation.strength")}
                    </th>
                    <th className="px-4 py-2 text-xs font-bold text-muted">
                      {t("federation.sharedEntities")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {deps.dependencies.map((d, i) => (
                    <tr
                      key={i}
                      className="border-b border-line/50 hover:bg-white/5"
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
              {t("federation.empty.dependencies")}
            </div>
          )}
        </div>
      )}

      {/* Approvals */}
      {tab === "approvals" && !loading && (
        <div className="space-y-3">
          {approvals.length === 0 && (
            <div className="text-center text-muted text-sm py-8">
              {t("federation.empty.approvals")}
            </div>
          )}
          {approvals.map((entry) => (
            <div
              key={entry.id}
              className="rounded-lg border border-line bg-panel/85 shadow-card p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-xs border border-amber-400/30 bg-amber-400/10 text-amber-200">
                    {t("federation.pendingReview")}
                  </span>
                  <span className="text-xs text-muted">{entry.type}</span>
                </div>
                <span className="text-xs text-muted font-mono">
                  {new Date(entry.submittedAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}
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
                    {t("federation.approve")}
                  </button>
                  <button
                    onClick={() => handleReview(entry.id, "rejected")}
                    className="px-3 py-1 bg-red-500/80 text-white rounded text-xs font-medium hover:bg-red-500"
                  >
                    {t("federation.reject")}
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
