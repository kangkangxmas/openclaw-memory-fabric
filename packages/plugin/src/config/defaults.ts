import type { MemoryFabricConfig } from "../types/index.js";

export const defaultConfig: MemoryFabricConfig = {
  defaultScope: "project",
  recallBudget: {
    l0Tokens: 600,
    l1Tokens: 1800,
    l2Tokens: 5000
  },
  sidecar: {
    baseUrl: "http://127.0.0.1:7811",
    timeoutMs: 12_000
  },
  openviking: {
    mode: "local",
    basePath: "~/.openviking",
    targetRoot: "viking://org/default"
  },
  graphify: {
    basePath: "~/.graphify-projects",
    autoBootstrap: true,
    autoRefresh: "manual"
  },
  publishPolicy: {
    defaultVisibility: "private",
    allowOrgShared: false
  },
  observability: {
    logLevel: "info",
    emitMetrics: false
  }
};
