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
import { V2Inspector } from "./pages/V2Inspector";

export interface AppContext {
  agentId: string;
  projectId: string;
  scope: Scope;
  depth: Depth;
  agents: string[];
  projects: string[];
}

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const [ctx, setCtx] = useState<AppContext>({
    agentId: "",
    projectId: "",
    scope: "project",
    depth: "l0",
    agents: [],
    projects: [],
  });

  // Load projects for a given agent
  const loadProjects = useCallback(async (agentId: string) => {
    try {
      const res = await api.getProjects(agentId);
      if (res.ok) {
        setCtx((prev) => ({
          ...prev,
          projects: res.projects,
          projectId: res.projects.length > 0 ? res.projects[0] : "",
        }));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const loadAgents = useCallback(async () => {
    try {
      const res = await api.getAgents();
      if (res.ok && res.agents.length > 0) {
        const firstAgent = res.agents[0];
        setCtx((prev) => ({
          ...prev,
          agents: res.agents,
          agentId: prev.agentId || firstAgent,
        }));
        // Load projects for the initial agent
        void loadProjects(firstAgent);
      }
    } catch {
      /* ignore */
    }
  }, [loadProjects]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const updateCtx = useCallback((patch: Partial<AppContext>) => {
    setCtx((prev) => ({ ...prev, ...patch }));
    // When agent changes, reload projects
    if (patch.agentId) {
      void loadProjects(patch.agentId);
    }
  }, [loadProjects]);

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
        {page === "v2" && <V2Inspector ctx={ctx} />}
      </Layout>
    </div>
  );
}
