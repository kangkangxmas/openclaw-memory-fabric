import type { AppContext } from "../App";
import type { Page, Scope, Depth } from "../types";

interface SidebarProps {
  ctx: AppContext;
  onUpdate: (patch: Partial<AppContext>) => void;
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

const NAV_ITEMS: { page: Page; label: string }[] = [
  { page: "overview", label: "总览" },
  { page: "memory", label: "记忆浏览" },
  { page: "graph", label: "知识图谱" },
  { page: "carriers", label: "载体文件" },
  { page: "learning", label: "自学习" },
  { page: "federation", label: "联邦" },
];

const SCOPES: Scope[] = ["project", "private", "shared", "auto"];
const DEPTHS: Depth[] = ["l0", "l1", "l2"];

export function Sidebar({ ctx, onUpdate, currentPage, onNavigate }: SidebarProps) {
  return (
    <div className="space-y-4">
      {/* Navigation */}
      <nav className="bg-panel rounded-xl border border-line p-2 shadow-card">
        {NAV_ITEMS.map(({ page, label }) => (
          <button
            key={page}
            onClick={() => onNavigate(page)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              currentPage === page
                ? "bg-accent/10 text-accent font-medium"
                : "text-ink hover:bg-line/50"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Controls */}
      <div className="bg-panel rounded-xl border border-line p-4 shadow-card space-y-3">
        <h3 className="text-xs font-bold text-muted uppercase tracking-wider">
          查询参数
        </h3>

        <label className="block">
          <span className="text-xs text-muted">Agent</span>
          <select
            value={ctx.agentId}
            onChange={(e) => onUpdate({ agentId: e.target.value })}
            className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {ctx.agents.length === 0 && (
              <option value="">loading...</option>
            )}
            {ctx.agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-muted">Project ID</span>
          <input
            type="text"
            value={ctx.projectId}
            onChange={(e) => onUpdate({ projectId: e.target.value })}
            className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>

        <label className="block">
          <span className="text-xs text-muted">Scope</span>
          <select
            value={ctx.scope}
            onChange={(e) => onUpdate({ scope: e.target.value as Scope })}
            className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {SCOPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-muted">Recall Depth</span>
          <select
            value={ctx.depth}
            onChange={(e) => onUpdate({ depth: e.target.value as Depth })}
            className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {DEPTHS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
