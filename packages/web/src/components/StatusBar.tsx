import { useState, useEffect } from "react";
import { api } from "../api/client";
import type { HealthResponse } from "../types";

export function StatusBar() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

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
    <header className="sticky top-0 z-50 bg-panel/90 backdrop-blur border-b border-line px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="text-accent font-bold text-lg tracking-tight">
          OpenClaw Memory Fabric
        </span>
        <span className="text-xs text-muted">Inspector</span>
      </div>
      <div className="flex items-center gap-3 text-xs">
        {health && (
          <>
            <span className="text-muted">v{health.version}</span>
            <span className="text-muted">
              uptime {Math.floor(health.uptimeSeconds / 3600)}h
            </span>
          </>
        )}
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${
            ok
              ? "bg-accent/10 text-accent"
              : "bg-red-100 text-red-600"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              ok ? "bg-accent" : "bg-red-500"
            }`}
          />
          {ok ? "healthy" : "offline"}
        </span>
      </div>
    </header>
  );
}
