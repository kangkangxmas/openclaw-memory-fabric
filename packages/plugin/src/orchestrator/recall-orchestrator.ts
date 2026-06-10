import type { SidecarClient } from "../utils/sidecar-client.js";
import type { MemoryFabricConfig, RecallDepth, MemoryScope, TaskType } from "../types/index.js";
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
// Task-type keyword detection
// ---------------------------------------------------------------------------

type MarkerFn = (msg: string) => boolean;

function v2RecallEnabled(): boolean {
  return process.env.MEMORY_FABRIC_V2_MODE === "v2-recall" || process.env.MEMORY_FABRIC_V2_MODE === "v2-write";
}

function preview(text: string, limit = 240): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

const TASK_TYPE_MARKERS: Array<[TaskType, MarkerFn[]]> = [
  ["code_review", [
    (m) => /\breview\b|PR\b|pull\s*request|diff\b|approve|LGTM/i.test(m),
    (m) => /代码审查|评审|code\s*quality|review\s*comment/i.test(m),
  ]],
  ["debug", [
    (m) => /\bbug\b|\berror\b|stack\s*trace|crash|exception/i.test(m),
    (m) => /报错|异常|排查|排障|debug|troubleshoot|故障/i.test(m),
  ]],
  ["architecture", [
    (m) => /architect|system\s*design|dependency\s*graph|模块设计/i.test(m),
    (m) => /架构|设计方案|组件|module\s*design|high.level\s*design/i.test(m),
  ]],
  ["devops", [
    (m) => /deploy|CI\/CD|pipeline|container|docker|kubernetes|terraform/i.test(m),
    (m) => /部署|运维|发布|上线|k8s|helm/i.test(m),
  ]],
  ["qa", [
    (m) => /\btest\b|coverage|assertion|regression|benchmark/i.test(m),
    (m) => /测试|覆盖率|断言|回归|用例|test\s*case/i.test(m),
  ]],
  ["documentation", [
    (m) => /\bdoc\b|README|API\s*reference|changelog|specification/i.test(m),
    (m) => /文档|说明|注释|comment|写文档|补充文档/i.test(m),
  ]],
  ["refactor", [
    (m) => /refactor|rename|extract|simplify|clean\s*up/i.test(m),
    (m) => /重构|提取|简化|优化代码|整理/i.test(m),
  ]],
];

function detectTaskType(ctx: RecallContext): TaskType {
  const msg = ctx.latestMessage ?? "";
  if (!msg) return "general";

  let bestType: TaskType = "general";
  let bestScore = 0;

  for (const [taskType, markers] of TASK_TYPE_MARKERS) {
    const score = markers.filter((fn) => fn(msg)).length;
    if (score > bestScore) {
      bestScore = score;
      bestType = taskType;
    }
  }

  return bestScore >= 1 ? bestType : "general";
}

// ---------------------------------------------------------------------------
// Extra carrier files per task type
// ---------------------------------------------------------------------------

const TASK_TYPE_EXTRA_CARRIERS = new Map<TaskType, string[]>([
  ["code_review", ["decision-log.md", "playbooks.md"]],
  ["debug", ["open-questions.md", "entities-glossary.md"]],
  ["architecture", ["decision-log.md", "entities-glossary.md"]],
  ["devops", ["playbooks.md"]],
  ["qa", ["playbooks.md", "open-questions.md"]],
  ["documentation", ["entities-glossary.md"]],
  ["refactor", ["entities-glossary.md", "decision-log.md"]],
]);

// ---------------------------------------------------------------------------
// RecallOrchestrator
// ---------------------------------------------------------------------------

export interface RecallPlan {
  depth: RecallDepth;
  scope: MemoryScope;
  query: string;
  needsStructuralBrief: boolean;
  taskType: TaskType;
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
      needsStructuralBrief: depth !== "l0" && !!ctx.projectId,
      taskType: detectTaskType(ctx)
    };
  }

  /**
   * Execute recall: call sidecar /recall and optionally enrich with carrier
   * content. Returns a MemoryBrief string ready for prompt injection.
   */
  async execute(ctx: RecallContext): Promise<MemoryBriefResult> {
    const recallPlan = this.plan(ctx);

    if (v2RecallEnabled() && recallPlan.query.trim().length > 0) {
      try {
        const v2 = await this.client.recallPlan({
          agentId: ctx.agentId,
          projectId: ctx.projectId,
          scope: recallPlan.scope === "auto" ? undefined : recallPlan.scope,
          query: recallPlan.query,
          limit: recallPlan.depth === "l2" ? 8 : 5,
        });
        if (v2.cards.length > 0) {
          const evidence = [...new Set(v2.cards.flatMap((card) => card.evidence))];
          let legacyForAudit:
            | {
                sourceCount?: number;
                budgetUsed?: number;
                memoryBriefChars?: number;
                sources?: string[];
                memoryBriefPreview?: string;
              }
            | undefined;
          try {
            const legacy = await this.client.recall({
              agentId: ctx.agentId,
              projectId: ctx.projectId,
              scope: recallPlan.scope,
              depth: recallPlan.depth,
              query: recallPlan.query,
              taskType: recallPlan.taskType
            });
            legacyForAudit = {
              sourceCount: legacy.sources.length,
              budgetUsed: legacy.budgetUsed,
              memoryBriefChars: legacy.memoryBrief.length,
              sources: legacy.sources.slice(0, 12),
              memoryBriefPreview: preview(legacy.memoryBrief)
            };
          } catch {
            legacyForAudit = undefined;
          }
          const auditClient = this.client as unknown as {
            recallAudit?: (req: {
              agentId?: string;
              projectId?: string;
              query: string;
              mode: string;
              legacy?: {
                sourceCount?: number;
                budgetUsed?: number;
                memoryBriefChars?: number;
                sources?: string[];
                memoryBriefPreview?: string;
              };
              v2?: {
                intent?: string;
                cardCount?: number;
                evidenceCount?: number;
                renderedChars?: number;
                executionTimeMs?: number;
                memoryIds?: string[];
                evidenceRefs?: string[];
                cardPreviews?: string[];
              };
            }) => Promise<unknown>;
          };
          void auditClient.recallAudit?.({
            agentId: ctx.agentId,
            projectId: ctx.projectId,
            query: recallPlan.query,
            mode: process.env.MEMORY_FABRIC_V2_MODE ?? "off",
            legacy: legacyForAudit,
            v2: {
              intent: v2.plan.intent,
              cardCount: v2.cards.length,
              evidenceCount: evidence.length,
              renderedChars: v2.rendered.length,
              executionTimeMs: v2.executionTimeMs,
              memoryIds: v2.cards.map((card) => card.memoryId).slice(0, 12),
              evidenceRefs: evidence.slice(0, 24),
              cardPreviews: v2.cards.map((card) => preview(card.content)).slice(0, 8)
            }
          }).catch(() => undefined);
          return {
            brief: v2.rendered,
            sources: [`v2:recall-plan:${v2.plan.intent}`, ...evidence.map((ref) => `event:${ref}`)],
            budgetUsed: Math.ceil(v2.rendered.length / 4),
            plan: recallPlan
          };
        }
      } catch {
        // v2 recall is a gray-mode optimization. Fall back to legacy recall.
      }
    }

    // Primary recall from OpenViking
    const recallResp = await this.client.recall({
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      scope: recallPlan.scope,
      depth: recallPlan.depth,
      query: recallPlan.query,
      taskType: recallPlan.taskType
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
        const baseCarriers =
          recallPlan.depth === "l1"
            ? ["self-model.md", "project-model.md"]
            : ["self-model.md", "project-model.md", "decision-log.md", "entities-glossary.md"];
        const extraCarriers = TASK_TYPE_EXTRA_CARRIERS.get(recallPlan.taskType) ?? [];
        const carrierFiles = [...new Set([...baseCarriers, ...extraCarriers])];

        const carrierResp = await this.client.carrierRead({
          agentId: ctx.agentId,
          projectId: ctx.projectId,
          files: carrierFiles
        });

        const populated = carrierResp.carriers.filter((c) => c.exists);
        if (populated.length > 0) {
          // Budget per carrier scales with depth: L1 gets 2 files, L2 gets 4
          const perCarrierBudget = recallPlan.depth === "l2" ? 1500 : 800;
          enrichment = populated
            .map((c) => `### Carrier: ${c.filename}\n${c.content.slice(0, perCarrierBudget)}`)
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
