import { useState } from "react";
import type { AppContext } from "../App";
import type {
  ExperienceEntry,
  PatternEntry,
  SkillDraft,
  ReportEntry,
} from "../types";
import { api } from "../api/client";

interface LearningDashboardProps {
  ctx: AppContext;
}

type Tab = "experiences" | "patterns" | "skills" | "report";

export function LearningDashboard({ ctx }: LearningDashboardProps) {
  const [tab, setTab] = useState<Tab>("experiences");
  const [experiences, setExperiences] = useState<ExperienceEntry[]>([]);
  const [patterns, setPatterns] = useState<PatternEntry[]>([]);
  const [drafts, setDrafts] = useState<SkillDraft[]>([]);
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTab = async (t: Tab) => {
    setTab(t);
    if (!ctx.agentId && t !== "skills") return;
    setLoading(true);
    try {
      switch (t) {
        case "experiences": {
          const r = await api.getExperiences(ctx.agentId);
          setExperiences(r.entries ?? []);
          break;
        }
        case "patterns": {
          const r = await api.getPatterns(ctx.agentId);
          setPatterns(r.patterns ?? []);
          break;
        }
        case "skills": {
          const r = await api.getSkillDrafts();
          setDrafts(r.drafts ?? []);
          break;
        }
        case "report": {
          const r = await api.getReport(ctx.agentId);
          setReports(r.reports ?? []);
          break;
        }
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: "experiences", label: "经验记录" },
    { key: "patterns", label: "识别模式" },
    { key: "skills", label: "技能草稿" },
    { key: "report", label: "评分报告" },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-ink">自学习仪表板</h1>

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
        <div className="text-center text-muted text-sm py-8">
          加载中...
        </div>
      )}

      {/* Experiences */}
      {tab === "experiences" && !loading && (
        <div className="space-y-3">
          {experiences.length === 0 && (
            <div className="text-center text-muted text-sm py-8">
              暂无经验记录
            </div>
          )}
          {experiences.map((exp) => (
            <div
              key={exp.id}
              className="bg-panel rounded-xl border border-line shadow-card p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      exp.success
                        ? "bg-accent/10 text-accent"
                        : "bg-red-100 text-red-600"
                    }`}
                  >
                    {exp.success ? "成功" : "失败"}
                  </span>
                  <span className="text-xs text-muted">
                    {exp.taskType}
                  </span>
                  {exp.selfScore != null && (
                    <span className="text-xs font-mono text-accent-2">
                      {exp.selfScore}分
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted font-mono">
                  {new Date(exp.timestamp).toLocaleString("zh-CN")}
                </span>
              </div>

              <p className="text-sm text-ink mb-2">{exp.outcome}</p>

              {exp.toolsUsed.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {exp.toolsUsed.map((t, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded bg-bg text-xs text-muted border border-line"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {exp.lessons.length > 0 && (
                <div className="mt-2 text-xs text-muted">
                  <strong>教训:</strong>{" "}
                  {exp.lessons.join("; ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Patterns */}
      {tab === "patterns" && !loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {patterns.length === 0 && (
            <div className="col-span-2 text-center text-muted text-sm py-8">
              暂无识别模式
            </div>
          )}
          {patterns.map((p) => (
            <div
              key={p.id}
              className="bg-panel rounded-xl border border-line shadow-card p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-muted">
                  freq: {p.frequency}
                </span>
                <span className="text-xs font-mono text-accent">
                  conf: {(p.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <p className="text-sm text-ink">{p.pattern}</p>
              {p.examples.length > 0 && (
                <div className="mt-2 text-xs text-muted">
                  {p.examples.slice(0, 2).join(" | ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Skill drafts */}
      {tab === "skills" && !loading && (
        <div className="space-y-3">
          {drafts.length === 0 && (
            <div className="text-center text-muted text-sm py-8">
              暂无技能草稿
            </div>
          )}
          {drafts.map((d) => (
            <div
              key={d.id}
              className="bg-panel rounded-xl border border-line shadow-card p-4"
            >
              <h3 className="text-sm font-bold text-ink">{d.name}</h3>
              <p className="text-xs text-muted mt-1">{d.description}</p>
              <div className="mt-2 text-xs text-muted">
                触发: {d.trigger}
              </div>
              <pre className="mt-2 text-xs font-mono bg-ink text-green-400 rounded-lg p-3 overflow-auto max-h-40">
                {d.body}
              </pre>
            </div>
          ))}
        </div>
      )}

      {/* Reports */}
      {tab === "report" && !loading && (
        <div className="space-y-3">
          {reports.length === 0 && (
            <div className="text-center text-muted text-sm py-8">
              暂无评分报告
            </div>
          )}
          {reports.map((r, i) => (
            <div
              key={i}
              className="bg-panel rounded-xl border border-line shadow-card p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-bold text-ink">
                  {r.agentId}
                </span>
                <span className="text-lg font-bold text-accent">
                  {r.avgScore.toFixed(1)}
                </span>
              </div>
              <div className="text-xs text-muted mb-2">
                共 {r.totalEntries} 条经验
              </div>

              {/* Dimension bars */}
              {Object.entries(r.dimensions).map(([dim, score]) => (
                <div key={dim} className="mb-2">
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-muted">{dim}</span>
                    <span className="font-mono text-ink">
                      {score}
                    </span>
                  </div>
                  <div className="h-1.5 bg-bg rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all"
                      style={{ width: `${score}%` }}
                    />
                  </div>
                </div>
              ))}

              {r.rationale && (
                <p className="mt-2 text-xs text-muted italic">
                  {r.rationale}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
