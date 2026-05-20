import { useState } from "react";
import type { AppContext } from "../App";
import type {
  ExperienceEntry,
  PatternEntry,
  SkillDraft,
  ReportEntry,
  LearningCurvePoint,
} from "../types";
import { api } from "../api/client";

/** Simple SVG line chart for learning curve (no chart library dependency) */
function LearningCurveChart({ data }: { data: LearningCurvePoint[] }) {
  if (data.length === 0) return null;

  const W = 700;
  const H = 200;
  const PAD = 40;
  const chartW = W - PAD * 2;
  const chartH = H - PAD * 2;

  const maxExp = Math.max(...data.map((d) => d.experiences), 1);
  const maxScore = 100;

  const expPoints = data
    .map((d, i) => {
      const x = PAD + (i / Math.max(data.length - 1, 1)) * chartW;
      const y = PAD + chartH - (d.experiences / maxExp) * chartH;
      return `${x},${y}`;
    })
    .join(" ");

  const scorePoints = data
    .map((d, i) => {
      const x = PAD + (i / Math.max(data.length - 1, 1)) * chartW;
      const score = d.avgScore ?? 0;
      const y = PAD + chartH - (score / maxScore) * chartH;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 240 }}>
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct) => (
        <line
          key={pct}
          x1={PAD}
          x2={W - PAD}
          y1={PAD + chartH * (1 - pct)}
          y2={PAD + chartH * (1 - pct)}
          stroke="rgba(38,31,19,0.08)"
          strokeDasharray="4"
        />
      ))}

      {/* Experience bars */}
      {data.map((d, i) => {
        const x = PAD + (i / Math.max(data.length - 1, 1)) * chartW;
        const barH = (d.experiences / maxExp) * chartH;
        return (
          <rect
            key={`bar-${i}`}
            x={x - 4}
            y={PAD + chartH - barH}
            width={8}
            height={barH}
            fill="rgba(15,118,110,0.15)"
            rx={2}
          />
        );
      })}

      {/* Score line */}
      <polyline
        points={scorePoints}
        fill="none"
        stroke="#b45309"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Experience line */}
      <polyline
        points={expPoints}
        fill="none"
        stroke="#0f766e"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* X axis labels */}
      {data
        .filter((_, i) => i % Math.max(1, Math.floor(data.length / 6)) === 0)
        .map((d, idx) => {
          const origIdx = data.indexOf(d);
          const x = PAD + (origIdx / Math.max(data.length - 1, 1)) * chartW;
          return (
            <text
              key={`label-${idx}`}
              x={x}
              y={H - 5}
              textAnchor="middle"
              fontSize={9}
              fill="#70695d"
            >
              {d.date.slice(5)}
            </text>
          );
        })}

      {/* Legend */}
      <circle cx={PAD} cy={12} r={4} fill="#0f766e" />
      <text x={PAD + 8} y={16} fontSize={10} fill="#1f1d18">
        经验数
      </text>
      <circle cx={PAD + 60} cy={12} r={4} fill="#b45309" />
      <text x={PAD + 68} y={16} fontSize={10} fill="#1f1d18">
        平均分
      </text>
    </svg>
  );
}

interface LearningDashboardProps {
  ctx: AppContext;
}

type Tab = "curve" | "experiences" | "patterns" | "skills" | "report";

export function LearningDashboard({ ctx }: LearningDashboardProps) {
  const [tab, setTab] = useState<Tab>("curve");
  const [curve, setCurve] = useState<LearningCurvePoint[]>([]);
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
        case "curve": {
          const r = await api.getLearningCurve(ctx.agentId, 30);
          setCurve(r.curve ?? []);
          break;
        }
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
    { key: "curve", label: "学习曲线" },
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

      {/* Learning Curve */}
      {tab === "curve" && !loading && (
        <div className="space-y-3">
          {curve.length === 0 && (
            <div className="text-center text-muted text-sm py-8">
              暂无学习数据
            </div>
          )}
          {curve.length > 0 && (
            <div className="bg-panel rounded-xl border border-line shadow-card p-4">
              <h3 className="text-sm font-bold text-ink mb-4">
                近 30 天学习趋势
              </h3>
              <LearningCurveChart data={curve} />
              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-line">
                <div>
                  <div className="text-lg font-bold text-ink">
                    {curve.reduce((s, p) => s + p.experiences, 0)}
                  </div>
                  <div className="text-xs text-muted">总经验数</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-accent">
                    {(() => {
                      const scores = curve
                        .map((p) => p.avgScore)
                        .filter((s): s is number => s !== null);
                      return scores.length > 0
                        ? (
                            scores.reduce((a, b) => a + b, 0) / scores.length
                          ).toFixed(1)
                        : "--";
                    })()}
                  </div>
                  <div className="text-xs text-muted">平均分</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-accent-2">
                    {curve.reduce((s, p) => s + p.patterns, 0)}
                  </div>
                  <div className="text-xs text-muted">识别模式数</div>
                </div>
              </div>
            </div>
          )}
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
