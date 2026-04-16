import type { Logger } from "../utils/logger.js";
import type { AfterToolCallContext } from "./types.js";

/** Summarise a tool result to avoid flooding the log with large payloads */
function summarise(result: unknown): string {
  if (result === null || result === undefined) return "(empty)";
  if (typeof result === "string") {
    return result.length > 200 ? result.slice(0, 200) + "…" : result;
  }
  if (typeof result === "object") {
    const keys = Object.keys(result as Record<string, unknown>);
    return `{${keys.slice(0, 5).join(", ")}${keys.length > 5 ? ", …" : ""}}`;
  }
  return String(result);
}

export function createAfterToolCallHandler(logger: Logger) {
  return function handleAfterToolCall(ctx: AfterToolCallContext): void {
    logger.debug("after_tool_call", {
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      hook: "after_tool_call",
      tool: ctx.toolName,
      latencyMs: ctx.durationMs,
      resultSummary: summarise(ctx.toolResult)
    } as Record<string, unknown>);
  };
}
