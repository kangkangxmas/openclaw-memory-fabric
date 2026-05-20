import type { Logger } from "../utils/logger.js";
import type { AfterToolCallEvent, HookAgentContext } from "./types.js";

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
  return String(result as number | boolean | bigint | symbol);
}

export function createAfterToolCallHandler(logger: Logger) {
  return function handleAfterToolCall(event: AfterToolCallEvent, ctx: HookAgentContext): void {
    logger.debug("after_tool_call", {
      agentId: ctx.agentId,
      hook: "after_tool_call",
      tool: event.toolName,
      latencyMs: event.durationMs,
      resultSummary: summarise(event.result)
    } as Record<string, unknown>);
  };
}
