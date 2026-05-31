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
import type { MemoryBriefInput } from "./tools/memory-brief.js";
import type { MemoryCommitInput } from "./tools/memory-commit.js";
import type { MemoryPublishSharedInput } from "./tools/memory-publish-shared.js";
import type { MemoryForgetScopedInput } from "./tools/memory-forget-scoped.js";
import type { ProjectBootstrapInput } from "./tools/project-bootstrap.js";
import type { ProjectStateRefreshInput } from "./tools/project-state-refresh.js";
import type {
  ProjectGraphQueryInput,
  ProjectGraphPathInput,
  ProjectGraphExplainInput
} from "./tools/project-graph-tools.js";
import type { CarrierReadInput, CarrierMergeInput } from "./tools/carrier-tools.js";

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
const PLUGIN_VERSION = "1.8.0";

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

function asToolArgsRecord(args: unknown): Record<string, unknown> {
  return args && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

function toToolResult(details: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(details, null, 2)
      }
    ],
    details
  };
}

function createJsonTool(params: {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}) {
  return {
    name: params.name,
    label: params.label,
    description: params.description,
    parameters: params.parameters,
    execute: async (_toolCallId: string, args: unknown) => {
      const result = await params.run(asToolArgsRecord(args));
      return toToolResult(result);
    }
  };
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

  api.registerTool(
    createJsonTool({
      name: "health_status",
      label: "Memory Fabric Health",
      description: "Returns the current health and configuration summary of the Memory Fabric plugin.",
      parameters: {
        type: "object",
        properties: {}
      },
      run: async () => instance.tools.health_status()
    })
  );
  api.registerTool(
    createJsonTool({
      name: "memory_brief",
      label: "Memory Brief",
      description: "Generates a memory brief for the current agent and project context.",
      parameters: {
        type: "object",
        required: ["agentId"],
        properties: {
          agentId: { type: "string", minLength: 1 },
          scope: { type: "string", enum: ["private", "project", "shared", "auto"] },
          projectId: { type: "string" },
          depth: { type: "string", enum: ["l0", "l1", "l2"] },
          query: { type: "string" }
        }
      },
      run: async (args) => instance.tools.memory_brief(args as unknown as MemoryBriefInput)
    })
  );
  api.registerTool(
    createJsonTool({
      name: "memory_commit",
      label: "Memory Commit",
      description: "Explicitly commits key memory items from the current session.",
      parameters: {
        type: "object",
        required: ["agentId"],
        properties: {
          agentId: { type: "string", minLength: 1 },
          projectId: { type: "string" },
          facts: { type: "array", items: { type: "string" } },
          decisions: { type: "array", items: { type: "string" } },
          entities: { type: "array", items: { type: "string" } },
          patterns: { type: "array", items: { type: "string" } },
          visibility: { type: "string", enum: ["private", "project_shared", "org_shared"] }
        }
      },
      run: async (args) => instance.tools.memory_commit(args as unknown as MemoryCommitInput)
    })
  );
  api.registerTool(
    createJsonTool({
      name: "memory_publish_shared",
      label: "Memory Publish Shared",
      description: "Publishes selected memory items to the project or org shared memory space.",
      parameters: {
        type: "object",
        required: ["projectId", "agentId", "items"],
        properties: {
          projectId: { type: "string", minLength: 1 },
          agentId: { type: "string", minLength: 1 },
          visibility: { type: "string", enum: ["project_shared", "org_shared"] },
          items: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["type", "content"],
              properties: {
                type: { type: "string", enum: ["fact", "decision", "entity", "pattern", "note"] },
                content: { type: "string", minLength: 1 },
                tags: { type: "array", items: { type: "string" } }
              }
            }
          }
        }
      },
      run: async (args) => instance.tools.memory_publish_shared(args as unknown as MemoryPublishSharedInput)
    })
  );
  api.registerTool(
    createJsonTool({
      name: "memory_forget_scoped",
      label: "Memory Forget Scoped",
      description: "Retracts shared memory entries matching the given query within a project scope.",
      parameters: {
        type: "object",
        required: ["projectId", "query"],
        properties: {
          projectId: { type: "string", minLength: 1 },
          agentId: { type: "string" },
          query: { type: "string", minLength: 1 }
        }
      },
      run: async (args) => instance.tools.memory_forget_scoped(args as unknown as MemoryForgetScopedInput)
    })
  );
  api.registerTool(
    createJsonTool({
      name: "project_bootstrap",
      label: "Project Bootstrap",
      description: "Initializes a project knowledge graph by scanning the given file paths with Graphify.",
      parameters: {
        type: "object",
        required: ["projectId", "paths"],
        properties: {
          projectId: { type: "string", minLength: 1 },
          paths: { type: "array", minItems: 1, items: { type: "string" } },
          mode: { type: "string", enum: ["auto", "full"] }
        }
      },
      run: async (args) => instance.tools.project_bootstrap(args as unknown as ProjectBootstrapInput)
    })
  );
  api.registerTool(
    createJsonTool({
      name: "project_state_refresh",
      label: "Project State Refresh",
      description: "Returns the current structural brief for a project without triggering a rebuild.",
      parameters: {
        type: "object",
        required: ["projectId"],
        properties: {
          projectId: { type: "string", minLength: 1 }
        }
      },
      run: async (args) => instance.tools.project_state_refresh(args as unknown as ProjectStateRefreshInput)
    })
  );
  api.registerTool(
    createJsonTool({
      name: "project_graph_query",
      label: "Project Graph Query",
      description: "Queries the project knowledge graph for nodes matching a semantic query.",
      parameters: {
        type: "object",
        required: ["projectId", "query"],
        properties: {
          projectId: { type: "string", minLength: 1 },
          query: { type: "string", minLength: 1 },
          budget: { type: "number", minimum: 1 }
        }
      },
      run: async (args) => instance.tools.project_graph_query(args as unknown as ProjectGraphQueryInput)
    })
  );
  api.registerTool(
    createJsonTool({
      name: "project_graph_path",
      label: "Project Graph Path",
      description: "Finds the shortest path between two nodes in the project knowledge graph.",
      parameters: {
        type: "object",
        required: ["projectId", "from", "to"],
        properties: {
          projectId: { type: "string", minLength: 1 },
          from: { type: "string", minLength: 1 },
          to: { type: "string", minLength: 1 }
        }
      },
      run: async (args) => instance.tools.project_graph_path(args as unknown as ProjectGraphPathInput)
    })
  );
  api.registerTool(
    createJsonTool({
      name: "project_graph_explain",
      label: "Project Graph Explain",
      description: "Returns a natural language explanation of a concept or relationship within the project graph.",
      parameters: {
        type: "object",
        required: ["projectId", "query"],
        properties: {
          projectId: { type: "string", minLength: 1 },
          query: { type: "string", minLength: 1 }
        }
      },
      run: async (args) => instance.tools.project_graph_explain(args as unknown as ProjectGraphExplainInput)
    })
  );
  api.registerTool(
    createJsonTool({
      name: "carrier_read",
      label: "Carrier Read",
      description: "Reads one or more stable carrier files for the given agent and project.",
      parameters: {
        type: "object",
        required: ["agentId"],
        properties: {
          agentId: { type: "string", minLength: 1 },
          projectId: { type: "string" },
          files: { type: "array", items: { type: "string" } }
        }
      },
      run: async (args) => instance.tools.carrier_read(args as unknown as CarrierReadInput)
    })
  );
  api.registerTool(
    createJsonTool({
      name: "carrier_merge",
      label: "Carrier Merge",
      description: "Merges patch content into stable carrier files using per-file merge strategies.",
      parameters: {
        type: "object",
        required: ["agentId", "patches"],
        properties: {
          agentId: { type: "string", minLength: 1 },
          projectId: { type: "string" },
          patches: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["filename", "content"],
              properties: {
                filename: { type: "string", minLength: 1 },
                content: { type: "string", minLength: 1 }
              }
            }
          }
        }
      },
      run: async (args) => instance.tools.carrier_merge(args as unknown as CarrierMergeInput)
    })
  );

  api.on("before_prompt_build", instance.hooks.before_prompt_build as (event: unknown, ctx: unknown) => unknown);
  api.on("agent_end", instance.hooks.agent_end as (event: unknown, ctx: unknown) => unknown);
  api.on("before_tool_call", instance.hooks.before_tool_call as (event: unknown, ctx: unknown) => unknown);
  api.on("after_tool_call", instance.hooks.after_tool_call as (event: unknown, ctx: unknown) => unknown);
}
