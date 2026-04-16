import type { Logger } from "../utils/logger.js";
import type { BeforeToolCallContext } from "./types.js";

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
  return function handleBeforeToolCall(ctx: BeforeToolCallContext): void {
    if (!isHighValue(ctx.toolName)) return;

    logger.debug("before_tool_call: high-value tool observed", {
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      hook: "before_tool_call",
      tool: ctx.toolName,
      inputSummary:
        typeof ctx.toolInput === "object" && ctx.toolInput !== null
          ? Object.keys(ctx.toolInput as Record<string, unknown>).join(",")
          : undefined
    } as Record<string, unknown>);
  };
}
