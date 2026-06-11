import { useState, useEffect } from "react";
import { api } from "../api/client";
import type { HealthResponse } from "../types";
import { useI18n } from "../i18n";

export function StatusBar() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const { language, setLanguage, t } = useI18n();

  useEffect(() => {
    const check = () => {
      api.getHealth().then(setHealth).catch(() => setHealth(null));
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  const ok = health?.ok ?? false;

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-deep/92 px-5 py-3 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/40 bg-accent/15 text-sm font-bold text-accent">
            MF
          </div>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold tracking-tight text-ink">
              {t("app.name")}
            </div>
            <div className="truncate text-xs text-muted">{t("app.subtitle")}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {health && (
            <>
              <span className="rounded-md border border-line bg-panel px-2 py-1 text-muted">
                {t("status.version")} {health.version}
              </span>
              <span className="rounded-md border border-line bg-panel px-2 py-1 text-muted">
                {t("status.uptime")} {Math.floor(health.uptimeSeconds / 3600)}h
              </span>
            </>
          )}
          <span
            className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 ${
              ok
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                : "border-red-400/30 bg-red-400/10 text-red-300"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                ok ? "bg-emerald-300" : "bg-red-300"
              }`}
            />
            {ok ? t("status.healthy") : t("status.offline")}
          </span>
          <div className="flex rounded-md border border-line bg-panel p-1">
            <button
              onClick={() => setLanguage("zh")}
              className={`rounded px-2 py-0.5 ${
                language === "zh" ? "bg-accent text-white" : "text-muted hover:text-ink"
              }`}
            >
              {t("app.lang.zh")}
            </button>
            <button
              onClick={() => setLanguage("en")}
              className={`rounded px-2 py-0.5 ${
                language === "en" ? "bg-accent text-white" : "text-muted hover:text-ink"
              }`}
            >
              {t("app.lang.en")}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
