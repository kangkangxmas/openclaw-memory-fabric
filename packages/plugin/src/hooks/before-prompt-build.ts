import type { BeforePromptBuildContext } from "./types.js";
import type { SidecarClient } from "../utils/sidecar-client.js";
import type { Logger } from "../utils/logger.js";
import type { MetricsCollector } from "../utils/metrics.js";
import { RecallOrchestrator } from "../orchestrator/recall-orchestrator.js";
import type { MemoryFabricConfig } from "../types/index.js";

export function createBeforePromptBuildHandler(
  client: SidecarClient,
  config: MemoryFabricConfig,
  logger: Logger,
  metrics: MetricsCollector
) {
  const orchestrator = new RecallOrchestrator(client, config, metrics);

  return async function beforePromptBuild(ctx: BeforePromptBuildContext): Promise<void> {
    const latestUser = [...ctx.messages].reverse().find((m) => m.role === "user");
    const start = Date.now();

    await client.carrierInit(ctx.agentId, ctx.projectId).catch(() => {
      /* non-fatal */
    });

    let result;
    try {
      result = await orchestrator.execute({
        agentId: ctx.agentId,
        projectId: ctx.projectId,
        latestMessage: latestUser?.content,
        messageCount: ctx.messages.length
      });
      metrics.recordRecall(Date.now() - start);
      logger.info("recall ok", {
        agentId: ctx.agentId,
        projectId: ctx.projectId,
        hook: "before_prompt_build",
        latencyMs: Date.now() - start,
        sources: result.sources,
        degraded: false
      });
    } catch (err) {
      metrics.recordRecall(Date.now() - start, true);
      metrics.recordDegraded();
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("recall failed — degraded mode", {
        agentId: ctx.agentId,
        hook: "before_prompt_build",
        degraded: true,
        error: msg
      } as Record<string, unknown>);
      ctx.prependContext(
        `<!-- memory-fabric: recall unavailable (${msg}) — proceeding without memory brief -->`
      );
      return;
    }

    const { brief, sources, plan } = result;
    const header = [
      "<!-- memory-fabric:begin -->",
      `<!-- depth=${plan.depth} scope=${plan.scope} sources=${sources.join("|")} -->`,
      ""
    ].join("\n");

    ctx.prependContext(header + brief + "\n<!-- memory-fabric:end -->");
  };
}
