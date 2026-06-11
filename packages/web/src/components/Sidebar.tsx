import type { AppContext } from "../App";
import type { Page, Scope, Depth } from "../types";
import { useI18n } from "../i18n";
import type { ReactNode } from "react";

interface SidebarProps {
  ctx: AppContext;
  onUpdate: (patch: Partial<AppContext>) => void;
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

const NAV_GROUPS: Array<{ titleKey: string; items: Array<{ page: Page; labelKey: string; descKey: string }> }> = [
  {
    titleKey: "nav.group.ops",
    items: [
      { page: "overview", labelKey: "nav.overview", descKey: "nav.desc.overview" },
      { page: "v2", labelKey: "nav.v2", descKey: "nav.desc.v2" },
    ],
  },
  {
    titleKey: "nav.group.assets",
    items: [
      { page: "memory", labelKey: "nav.memory", descKey: "nav.desc.memory" },
      { page: "graph", labelKey: "nav.graph", descKey: "nav.desc.graph" },
      { page: "carriers", labelKey: "nav.carriers", descKey: "nav.desc.carriers" },
    ],
  },
  {
    titleKey: "nav.group.governance",
    items: [
      { page: "learning", labelKey: "nav.learning", descKey: "nav.desc.learning" },
      { page: "federation", labelKey: "nav.federation", descKey: "nav.desc.federation" },
    ],
  },
];

const SCOPES: { value: Scope; labelKey: string }[] = [
  { value: "project", labelKey: "scope.project" },
  { value: "private", labelKey: "scope.private" },
  { value: "shared", labelKey: "scope.shared" },
  { value: "auto", labelKey: "scope.auto" },
];

const DEPTHS: { value: Depth; labelKey: string; budget: string }[] = [
  { value: "l0", labelKey: "depth.l0", budget: "600" },
  { value: "l1", labelKey: "depth.l1", budget: "1800" },
  { value: "l2", labelKey: "depth.l2", budget: "5000" },
];

const MAP_STEPS = [
  "map.step.events",
  "map.step.candidates",
  "map.step.cards",
  "map.step.carriers",
  "map.step.bench",
];

function SelectShell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

export function Sidebar({ ctx, onUpdate, currentPage, onNavigate }: SidebarProps) {
  const { t } = useI18n();
  const selectClass =
    "mt-1 w-full rounded-lg border border-line bg-deep px-3 py-2 text-sm text-ink outline-none transition focus:border-accent focus:ring-1 focus:ring-accent";

  return (
    <div className="space-y-4">
      <nav className="rounded-lg border border-line bg-panel/90 p-2 shadow-card">
        {NAV_GROUPS.map((group) => (
          <div key={group.titleKey} className="mb-3 last:mb-0">
            <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              {t(group.titleKey)}
            </div>
            <div className="space-y-1">
              {group.items.map(({ page, labelKey, descKey }) => {
                const active = currentPage === page;
                return (
                  <button
                    key={page}
                    onClick={() => onNavigate(page)}
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                      active
                        ? "border-accent/50 bg-accent/16 text-ink shadow-[inset_3px_0_0_#8b5cf6]"
                        : "border-transparent text-muted hover:border-line hover:bg-white/5 hover:text-ink"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{t(labelKey)}</span>
                      {active && <span className="h-1.5 w-1.5 rounded-full bg-accent-2" />}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-muted">{t(descKey)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <section className="rounded-lg border border-line bg-panel/90 p-4 shadow-card">
        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
          {t("filters.title")}
        </h3>
        <div className="mt-4 space-y-3">
          <SelectShell label={t("filters.agent")}>
            <select
              value={ctx.agentId}
              onChange={(e) => onUpdate({ agentId: e.target.value })}
              className={selectClass}
            >
              {ctx.agents.length === 0 && (
                <option value="">{t("filters.loading")}</option>
              )}
              {ctx.agents.map((agent) => (
                <option key={agent} value={agent}>
                  {agent}
                </option>
              ))}
            </select>
          </SelectShell>

          <SelectShell label={t("filters.project")}>
            <select
              value={ctx.projectId}
              onChange={(e) => onUpdate({ projectId: e.target.value })}
              className={selectClass}
            >
              {ctx.projects.length === 0 && (
                <option value="">{t("filters.noProject")}</option>
              )}
              {ctx.projects.map((project) => (
                <option key={project} value={project}>
                  {project}
                </option>
              ))}
            </select>
          </SelectShell>

          <div className="grid grid-cols-2 gap-2">
            <SelectShell label={t("filters.scope")}>
              <select
                value={ctx.scope}
                onChange={(e) => onUpdate({ scope: e.target.value as Scope })}
                className={selectClass}
              >
                {SCOPES.map((scope) => (
                  <option key={scope.value} value={scope.value}>
                    {t(scope.labelKey)}
                  </option>
                ))}
              </select>
            </SelectShell>

            <SelectShell label={t("filters.depth")}>
              <select
                value={ctx.depth}
                onChange={(e) => onUpdate({ depth: e.target.value as Depth })}
                className={selectClass}
              >
                {DEPTHS.map((depth) => (
                  <option key={depth.value} value={depth.value}>
                    {t(depth.labelKey)} ({depth.budget})
                  </option>
                ))}
              </select>
            </SelectShell>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel/90 p-4 shadow-card">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-2">
          {t("map.title")}
        </div>
        <div className="mt-1 text-xs text-muted">{t("map.subtitle")}</div>
        <div className="mt-4 space-y-2">
          {MAP_STEPS.map((key, index) => (
            <div key={key} className="flex items-center gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent/30 bg-accent/12 text-[11px] font-semibold text-accent">
                {index + 1}
              </div>
              <div className="h-px flex-1 bg-line" />
              <div className="w-[148px] text-xs text-ink">{t(key)}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
