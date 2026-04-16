/**
 * OpenClaw hook context types.
 *
 * These interfaces mirror the hook context objects provided by the OpenClaw
 * gateway at runtime. The actual shape is determined by the OpenClaw plugin
 * API; these definitions are designed to align with the documented hook events
 * while remaining compatible with the broader plugin architecture.
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

/** Context passed to the `before_prompt_build` hook */
export interface BeforePromptBuildContext {
  /** Identifier of the current agent */
  agentId: string;
  /** Active project identifier, if any */
  projectId?: string;
  /** Message history so far in this session */
  messages: HookMessage[];
  /**
   * Prepend plain text to the system prompt / context window.
   * Called by the hook to inject the Memory Brief.
   */
  prependContext: (text: string) => void;
}

/** Context passed to the `agent_end` hook */
export interface AgentEndContext {
  /** Identifier of the current agent */
  agentId: string;
  /** Active project identifier, if any */
  projectId?: string;
  /** Full message history for the completed turn */
  messages: HookMessage[];
  /** Tool calls made during this turn */
  toolCalls?: HookToolCall[];
}

/** Context passed to the `before_tool_call` hook */
export interface BeforeToolCallContext {
  /** Identifier of the current agent */
  agentId: string;
  /** Active project identifier, if any */
  projectId?: string;
  /** The tool about to be called */
  toolName: string;
  /** The input arguments for the tool */
  toolInput?: unknown;
}

/** Context passed to the `after_tool_call` hook */
export interface AfterToolCallContext {
  /** Identifier of the current agent */
  agentId: string;
  /** Active project identifier, if any */
  projectId?: string;
  /** The tool that was called */
  toolName: string;
  /** The input arguments passed to the tool */
  toolInput?: unknown;
  /** The result returned by the tool */
  toolResult?: unknown;
  /** Execution duration in milliseconds */
  durationMs?: number;
}
