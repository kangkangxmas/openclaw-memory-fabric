import { useState } from "react";
import type { AppContext } from "../App";
import type { CarrierFile } from "../types";
import { api } from "../api/client";
import Markdown from "react-markdown";
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";

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
  const { t } = useI18n();
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
      <PageHeader
        title={t("carriers.title")}
        description={t("carriers.desc")}
        eyebrow="Carrier Projection"
        actions={
        <button
          onClick={load}
          disabled={loading || !ctx.agentId}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {loading ? t("common.loading") : t("carriers.load")}
        </button>
        }
      />

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
          <div className="flex-1 overflow-hidden rounded-lg border border-line bg-panel/85 shadow-card">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">
                {selected?.filename ?? "--"}
              </h2>
              {selected && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    selected.exists
                      ? "bg-accent/10 text-accent"
                      : "border border-red-400/30 bg-red-400/10 text-red-200"
                  }`}
                >
                  {selected.exists ? t("common.exists") : t("common.missing")}
                </span>
              )}
            </div>
            <div className="p-4 prose prose-sm max-w-none text-ink">
              {selected?.content ? (
                <Markdown>{selected.content}</Markdown>
              ) : (
                <p className="text-muted text-sm">
                  {selected?.exists === false
                    ? t("common.missing")
                    : t("common.empty")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {!loading && carriers.length === 0 && (
        <div className="text-center text-muted text-sm py-12">
          {t("common.empty")}
        </div>
      )}
    </div>
  );
}
