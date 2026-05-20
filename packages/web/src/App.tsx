import { useState, useEffect, useCallback } from "react";
import type { Page, Scope, Depth } from "./types";
import { api } from "./api/client";
import { Layout } from "./components/Layout";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { Overview } from "./pages/Overview";
import { MemoryBrowser } from "./pages/MemoryBrowser";
import { GraphView } from "./pages/GraphView";
import { CarrierViewer } from "./pages/CarrierViewer";
import { LearningDashboard } from "./pages/LearningDashboard";
import { FederationPage } from "./pages/FederationPage";

export interface AppContext {
  agentId: string;
  projectId: string;
  scope: Scope;
  depth: Depth;
  agents: string[];
}

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const [ctx, setCtx] = useState<AppContext>({
    agentId: "",
    projectId: "Boss",
    scope: "project",
    depth: "l0",
    agents: [],
  });

  const loadAgents = useCallback(async () => {
    try {
      const res = await api.getAgents();
      if (res.ok && res.agents.length > 0) {
        setCtx((prev) => ({
          ...prev,
          agents: res.agents,
          agentId: prev.agentId || res.agents[0],
        }));
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const updateCtx = useCallback((patch: Partial<AppContext>) => {
    setCtx((prev) => ({ ...prev, ...patch }));
  }, []);

  return (
    <div className="min-h-screen bg-bg">
      <StatusBar />
      <Layout
        sidebar={
          <Sidebar
            ctx={ctx}
            onUpdate={updateCtx}
            currentPage={page}
            onNavigate={setPage}
          />
        }
      >
        {page === "overview" && <Overview ctx={ctx} />}
        {page === "memory" && <MemoryBrowser ctx={ctx} />}
        {page === "graph" && <GraphView ctx={ctx} />}
        {page === "carriers" && <CarrierViewer ctx={ctx} />}
        {page === "learning" && <LearningDashboard ctx={ctx} />}
        {page === "federation" && <FederationPage ctx={ctx} />}
      </Layout>
    </div>
  );
}
