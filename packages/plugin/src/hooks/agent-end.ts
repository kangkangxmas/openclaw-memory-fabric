import path from "node:path";
import type { AgentEndEvent, HookAgentContext, HookMessage } from "./types.js";
import type { SidecarClient } from "../utils/sidecar-client.js";
import type { Logger } from "../utils/logger.js";
import type { MetricsCollector } from "../utils/metrics.js";
import { CommitOrchestrator } from "../orchestrator/commit-orchestrator.js";

/**
 * Normalise a raw SDK message array so every content value is a plain string.
 * Multi-modal messages (content = array-of-parts) are collapsed to their text.
 */
function normaliseMessages(raw: HookMessage[]): HookMessage[] {
  return raw.map((m) => {
    if (typeof m.content === "string") return m;
    if (Array.isArray(m.content)) {
      const text = (m.content as Array<{ text?: string } | string>)
        .map((p) => (typeof p === "string" ? p : p?.text ?? ""))
        .join(" ")
        .trim();
      return { ...m, content: text };
    }
    return { ...m, content: String(m.content ?? "") };
  });
}

export function createAgentEndHandler(
  client: SidecarClient,
  logger: Logger,
  metrics: MetricsCollector
) {
  const orchestrator = new CommitOrchestrator(client, metrics);

  return async function agentEnd(event: AgentEndEvent, ctx: HookAgentContext): Promise<void> {
    const agentId = ctx.agentId ?? "unknown";
    const projectId = ctx.workspaceDir ? path.basename(ctx.workspaceDir) : undefined;
    const messages = normaliseMessages(event.messages ?? []);
    const assistantTurns = messages.filter((m) => m.role === "assistant");
    if (assistantTurns.length === 0) return;

    const start = Date.now();
    try {
      await orchestrator.execute({
        agentId,
        projectId,
        messages,
        toolCalls: event.toolCalls
      });
      metrics.recordCommit(Date.now() - start);
      logger.info("commit ok", {
        agentId,
        hook: "agent_end",
        latencyMs: Date.now() - start
      });
    } catch (err) {
      metrics.recordCommit(Date.now() - start, true);
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("agent_end commit failed — non-fatal", {
        agentId,
        hook: "agent_end",
        error: msg
      } as Record<string, unknown>);
    }
  };
}
