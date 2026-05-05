import { loadConfig } from "./config/loader.js";
import { createHealthStatus } from "./tools/health-status.js";
import { createMemoryBrief } from "./tools/memory-brief.js";
import { createMemoryCommit } from "./tools/memory-commit.js";
import { createMemoryPublishShared } from "./tools/memory-publish-shared.js";
import { createMemoryForgetScoped } from "./tools/memory-forget-scoped.js";
import { createProjectBootstrap } from "./tools/project-bootstrap.js";
import { createProjectStateRefresh } from "./tools/project-state-refresh.js";
import {
  createProjectGraphQuery,
  createProjectGraphPath,
  createProjectGraphExplain
} from "./tools/project-graph-tools.js";
import { createCarrierRead, createCarrierMerge } from "./tools/carrier-tools.js";
import { SidecarClient } from "./utils/sidecar-client.js";
import { Logger } from "./utils/logger.js";
import { MetricsCollector } from "./utils/metrics.js";
import { createBeforePromptBuildHandler } from "./hooks/before-prompt-build.js";
import { createAgentEndHandler } from "./hooks/agent-end.js";
import { createBeforeToolCallHandler } from "./hooks/before-tool-call.js";
import { createAfterToolCallHandler } from "./hooks/after-tool-call.js";
import type { MemoryFabricConfig } from "./types/index.js";

export type {
  HealthStatus,
  MemoryFabricConfig,
  MemoryBrief,
  DistillResult,
  SelfModel,
  StructuralBrief,
  MemoryScope,
  RecallDepth
} from "./types/index.js";

export type {
  BeforePromptBuildContext,
  AgentEndContext,
  BeforeToolCallContext,
  AfterToolCallContext,
  HookMessage,
  HookToolCall
} from "./hooks/types.js";

export type { MemoryBriefInput } from "./tools/memory-brief.js";
export type { MemoryCommitInput } from "./tools/memory-commit.js";
export type { MemoryPublishSharedInput } from "./tools/memory-publish-shared.js";
export type { MemoryForgetScopedInput } from "./tools/memory-forget-scoped.js";
export type { ProjectBootstrapInput } from "./tools/project-bootstrap.js";
export type { ProjectStateRefreshInput } from "./tools/project-state-refresh.js";
export type {
  ProjectGraphQueryInput,
  ProjectGraphPathInput,
  ProjectGraphExplainInput
} from "./tools/project-graph-tools.js";
export type { CarrierReadInput, CarrierMergeInput } from "./tools/carrier-tools.js";

export { ConfigValidationError } from "./config/loader.js";
export { SidecarClient, SidecarClientError } from "./utils/sidecar-client.js";
export { Logger } from "./utils/logger.js";
export { MetricsCollector } from "./utils/metrics.js";

const PLUGIN_NAME = "memory-fabric";
const PLUGIN_VERSION = "1.6.0";

export function createPlugin(userConfig?: Partial<MemoryFabricConfig>) {
  const config = loadConfig(userConfig);
  const client = new SidecarClient(config.sidecar);
  const logger = new Logger(config.observability.logLevel, config.observability.emitMetrics);
  const metrics = new MetricsCollector();

  logger.info("plugin loaded", {
    agentId: "system",
    hook: "init",
    defaultScope: config.defaultScope,
    sidecarUrl: config.sidecar.baseUrl
  } as Record<string, unknown>);

  return {
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    config,
    tools: {
      health_status: () => createHealthStatus(config, client, metrics),
      memory_brief: createMemoryBrief(client),
      memory_commit: createMemoryCommit(client),
      memory_publish_shared: createMemoryPublishShared(client),
      memory_forget_scoped: createMemoryForgetScoped(client),
      project_bootstrap: createProjectBootstrap(client),
      project_state_refresh: createProjectStateRefresh(client),
      project_graph_query: createProjectGraphQuery(client),
      project_graph_path: createProjectGraphPath(client),
      project_graph_explain: createProjectGraphExplain(client),
      carrier_read: createCarrierRead(client),
      carrier_merge: createCarrierMerge(client)
    },
    hooks: {
      before_prompt_build: createBeforePromptBuildHandler(client, config, logger, metrics),
      agent_end: createAgentEndHandler(client, config, logger, metrics),
      before_tool_call: createBeforeToolCallHandler(logger),
      after_tool_call: createAfterToolCallHandler(logger)
    }
  };
}

// Backward compat
export function createPluginScaffold() {
  return createPlugin();
}

/**
 * OpenClaw plugin entry point.
 * The gateway resolves `register` (or `activate`) from the module export.
 */
export function register(api: {
  on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => void;
  registerTool: (tool: unknown) => void;
}) {
  const instance = createPlugin();

  api.on("before_prompt_build", instance.hooks.before_prompt_build as (event: unknown, ctx: unknown) => unknown);
  api.on("agent_end", instance.hooks.agent_end as (event: unknown, ctx: unknown) => unknown);
  api.on("before_tool_call", instance.hooks.before_tool_call as (event: unknown, ctx: unknown) => unknown);
  api.on("after_tool_call", instance.hooks.after_tool_call as (event: unknown, ctx: unknown) => unknown);
}
