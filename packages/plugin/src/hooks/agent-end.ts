import type { AgentEndEvent, HookAgentContext } from "./types.js";
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

  return async function agentEnd(event: AgentEndEvent, ctx: HookAgentContext): Promise<void> {
    const agentId = ctx.agentId ?? "unknown";
    const messages = event.messages ?? [];
    const assistantTurns = messages.filter((m) => m.role === "assistant");
    if (assistantTurns.length === 0) return;

    const start = Date.now();
    try {
      await orchestrator.execute({
        agentId,
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
