import { useState } from "react";
import type { AppContext } from "../App";
import type { MemoryEntry } from "../types";
import { api } from "../api/client";

interface MemoryBrowserProps {
  ctx: AppContext;
}

export function MemoryBrowser({ ctx }: MemoryBrowserProps) {
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
      <h1 className="text-xl font-bold text-ink">记忆浏览</h1>

      {/* Search bar */}
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
          placeholder="搜索记忆内容..."
          className="flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          onClick={load}
          disabled={loading || !ctx.agentId}
          className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
        >
          {loading ? "加载中..." : "搜索"}
        </button>
      </div>

      {/* Stats + filter */}
      {entries.length > 0 && (
        <div className="flex items-center gap-3 text-xs text-muted">
          <span>
            共 {total} 条 | 范围: {scopes.join(", ")}
          </span>
          <span>|</span>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded border border-line bg-bg px-2 py-1 text-xs"
          >
            <option value="all">全部类型</option>
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
        <div className="bg-panel rounded-xl border border-line shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-bg/50 text-left">
                  <th className="px-4 py-2 text-xs font-bold text-muted w-40">
                    时间
                  </th>
                  <th className="px-4 py-2 text-xs font-bold text-muted w-20">
                    类型
                  </th>
                  <th className="px-4 py-2 text-xs font-bold text-muted w-20">
                    范围
                  </th>
                  <th className="px-4 py-2 text-xs font-bold text-muted">
                    内容
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => (
                  <tr
                    key={i}
                    className="border-b border-line/50 hover:bg-bg/30"
                  >
                    <td className="px-4 py-2 text-xs text-muted font-mono whitespace-nowrap">
                      {new Date(e.createdAt).toLocaleString("zh-CN")}
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
          点击「搜索」加载记忆条目
        </div>
      )}
    </div>
  );
}
