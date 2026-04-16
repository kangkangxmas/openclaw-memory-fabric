import type { AgentEndContext } from "./types.js";
import type { SidecarClient } from "../utils/sidecar-client.js";
import type { Logger } from "../utils/logger.js";
import type { MetricsCollector } from "../utils/metrics.js";
import { CommitOrchestrator } from "../orchestrator/commit-orchestrator.js";

export function createAgentEndHandler(
  client: SidecarClient,
  logger: Logger,
  metrics: MetricsCollector
) {
  const orchestrator = new CommitOrchestrator(client, metrics);

  return async function agentEnd(ctx: AgentEndContext): Promise<void> {
    const assistantTurns = ctx.messages.filter((m) => m.role === "assistant");
    if (assistantTurns.length === 0) return;

    const start = Date.now();
    try {
      await orchestrator.execute({
        agentId: ctx.agentId,
        projectId: ctx.projectId,
        messages: ctx.messages,
        toolCalls: ctx.toolCalls
      });
      metrics.recordCommit(Date.now() - start);
      logger.info("commit ok", {
        agentId: ctx.agentId,
        projectId: ctx.projectId,
        hook: "agent_end",
        latencyMs: Date.now() - start
      });
    } catch (err) {
      metrics.recordCommit(Date.now() - start, true);
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("agent_end commit failed — non-fatal", {
        agentId: ctx.agentId,
        hook: "agent_end",
        error: msg
      } as Record<string, unknown>);
    }
  };
}
