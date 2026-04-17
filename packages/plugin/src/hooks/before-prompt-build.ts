import type { BeforePromptBuildEvent, BeforePromptBuildResult, HookAgentContext } from "./types.js";
import type { SidecarClient } from "../utils/sidecar-client.js";
import type { Logger } from "../utils/logger.js";
import type { MetricsCollector } from "../utils/metrics.js";
import { RecallOrchestrator } from "../orchestrator/recall-orchestrator.js";
import type { MemoryFabricConfig } from "../types/index.js";

/**
 * Extract a plain-text string from a message content value.
 * Handles string, array-of-parts (multi-modal), and unknown shapes.
 */
function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : (part as { text?: string })?.text ?? ""))
      .join(" ")
      .trim();
  }
  return "";
}

export function createBeforePromptBuildHandler(
  client: SidecarClient,
  config: MemoryFabricConfig,
  logger: Logger,
  metrics: MetricsCollector
) {
  const orchestrator = new RecallOrchestrator(client, config, metrics);

  return async function beforePromptBuild(
    event: BeforePromptBuildEvent,
    ctx: HookAgentContext
  ): Promise<BeforePromptBuildResult | void> {
    const agentId = ctx.agentId ?? "unknown";
    const messages = event.messages ?? [];
    const latestUser = [...messages].reverse().find((m) => m.role === "user");
    const start = Date.now();

    await client.carrierInit(agentId).catch(() => {
      /* non-fatal */
    });

    let result;
    try {
      result = await orchestrator.execute({
        agentId,
        latestMessage: latestUser ? extractTextContent(latestUser.content) : undefined,
        messageCount: messages.length
      });
      metrics.recordRecall(Date.now() - start);
      logger.info("recall ok", {
        agentId,
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
        agentId,
        hook: "before_prompt_build",
        degraded: true,
        error: msg
      } as Record<string, unknown>);
      return {
        prependContext: `<!-- memory-fabric: recall unavailable (${msg}) — proceeding without memory brief -->`
      };
    }

    const { brief, sources, plan } = result;
    const header = [
      "<!-- memory-fabric:begin -->",
      `<!-- depth=${plan.depth} scope=${plan.scope} sources=${sources.join("|")} -->`,
      ""
    ].join("\n");

    return { prependContext: header + brief + "\n<!-- memory-fabric:end -->" };
  };
}
