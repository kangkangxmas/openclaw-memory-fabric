/**
 * OpenClaw hook types — aligned with the SDK's PluginHookHandlerMap contract.
 *
 * Each hook receives two arguments: (event, ctx).
 *   event — payload specific to the hook (prompt, messages, tool name, …)
 *   ctx   — agent-level context shared across hooks (agentId, sessionKey, …)
 *
 * before_prompt_build returns { prependContext?: string } instead of calling
 * a prependContext() function.
 */

export interface HookMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

export interface HookToolCall {
  name: string;
  input?: unknown;
  result?: unknown;
}

/** Shared agent-level context passed as the second argument to every hook */
export interface HookAgentContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  channelId?: string;
  trigger?: string;
}

/** event argument for `before_prompt_build` */
export interface BeforePromptBuildEvent {
  prompt: string;
  messages: HookMessage[];
}

/** Return value for `before_prompt_build` — content is injected via fields */
export interface BeforePromptBuildResult {
  prependContext?: string;
}

/** event argument for `agent_end` */
export interface AgentEndEvent {
  messages: HookMessage[];
  toolCalls?: HookToolCall[];
}

/** event argument for `before_tool_call` */
export interface BeforeToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
  toolCallId?: string;
}

/** event argument for `after_tool_call` */
export interface AfterToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
  runId?: string;
  toolCallId?: string;
}

// ---------------------------------------------------------------------------
// Legacy aliases — kept so internal helpers that still use the old flat shape
// can be migrated incrementally without breaking the build.
// ---------------------------------------------------------------------------

/** @deprecated Use BeforePromptBuildEvent + HookAgentContext separately */
export interface BeforePromptBuildContext {
  agentId: string;
  projectId?: string;
  messages: HookMessage[];
  prependContext: (text: string) => void;
}

/** @deprecated Use AgentEndEvent + HookAgentContext separately */
export interface AgentEndContext {
  agentId: string;
  projectId?: string;
  messages: HookMessage[];
  toolCalls?: HookToolCall[];
}

/** @deprecated Use BeforeToolCallEvent + HookAgentContext separately */
export interface BeforeToolCallContext {
  agentId: string;
  projectId?: string;
  toolName: string;
  toolInput?: unknown;
}

/** @deprecated Use AfterToolCallEvent + HookAgentContext separately */
export interface AfterToolCallContext {
  agentId: string;
  projectId?: string;
  toolName: string;
  toolInput?: unknown;
  toolResult?: unknown;
  durationMs?: number;
}
