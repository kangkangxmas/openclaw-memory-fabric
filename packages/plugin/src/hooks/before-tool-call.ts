import type { Logger } from "../utils/logger.js";
import type { BeforeToolCallEvent, HookAgentContext } from "./types.js";

/**
 * High-value tool names worth observing for distill enrichment.
 * These indicate significant side-effects that should be surfaced in memory.
 */
const HIGH_VALUE_TOOLS = new Set([
  "write_file",
  "create_file",
  "edit_file",
  "delete_file",
  "bash",
  "run_command",
  "git_commit",
  "git_push",
  "http_request",
  "fetch",
  "database_query",
  "database_write"
]);

function isHighValue(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return (
    HIGH_VALUE_TOOLS.has(lower) ||
    lower.includes("write") ||
    lower.includes("create") ||
    lower.includes("delete") ||
    lower.includes("commit") ||
    lower.includes("deploy") ||
    lower.includes("publish")
  );
}

export function createBeforeToolCallHandler(logger: Logger) {
  return function handleBeforeToolCall(event: BeforeToolCallEvent, ctx: HookAgentContext): void {
    if (!isHighValue(event.toolName)) return;

    logger.debug("before_tool_call: high-value tool observed", {
      agentId: ctx.agentId,
      hook: "before_tool_call",
      tool: event.toolName,
      inputSummary:
        typeof event.params === "object" && event.params !== null
          ? Object.keys(event.params).join(",")
          : undefined
    } as Record<string, unknown>);
  };
}
