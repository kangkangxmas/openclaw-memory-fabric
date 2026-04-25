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

export class CommitOrchestrator {
  constructor(
    private readonly client: SidecarClient,
    private readonly metrics?: MetricsCollector
  ) {}

  async execute(ctx: CommitContext): Promise<CommitResult> {
    // Step 1: Distill the conversation
    const distilled = await this.client.distill({
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      messages: ctx.messages
    });

    // Step 2: Commit to OpenViking
    const commitResp = await this.client.commit({
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      facts: distilled.facts,
      decisions: distilled.decisions,
      entities: distilled.entities,
      patterns: distilled.patterns,
      unresolved: distilled.unresolved,
      visibility: "private"
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

    // Step 4: Update self-model
    let selfModelUpdated = false;
    if (distilled.facts.length > 0 || distilled.decisions.length > 0) {
      const selfModelContent = this.buildSelfModel(ctx, distilled);
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

    // Append to execution-journal
    const journalEntry = this.buildJournalEntry(ctx, d, now);
    patches.push({ filename: "execution-journal.md", content: journalEntry });

    // Accumulate decisions
    if (d.decisions.length > 0 && ctx.projectId) {
      const decisionEntry = d.decisions
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
        .trim()
        .slice(0, 120) || "Not specified";

    return [
      `# Self Model`,
      ``,
      `## Current Goal`,
      goal,
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
