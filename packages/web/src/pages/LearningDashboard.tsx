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
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";

/** Simple SVG line chart for learning curve (no chart library dependency) */
function LearningCurveChart({ data }: { data: LearningCurvePoint[] }) {
  const { t } = useI18n();
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
          stroke="rgba(190,174,255,0.14)"
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
            fill="rgba(139,92,246,0.18)"
            rx={2}
          />
        );
      })}

      {/* Score line */}
      <polyline
        points={scorePoints}
        fill="none"
        stroke="#d946ef"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Experience line */}
      <polyline
        points={expPoints}
        fill="none"
        stroke="#8b5cf6"
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
              fill="#a8a0bd"
            >
              {d.date.slice(5)}
            </text>
          );
        })}

      {/* Legend */}
      <circle cx={PAD} cy={12} r={4} fill="#8b5cf6" />
      <text x={PAD + 8} y={16} fontSize={10} fill="#f7f3ff">
        {t("learning.totalExperiences")}
      </text>
      <circle cx={PAD + 60} cy={12} r={4} fill="#d946ef" />
      <text x={PAD + 68} y={16} fontSize={10} fill="#f7f3ff">
        {t("learning.averageScore")}
      </text>
    </svg>
  );
}

interface LearningDashboardProps {
  ctx: AppContext;
}

type Tab = "curve" | "experiences" | "patterns" | "skills" | "report";

export function LearningDashboard({ ctx }: LearningDashboardProps) {
  const { language, t } = useI18n();
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
    { key: "curve", label: t("learning.tab.curve") },
    { key: "experiences", label: t("learning.tab.experiences") },
    { key: "patterns", label: t("learning.tab.patterns") },
    { key: "skills", label: t("learning.tab.skills") },
    { key: "report", label: t("learning.tab.report") },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t("learning.title")} description={t("learning.desc")} eyebrow="Learning Loop" />

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
        <div className="text-center text-muted text-sm py-8">
          {t("common.loading")}
        </div>
      )}

      {/* Learning Curve */}
      {tab === "curve" && !loading && (
        <div className="space-y-3">
          {curve.length === 0 && (
            <div className="text-center text-muted text-sm py-8">
              {t("learning.empty.curve")}
            </div>
          )}
          {curve.length > 0 && (
            <div className="rounded-lg border border-line bg-panel/85 shadow-card p-4">
              <h3 className="text-sm font-bold text-ink mb-4">
                {t("learning.trend30")}
              </h3>
              <LearningCurveChart data={curve} />
              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-line">
                <div>
                  <div className="text-lg font-bold text-ink">
                    {curve.reduce((s, p) => s + p.experiences, 0)}
                  </div>
                  <div className="text-xs text-muted">{t("learning.totalExperiences")}</div>
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
                  <div className="text-xs text-muted">{t("learning.averageScore")}</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-accent-2">
                    {curve.reduce((s, p) => s + p.patterns, 0)}
                  </div>
                  <div className="text-xs text-muted">{t("learning.patternCount")}</div>
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
              {t("learning.empty.experiences")}
            </div>
          )}
          {experiences.map((exp) => (
            <div
              key={exp.id}
              className="rounded-lg border border-line bg-panel/85 shadow-card p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      exp.success
                        ? "bg-accent/10 text-accent"
                        : "border border-red-400/30 bg-red-400/10 text-red-200"
                    }`}
                  >
                    {exp.success ? t("learning.success") : t("learning.failure")}
                  </span>
                  <span className="text-xs text-muted">
                    {exp.taskType}
                  </span>
                  {exp.selfScore != null && (
                    <span className="text-xs font-mono text-accent-2">
                      {exp.selfScore}{t("learning.scoreSuffix")}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted font-mono">
                  {new Date(exp.timestamp).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}
                </span>
              </div>

              <p className="text-sm text-ink mb-2">{exp.outcome}</p>

              {exp.toolsUsed.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {exp.toolsUsed.map((t, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded bg-deep text-xs text-muted border border-line"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {exp.lessons.length > 0 && (
                <div className="mt-2 text-xs text-muted">
                  <strong>{t("learning.lessons")}:</strong>{" "}
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
              {t("learning.empty.patterns")}
            </div>
          )}
          {patterns.map((p) => (
            <div
              key={p.id}
              className="rounded-lg border border-line bg-panel/85 shadow-card p-4"
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
              {t("learning.empty.skills")}
            </div>
          )}
          {drafts.map((d) => (
            <div
              key={d.id}
              className="rounded-lg border border-line bg-panel/85 shadow-card p-4"
            >
              <h3 className="text-sm font-bold text-ink">{d.name}</h3>
              <p className="text-xs text-muted mt-1">{d.description}</p>
              <div className="mt-2 text-xs text-muted">
                {t("learning.trigger")}: {d.trigger}
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
              {t("learning.empty.report")}
            </div>
          )}
          {reports.map((r, i) => (
            <div
              key={i}
              className="rounded-lg border border-line bg-panel/85 shadow-card p-4"
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
                {t("learning.reportTotalPrefix")} {r.totalEntries} {t("learning.reportTotalSuffix")}
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
                  <div className="h-1.5 bg-deep rounded-full overflow-hidden">
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
