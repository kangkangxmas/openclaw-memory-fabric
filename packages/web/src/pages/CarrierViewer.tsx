import { useState } from "react";
import type { AppContext } from "../App";
import type { CarrierFile } from "../types";
import { api } from "../api/client";
import Markdown from "react-markdown";

interface CarrierViewerProps {
  ctx: AppContext;
}

const DEFAULT_FILES = [
  "self-model.md",
  "project-model.md",
  "decision-log.md",
  "entities-glossary.md",
  "playbooks.md",
  "open-questions.md",
  "execution-journal.md",
  "identity.md",
  "working-style.md",
];

export function CarrierViewer({ ctx }: CarrierViewerProps) {
  const [carriers, setCarriers] = useState<CarrierFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<CarrierFile | null>(null);

  const load = async () => {
    if (!ctx.agentId) return;
    setLoading(true);
    try {
      const res = await api.postCarrierRead({
        agentId: ctx.agentId,
        projectId: ctx.projectId,
        files: DEFAULT_FILES,
      });
      setCarriers(res.carriers);
      if (res.carriers.length > 0 && !selected) {
        setSelected(res.carriers.find((c) => c.exists) ?? res.carriers[0]);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-ink">载体文件</h1>
        <button
          onClick={load}
          disabled={loading || !ctx.agentId}
          className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 disabled:opacity-50"
        >
          {loading ? "加载中..." : "加载载体文件"}
        </button>
      </div>

      {carriers.length > 0 && (
        <div className="flex gap-4">
          {/* File list */}
          <div className="w-52 shrink-0 space-y-1">
            {carriers.map((c) => (
              <button
                key={c.filename}
                onClick={() => setSelected(c)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  selected?.filename === c.filename
                    ? "bg-accent/10 text-accent font-medium"
                    : c.exists
                      ? "text-ink hover:bg-line/50"
                      : "text-muted/50 line-through"
                }`}
              >
                {c.filename}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 bg-panel rounded-xl border border-line shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
              <h2 className="text-sm font-bold text-ink">
                {selected?.filename ?? "--"}
              </h2>
              {selected && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    selected.exists
                      ? "bg-accent/10 text-accent"
                      : "bg-red-100 text-red-600"
                  }`}
                >
                  {selected.exists ? "存在" : "未创建"}
                </span>
              )}
            </div>
            <div className="p-4 prose prose-sm max-w-none text-ink">
              {selected?.content ? (
                <Markdown>{selected.content}</Markdown>
              ) : (
                <p className="text-muted text-sm">
                  {selected?.exists === false
                    ? "文件尚未创建"
                    : "无内容"}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {!loading && carriers.length === 0 && (
        <div className="text-center text-muted text-sm py-12">
          点击「加载载体文件」查看 agent 的 9 个稳定载体
        </div>
      )}
    </div>
  );
}
