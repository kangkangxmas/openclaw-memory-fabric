import type { SidecarClient, DistillResponse } from "../utils/sidecar-client.js";
import type { HookMessage, HookToolCall } from "../hooks/types.js";
import type { MetricsCollector } from "../utils/metrics.js";

export interface CommitContext {
  agentId: string;
  projectId?: string;
  messages: HookMessage[];
  toolCalls?: HookToolCall[];
}

export interface CommitResult {
  distilled: DistillResponse;
  committed: number;
  carriersMerged: string[];
  selfModelUpdated: boolean;
}

const ENTITY_STOPWORDS = new Set([
  "agent",
  "assistant",
  "config",
  "content",
  "context",
  "data",
  "entities",
  "entity",
  "error",
  "info",
  "none",
  "pattern",
  "patterns",
  "result",
  "state",
  "system",
  "type",
  "types",
  "unresolved",
  "user",
  "记录",
  "模式",
  "策略",
  "方案",
  "问题",
  "建议",
  "注意"
]);

/** Entities that are configuration names, tool names, or technical noise */
const ENTITY_BLACKLIST = new Set([
  "appid",
  "appsecret",
  "secret",
  "fallback",
  "overwrite",
  "backup",
  "setinterval",
  "readjsonl",
  "appendjsonl",
  "openclaw",
  "openclaw-lark",
  "openclaw-weixin",
  "memory-fabric",
  "kimi",
  "openrouter",
  "deepseek",
  "minimax",
  "model",
  "tool",
  "provider",
  "plugin",
  "extension",
  "cli",
  "api",
  "token",
  "gateway",
  "skill"
]);

/**
 * Quality-filter carrier items (facts, decisions).
 * Rejects: code snippets, short fragments, pipe-char noise, backtick-heavy.
 */
function isCleanCarrierItem(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 15) return false;
  // Code traces: contains backtick pairs, function signatures, pipe operators
  if (/`[^`]+`/.test(trimmed)) return false;
  if (/~\s*\(.*\)/.test(trimmed)) return false; // ~(1h) style patterns
  // Only reject pipe-char noise patterns (table rows, pipe-heavy payloads)
  if (/^.{0,2}\|/.test(trimmed)) return false; // starts with pipe within 2 chars
  if (/\|.{0,2}$/.test(trimmed)) return false; // ends with pipe within 2 chars
  if (/(?:^|[|])\s*[~]\s*\(/.test(trimmed)) return false; // | ~(1h) | patterns
  // Count pipe chars; >3 in a short string is noise
  const pipeCount = (trimmed.match(/\|/g) ?? []).length;
  if (pipeCount > 3 && trimmed.length < 60) return false;
  if (/(?:import\s+|function\s+|export\s+|const\s+\w+\s*=|interface\s+\w+\s*{)/i.test(trimmed)) return false;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return false; // JSON objects
  return true;
}

function isCleanEntity(value: string): boolean {
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  if (normalized.length < 2 || normalized.length > 40) return false;
  if (ENTITY_STOPWORDS.has(lower)) return false;
  if (ENTITY_BLACKLIST.has(lower)) return false;
  if (/^(no memories found|auto-distilled from session)$/i.test(normalized)) return false;
  if (/[`#*<>[\]{}]/.test(normalized)) return false;
  if (/(你应该|这些时机|请使用|need to|should use)/i.test(normalized)) return false;
  return true;
}

export class CommitOrchestrator {
  constructor(
    private readonly client: SidecarClient,
    private readonly metrics?: MetricsCollector
  ) {}

  async execute(ctx: CommitContext): Promise<CommitResult> {
    // Step 1: Distill the conversation
    const rawDistilled = await this.client.distill({
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      messages: ctx.messages
    });
    const distilled: DistillResponse = {
      ...rawDistilled,
      entities: rawDistilled.entities.filter((entity) => isCleanEntity(entity))
    };

    // Build session summary for experience distillation (P0-1)
    const sessionSummary = buildSessionSummary(ctx);

    const toolCallNames = (ctx.toolCalls ?? []).map((t) => ({ name: t.name }));
    const turnCount = ctx.messages.filter((m) => m.role === "assistant").length;

    // Step 2: Commit to OpenViking
    const commitResp = await this.client.commit({
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      facts: distilled.facts,
      decisions: distilled.decisions,
      entities: distilled.entities,
      patterns: distilled.patterns,
      unresolved: distilled.unresolved,
      visibility: "private",
      // P0-1: pass session metadata for sidecar experience distillation
      toolCalls: toolCallNames,
      turnCount,
      sessionSummary
    });

    // Step 3: Update carrier files
    const patches = this.buildCarrierPatches(ctx, distilled);
    let carriersMerged: string[] = [];
    if (patches.length > 0) {
      const mergeResp = await this.client.carrierMerge({
        agentId: ctx.agentId,
        projectId: ctx.projectId,
        patches
      });
      carriersMerged = mergeResp.merged;
      if (mergeResp.skipped.length > 0) {
        this.metrics?.recordCarrierMergeConflicts(mergeResp.skipped.length);
      }
    }

    // Step 4: Update self-model (conflict-preserve: only overwrite when stale)
    let selfModelUpdated = false;
    if (distilled.facts.length > 0 || distilled.decisions.length > 0) {
      const selfModelContent = this.buildSelfModel(ctx, distilled);
      // Only update if the goal is reasonable (not code/payload noise)
      const hasReasonableGoal =
        selfModelContent.includes("## Current Goal") &&
        !selfModelContent.includes("## Current Goal\nNot specified");
      if (hasReasonableGoal) {
        try {
          await this.client.carrierMerge({
            agentId: ctx.agentId,
            projectId: ctx.projectId,
            patches: [{ filename: "self-model.md", content: selfModelContent }]
          });
          selfModelUpdated = true;
        } catch {
          // Non-fatal
        }
      }
    }

    return {
      distilled,
      committed: commitResp.committed,
      carriersMerged,
      selfModelUpdated
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildCarrierPatches(ctx: CommitContext, d: DistillResponse) {
    const patches: Array<{ filename: string; content: string }> = [];
    const now = new Date().toISOString().slice(0, 10);

    // Quality-filter facts: skip code snippets, short fragments, and noise
    const cleanFacts = d.facts.filter(isCleanCarrierItem);

    // Quality-filter decisions: skip code snippets and noise
    const cleanDecisions = d.decisions.filter(isCleanCarrierItem);

    // Append to execution-journal
    const journalEntry = this.buildJournalEntry(
      ctx,
      { ...d, facts: cleanFacts, decisions: cleanDecisions },
      now
    );
    patches.push({ filename: "execution-journal.md", content: journalEntry });

    // Accumulate decisions (only quality-filtered ones)
    if (cleanDecisions.length > 0 && ctx.projectId) {
      const decisionEntry = cleanDecisions
        .map(
          (dec) =>
            `## ${now}: ${dec.slice(0, 60)}\n**Context:** Auto-distilled from session\n**Decision:** ${dec}\n**Rationale:** See execution journal\n`
        )
        .join("\n");
      patches.push({ filename: "decision-log.md", content: decisionEntry });
    }

    // Dedup-append entities to glossary
    if (d.entities.length > 0 && ctx.projectId) {
      const entityLines = d.entities.map((e) => `- **${e}**: (auto-extracted)`).join("\n");
      patches.push({ filename: "entities-glossary.md", content: entityLines });
    }

    // Preserve open questions
    if (d.unresolved.length > 0 && ctx.projectId) {
      const openLines = d.unresolved.join("\n");
      patches.push({ filename: "open-questions.md", content: openLines });
    }

    return patches;
  }

  private buildJournalEntry(ctx: CommitContext, d: DistillResponse, _date: string): string {
    const ts = new Date().toISOString();
    const lines = [
      `## ${ts}`,
      `**Agent:** ${ctx.agentId}${ctx.projectId ? ` | **Project:** ${ctx.projectId}` : ""}`,
      ""
    ];

    if (d.facts.length > 0) {
      lines.push("**Facts learned:**");
      d.facts.forEach((f) => lines.push(`- ${f}`));
      lines.push("");
    }
    if (d.decisions.length > 0) {
      lines.push("**Decisions made:**");
      d.decisions.forEach((dec) => lines.push(`- ${dec}`));
      lines.push("");
    }
    if (d.unresolved.length > 0) {
      lines.push("**Open questions:**");
      d.unresolved.forEach((u) => lines.push(`- ${u}`));
      lines.push("");
    }

    // Tool call summary
    if (ctx.toolCalls && ctx.toolCalls.length > 0) {
      lines.push(`**Tools used:** ${ctx.toolCalls.map((t) => t.name).join(", ")}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  private buildSelfModel(ctx: CommitContext, d: DistillResponse): string {
    const ts = new Date().toISOString();
    const rawGoal =
      ctx.messages.filter((m) => m.role === "user").slice(-1)[0]?.content ?? "Not specified";
    const goal =
      rawGoal
        .replace(/<!-- memory-fabric:begin -->[\s\S]*?<!-- memory-fabric:end -->/g, "")
        .trim();

    // Reasonableness check: reject goals that look like code, cross-agent payloads,
    // or session metadata rather than actual user intent.
    const isReasonableGoal =
      goal.length > 20 &&
      !/(?:import\s+|function\s+|export\s+|require\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=)/i.test(goal) &&
      !/(?:\|\s*[~]|\|\s*\d+[a-z]*\s*\|)/.test(goal) && // pipe-tilde or pipe-number-text-pipe
      !/```/.test(goal) &&
      !/`[^`]+`/.test(goal) &&
      !/Subagent Context/i.test(goal) &&
      !/^[Tt]ask:?\s*$/.test(goal);

    const safeGoal = isReasonableGoal ? goal.slice(0, 120) : "Not specified";

    return [
      `# Self Model`,
      ``,
      `## Current Goal`,
      safeGoal,
      ``,
      `## Understood`,
      ...d.facts.slice(0, 5).map((f) => `- ${f}`),
      ``,
      `## Uncertain`,
      ...d.unresolved.slice(0, 3).map((u) => `- ${u}`),
      ``,
      `## Missing Evidence`,
      d.unresolved.length === 0 ? "- None identified in this session" : "",
      ``,
      `## Preferred Next Actions`,
      ...d.publishCandidates.slice(0, 2).map((p) => `- Resolve: ${p}`),
      ``,
      `## Confidence`,
      d.decisions.length > 0 ? "medium" : "low",
      ``,
      `## Updated At`,
      ts
    ]
      .join("\n")
      .trimEnd();
  }
}

// ---------------------------------------------------------------------------
// P0-1: Build a concise session summary from messages for experience distillation
// ---------------------------------------------------------------------------

function buildSessionSummary(ctx: CommitContext): string {
  const userMessages = ctx.messages.filter((m) => m.role === "user");
  const lastUserMsg = userMessages
    .slice(-1)[0]?.content
    ?.replace(/<!-- memory-fabric:begin -->[\s\S]*?<!-- memory-fabric:end -->/g, "")
    .trim()
    .slice(0, 300) ?? "";

  const assistantCount = ctx.messages.filter((m) => m.role === "assistant").length;
  const toolNames = [...new Set((ctx.toolCalls ?? []).map((t) => t.name))].slice(0, 10);

  const parts: string[] = [`Turns: ${assistantCount}`];
  if (toolNames.length > 0) parts.push(`Tools: ${toolNames.join(", ")}`);
  if (lastUserMsg) parts.push(`Goal: ${lastUserMsg}`);

  return parts.join(" | ");
}
