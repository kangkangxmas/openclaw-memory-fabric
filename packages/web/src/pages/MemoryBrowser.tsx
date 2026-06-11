import { useState } from "react";
import type { AppContext } from "../App";
import type { MemoryEntry } from "../types";
import { api } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";

interface MemoryBrowserProps {
  ctx: AppContext;
}

export function MemoryBrowser({ ctx }: MemoryBrowserProps) {
  const { t, language } = useI18n();
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [scopes, setScopes] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState<string>("all");

  const load = async () => {
    if (!ctx.agentId) return;
    setLoading(true);
    try {
      const res = await api.postInspectMemories({
        agentId: ctx.agentId,
        projectId: ctx.projectId,
        scope: ctx.scope,
        query: query || undefined,
        limit: 200,
      });
      setEntries(res.entries);
      setTotal(res.totalEntries);
      setScopes(res.scopesRead);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const types = [...new Set(entries.map((e) => e.type))];
  const filtered =
    filterType === "all"
      ? entries
      : entries.filter((e) => e.type === filterType);

  return (
    <div className="space-y-4">
      <PageHeader title={t("memory.title")} description={t("memory.desc")} eyebrow="Memory Assets" />

      {/* Search bar */}
      <div className="rounded-lg border border-line bg-panel/85 p-4 shadow-card">
        <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void load()}
          placeholder={t("memory.placeholder")}
          className="flex-1 rounded-lg border border-line bg-deep px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
        />
        <button
          onClick={load}
          disabled={loading || !ctx.agentId}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {loading ? t("memory.searching") : t("memory.search")}
        </button>
        </div>
      </div>

      {/* Stats + filter */}
      {entries.length > 0 && (
        <div className="flex items-center gap-3 text-xs text-muted">
          <span>
            {t("memory.count")} {total} | {t("memory.scope")}: {scopes.join(", ")}
          </span>
          <span>|</span>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded border border-line bg-deep px-2 py-1 text-xs text-ink"
          >
            <option value="all">{t("memory.allTypes")}</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Table */}
      {filtered.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-line bg-panel/85 shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-deep/80 text-left">
                  <th className="w-40 px-4 py-2 text-xs font-semibold text-muted">
                    {t("memory.time")}
                  </th>
                  <th className="w-20 px-4 py-2 text-xs font-semibold text-muted">
                    {t("memory.type")}
                  </th>
                  <th className="w-20 px-4 py-2 text-xs font-semibold text-muted">
                    {t("filters.scope")}
                  </th>
                  <th className="px-4 py-2 text-xs font-semibold text-muted">
                    {t("memory.content")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => (
                  <tr
                    key={i}
                    className="border-b border-line/50 hover:bg-white/5"
                  >
                    <td className="px-4 py-2 text-xs text-muted font-mono whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}
                    </td>
                    <td className="px-4 py-2">
                      <span className="inline-block px-2 py-0.5 rounded text-xs bg-accent/10 text-accent">
                        {e.type}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted">
                      {e.scope}
                    </td>
                    <td className="px-4 py-2 text-sm text-ink">
                      {e.content}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && entries.length === 0 && (
        <div className="text-center text-muted text-sm py-12">
          {t("memory.empty")}
        </div>
      )}
    </div>
  );
}
