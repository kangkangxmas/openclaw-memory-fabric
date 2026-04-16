import type { SidecarClient } from "../utils/sidecar-client.js";
import type { MemoryFabricConfig, RecallDepth, MemoryScope } from "../types/index.js";
import type { MetricsCollector } from "../utils/metrics.js";

// ---------------------------------------------------------------------------
// Context type — provided by the OpenClaw hook system
// ---------------------------------------------------------------------------

export interface RecallContext {
  agentId: string;
  projectId?: string;
  /** Latest user message text (used for complexity/query heuristics) */
  latestMessage?: string;
  /** Number of messages in the current session (proxy for conversation depth) */
  messageCount?: number;
}

// ---------------------------------------------------------------------------
// Complexity heuristics
// ---------------------------------------------------------------------------

const COMPLEX_MARKERS = [
  // length signal
  (msg: string) => msg.length > 200,
  // cross-module signals
  (msg: string) => /架构|重构|跨模块|设计|方案|全局|系统/.test(msg),
  (msg: string) => /architect|refactor|cross.module|design|system|global/i.test(msg),
  // question density
  (msg: string) => (msg.match(/[?？]/g) ?? []).length >= 2
];

function detectDepth(ctx: RecallContext): RecallDepth {
  const msg = ctx.latestMessage ?? "";
  const score = COMPLEX_MARKERS.filter((fn) => fn(msg)).length;
  if (score >= 2) return "l2";
  if (score >= 1 || (ctx.messageCount ?? 0) > 10) return "l1";
  return "l0";
}

function detectScope(ctx: RecallContext, cfg: MemoryFabricConfig): MemoryScope {
  if (ctx.projectId) return cfg.defaultScope === "private" ? "private" : "project";
  return "private";
}

// ---------------------------------------------------------------------------
// RecallOrchestrator
// ---------------------------------------------------------------------------

export interface RecallPlan {
  depth: RecallDepth;
  scope: MemoryScope;
  query: string;
  needsStructuralBrief: boolean;
}

export interface MemoryBriefResult {
  brief: string;
  sources: string[];
  budgetUsed: number;
  plan: RecallPlan;
}

export class RecallOrchestrator {
  constructor(
    private readonly client: SidecarClient,
    private readonly config: MemoryFabricConfig,
    private readonly metrics?: MetricsCollector
  ) {}

  /** Build a recall plan from context heuristics */
  plan(ctx: RecallContext): RecallPlan {
    const depth = detectDepth(ctx);
    return {
      depth,
      scope: detectScope(ctx, this.config),
      query: ctx.latestMessage ?? "",
      // Structural brief when depth ≥ l1 and a project is active
      needsStructuralBrief: depth !== "l0" && !!ctx.projectId
    };
  }

  /**
   * Execute recall: call sidecar /recall and optionally enrich with carrier
   * content. Returns a MemoryBrief string ready for prompt injection.
   */
  async execute(ctx: RecallContext): Promise<MemoryBriefResult> {
    const recallPlan = this.plan(ctx);

    // Primary recall from OpenViking
    const recallResp = await this.client.recall({
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      scope: recallPlan.scope,
      depth: recallPlan.depth,
      query: recallPlan.query
    });

    const sources = [...recallResp.sources];
    let structuralSection = "";
    let enrichment = "";

    // Structural Brief for complex tasks (L1/L2 with a project)
    if (recallPlan.needsStructuralBrief && ctx.projectId) {
      const graphStart = Date.now();
      try {
        const brief = await this.client.graphBrief(ctx.projectId);
        this.metrics?.recordGraphQuery(Date.now() - graphStart);
        if (brief.freshness !== "missing") {
          structuralSection = [
            "### Structural Brief",
            `Freshness: ${brief.freshness} | Core entities: ${brief.coreNodes.slice(0, 5).join(", ")}`,
            brief.communities.length > 0
              ? `Clusters: ${brief.communities.slice(0, 3).join(" | ")}`
              : "",
            brief.summary.slice(0, 400)
          ]
            .filter(Boolean)
            .join("\n");
          sources.push(`graphify:brief:${brief.freshness}`);
        }
      } catch {
        // Graphify unavailable — skip without blocking
      }
    }

    // For L1/L2: also inject key carrier files
    if (recallPlan.depth !== "l0" && ctx.projectId) {
      try {
        const carrierFiles =
          recallPlan.depth === "l1"
            ? ["self-model.md", "project-model.md"]
            : ["self-model.md", "project-model.md", "decision-log.md", "entities-glossary.md"];

        const carrierResp = await this.client.carrierRead({
          agentId: ctx.agentId,
          projectId: ctx.projectId,
          files: carrierFiles
        });

        const populated = carrierResp.carriers.filter((c) => c.exists);
        if (populated.length > 0) {
          enrichment = populated
            .map((c) => `### Carrier: ${c.filename}\n${c.content.slice(0, 600)}`)
            .join("\n\n");
          sources.push("carrier:" + populated.map((c) => c.filename).join(","));
        }
      } catch {
        // Carrier read failure is non-fatal — log and continue with core brief only
      }
    }

    const combined = [structuralSection, recallResp.memoryBrief, enrichment]
      .filter(Boolean)
      .join("\n\n---\n\n");

    return {
      brief: combined,
      sources,
      budgetUsed: recallResp.budgetUsed,
      plan: recallPlan
    };
  }
}
