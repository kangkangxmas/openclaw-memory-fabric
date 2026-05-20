/**
 * ExperienceService — post-commit experience extraction and carrier refresh.
 *
 * P0-1: After a session commit, if toolCalls >= 3 or turnCount >= 5, fire an
 *   async LLM call to extract structured experience (task type, patterns,
 *   lessons, outcome) and persist to ExperienceStore.
 *
 * P0-3: After storing a new experience, check if the agent's self-model.md is
 *   stale (>24h since last update). If so, refresh its "Updated At" timestamp.
 *
 * All operations are fire-and-forget — they never block the commit response.
 */

import type { CarrierRepository, CarrierReadResult } from "./carrier-service.js";
import type { DistillLLMConfig } from "./distill-service.js";
import type { PatternService } from "./pattern-service.js";
import type { ScoringService } from "./scoring-service.js";
import { ExperienceStore } from "../stores/experience-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExperienceServiceConfig {
  /** Optional: EXPERIENCE_LLM_* env config. Falls back to DISTILL_LLM_* */
  llmCfg?: DistillLLMConfig;
}

/** Minimal session context passed from the commit route handler. */
export interface PostCommitContext {
  agentId: string;
  projectId?: string;
  toolCalls: Array<{ name: string }>;
  toolCount: number;
  turnCount: number;
  /** Straight-through distill output from the earlier /distill call */
  patterns?: string[];
  lessons?: string[];
  decisions?: string[];
  /** Estimated token cost for this session */
  tokenCost: number;
  /** Short session summary pre-built by the caller (plugin side) */
  sessionSummary?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum tool calls to trigger experience distillation */
const MIN_TOOL_CALLS = 3;
/** Minimum assistant turns to trigger experience distillation */
const MIN_TURNS = 5;
/** Rate-limit: skip if last distill was fewer than N ms ago */
const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes
/** self-model.md stale threshold */
const CARRIER_STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// LLM prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an experience extraction assistant. Analyze the session below and extract structured information.

Return ONLY valid JSON — no explanation, no markdown fences:

{
  "taskType": "<one concise label e.g. code_review|debug|architecture|devops|qa|documentation|refactor|other>",
  "success": <true|false>,
  "patterns": ["<specific reusable strategy that worked, max 120 chars>"],
  "lessons": ["<lesson learned or pitfall avoided, max 120 chars>"],
  "outcome": "<one-sentence summary, max 200 chars>"
}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface LLMResponse {
  choices: Array<{ message: { content: string } }>;
}

async function callLLM(
  cfg: DistillLLMConfig,
  system: string,
  user: string
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15_000);

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        max_tokens: cfg.maxTokens ?? 400,
        temperature: 0.2
      }),
      signal: controller.signal
    });

    if (!res.ok) return null;

    const data = (await res.json()) as LLMResponse;
    return data?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extract "Updated At" timestamp from self-model carrier content.
 * Expects: `## Updated At\n<!-- ISO timestamp -->`
 */
function extractCarrierTimestamp(content: string): number | null {
  const match = content.match(
    /##\s*Updated\s*At\s*\n\s*<!--\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))/
  );
  if (!match) return null;
  const ts = new Date(match[1]).getTime();
  return Number.isNaN(ts) ? null : ts;
}

/**
 * Update the "Updated At" timestamp in self-model.md.
 * We replace the old `<!-- ISO timestamp -->` comment after the heading,
 * or fall back to appending a fresh block.
 */
function setCarrierTimestamp(content: string, iso: string): string {
  const updated = `## Updated At\n<!-- ${iso} -->`;
  const existing = content.match(
    /##\s*Updated\s*At\s*\n\s*<!--\s*.+?\s*-->/
  );
  if (existing) {
    return content.replace(existing[0], updated);
  }
  // Append at end if heading not found
  return content.trimEnd() + "\n\n" + updated + "\n";
}

// ---------------------------------------------------------------------------
// ExperienceService
// ---------------------------------------------------------------------------

export class ExperienceService {
  private readonly lastDistilled = new Map<string, number>(); // agentId → timestamp

  constructor(
    private readonly store: ExperienceStore,
    private readonly carriers: CarrierRepository,
    private readonly config?: ExperienceServiceConfig,
    private readonly patterns?: PatternService,
    private readonly scoring?: ScoringService
  ) {}

  /** Resolve the effective LLM config with fallback chain. */
  private resolveLLMConfig(): DistillLLMConfig | null {
    if (this.config?.llmCfg) return this.config.llmCfg;

    const baseUrl = process.env.EXPERIENCE_LLM_BASE_URL
      ?? process.env.DISTILL_LLM_BASE_URL;
    const model = process.env.EXPERIENCE_LLM_MODEL
      ?? process.env.DISTILL_LLM_MODEL;
    const apiKey = process.env.EXPERIENCE_LLM_API_KEY
      ?? process.env.DISTILL_LLM_API_KEY
      ?? "none";

    if (!baseUrl || !model) return null;
    return { baseUrl, apiKey, model };
  }

  // -------------------------------------------------------------------------
  // Public: fire-and-forget after session commit
  // -------------------------------------------------------------------------

  /** Assess session, extract experience, persist. Always async, never throws. */
  async postCommitDistill(ctx: PostCommitContext): Promise<void> {
    try {
      // 1. Guard: only process sessions with sufficient activity
      if (ctx.toolCount < MIN_TOOL_CALLS && ctx.turnCount < MIN_TURNS) return;

      // 2. Rate limit: skip if last run was < 5 minutes ago for this agent
      const lastTs = this.lastDistilled.get(ctx.agentId) ?? 0;
      if (Date.now() - lastTs < RATE_LIMIT_MS) return;
      this.lastDistilled.set(ctx.agentId, Date.now());

      // 3. LLM extraction (fire-and-forget, non-blocking)
      const llmCfg = this.resolveLLMConfig();
      if (llmCfg) {
        await this.extractAndStore(ctx, llmCfg);
      } else {
        // No LLM configured: use heuristic patterns directly from distill output
        await this.storeHeuristicOnly(ctx);
      }

      // 4. P0-3: Check carrier freshness after storing
      await this.refreshCarrierIfStale(ctx);

      // 5. P1-1: Trigger pattern detection every 10th experience entry
      if (this.patterns) {
        const total = await this.store.totalCount(ctx.agentId);
        if (total > 0 && total % 10 === 0) {
          void this.patterns.detectPatterns(ctx.agentId);
        }
      }
    } catch {
      // Swallow all errors — experience distillation must never block commit
    }
  }

  // -------------------------------------------------------------------------
  // Private: LLM extraction
  // -------------------------------------------------------------------------

  private async extractAndStore(
    ctx: PostCommitContext,
    llmCfg: DistillLLMConfig
  ): Promise<void> {
    const toolSummary = ctx.toolCalls
      .filter((t) => t.name !== "read" && t.name !== "think") // filter noise
      .map((t) => t.name)
      .slice(0, 15);

    const userMessage = [
      `Task context: ${ctx.projectId ?? "no project"}`,
      `Tools used: ${toolSummary.join(", ")}`,
      `Tool calls: ${ctx.toolCount}, Turns: ${ctx.turnCount}`,
      ctx.sessionSummary ? `Summary: ${ctx.sessionSummary}` : "",
      ctx.patterns?.length
        ? `Patterns detected: ${ctx.patterns.join("; ")}`
        : "",
      ctx.decisions?.length
        ? `Decisions: ${ctx.decisions.join("; ")}`
        : ""
    ]
      .filter(Boolean)
      .join("\n");

    const raw = await callLLM(llmCfg, SYSTEM_PROMPT, userMessage);
    if (!raw) {
      // LLM failed — fall back to heuristic
      await this.storeHeuristicOnly(ctx);
      return;
    }

    // Strip any markdown fences the LLM may wrap around JSON
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");

    let parsed: {
      taskType?: string;
      success?: boolean;
      patterns?: string[];
      lessons?: string[];
      outcome?: string;
    };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      await this.storeHeuristicOnly(ctx);
      return;
    }

    // P2-2: Score the experience
    const scoreResult = this.scoring
      ? await this.scoring.score({
          success: parsed.success ?? true,
          toolCount: ctx.toolCount,
          turnCount: ctx.turnCount,
          outcome: parsed.outcome,
          patterns: parsed.patterns
        })
      : undefined;

    await this.store.append({
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      timestamp: Date.now(),
      taskType: parsed.taskType ?? "other",
      toolsUsed: toolSummary,
      toolCount: ctx.toolCount,
      turnCount: ctx.turnCount,
      success: parsed.success ?? true,
      patterns: (parsed.patterns ?? []).slice(0, 3),
      lessons: (parsed.lessons ?? ctx.lessons ?? []).slice(0, 2),
      tokenCost: ctx.tokenCost,
      outcome: parsed.outcome ?? ctx.sessionSummary ?? "Session completed",
      selfScore: scoreResult?.selfScore,
      scoreRationale: scoreResult?.scoreRationale
    });
  }

  /** Fallback: store patterns/lessons from distill output without LLM call. */
  private async storeHeuristicOnly(ctx: PostCommitContext): Promise<void> {
    const toolSummary = ctx.toolCalls
      .filter((t) => t.name !== "read" && t.name !== "think")
      .map((t) => t.name)
      .slice(0, 15);

    // P2-2: Score the experience (heuristic fallback)
    const scoreResult = this.scoring
      ? await this.scoring.score({
          success: true,
          toolCount: ctx.toolCount,
          turnCount: ctx.turnCount,
          outcome: ctx.sessionSummary,
          patterns: ctx.patterns
        })
      : undefined;

    await this.store.append({
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      timestamp: Date.now(),
      taskType: "other",
      toolsUsed: toolSummary,
      toolCount: ctx.toolCount,
      turnCount: ctx.turnCount,
      success: true,
      patterns: (ctx.patterns ?? []).slice(0, 3),
      lessons: (ctx.lessons ?? []).slice(0, 2),
      tokenCost: ctx.tokenCost,
      outcome: ctx.sessionSummary ?? "Session committed",
      selfScore: scoreResult?.selfScore,
      scoreRationale: scoreResult?.scoreRationale
    });
  }

  // -------------------------------------------------------------------------
  // P0-3: Carrier auto-refresh
  // -------------------------------------------------------------------------

  /**
   * Check if self-model.md is stale (>24h since last update).
   * If stale, update the "Updated At" timestamp and merge new learnings.
   */
  private async refreshCarrierIfStale(ctx: PostCommitContext): Promise<void> {
    // Only proceed if we have actual patterns/lessons to work with
    if (!ctx.patterns?.length && !ctx.lessons?.length) return;

    const [selfModel] = await this.carriers.read({
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      files: ["self-model.md"]
    });

    if (!selfModel) return;

    const lastUpdate = extractCarrierTimestamp(selfModel.content);
    const isStale = lastUpdate === null || Date.now() - lastUpdate >= CARRIER_STALE_MS;
    
    // Always merge learnings; update timestamp if stale
    let newContent = this.mergeLearningsIntoSelfModel(selfModel.content, ctx);
    if (isStale) {
      newContent = setCarrierTimestamp(newContent, new Date().toISOString());
    }

    await this.carriers.merge({
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      patches: [
        {
          filename: "self-model.md",
          content: newContent
        }
      ]
    });
  }

  /**
   * Merge new patterns/lessons/decisions into the self-model.md content.
   * Adds items to "Understood" section if they represent confirmed knowledge.
   */
  private mergeLearningsIntoSelfModel(
    content: string,
    ctx: PostCommitContext
  ): string {
    const learnings: string[] = [];
    
    // Add patterns as understood principles
    if (ctx.patterns) {
      for (const p of ctx.patterns.slice(0, 3)) {
        if (p.length >= 10 && !content.includes(p)) {
          learnings.push(`- ${p}`);
        }
      }
    }
    
    // Add lessons as understood pitfalls/practices
    if (ctx.lessons) {
      for (const l of ctx.lessons.slice(0, 2)) {
        if (l.length >= 10 && !content.includes(l)) {
          learnings.push(`- ${l}`);
        }
      }
    }
    
    // Add decisions as understood choices
    if (ctx.decisions) {
      for (const d of ctx.decisions.slice(0, 2)) {
        const normalized = d.trim();
        if (normalized.length >= 10 && !content.includes(normalized)) {
          learnings.push(`- 已决策: ${normalized}`);
        }
      }
    }

    if (learnings.length === 0) return content;

    // Try to append under "## Understood" section
    const understoodMatch = content.match(/(##\s*Understood\s*\n)([\s\S]*?)(?=\n##\s|$)/);
    if (understoodMatch) {
      const existingBlock = understoodMatch[2];
      const newBlock = existingBlock.trimEnd() + "\n" + learnings.join("\n") + "\n";
      return content.replace(understoodMatch[0], `## Understood\n${newBlock}`);
    }

    // If no Understood section, append before Updated At or at end
    const updatedAtMatch = content.match(/\n##\s*Updated\s*At\s*\n/);
    if (updatedAtMatch) {
      const insertPos = content.indexOf(updatedAtMatch[0]);
      return (
        content.slice(0, insertPos) +
        "\n## Understood\n" +
        learnings.join("\n") +
        "\n\n" +
        content.slice(insertPos)
      );
    }

    return content.trimEnd() + "\n\n## Understood\n" + learnings.join("\n") + "\n";
  }

  // -------------------------------------------------------------------------
  // Public: Daily Self-Check — force self-model update with explicit content
  // -------------------------------------------------------------------------

  /**
   * Force-update an agent's self-model.md with explicit content.
   * Used by daily self-check tasks to ensure self-model stays current
   * even when agents haven't had tool-rich sessions.
   */
  async forceSelfModelUpdate(params: {
    agentId: string;
    projectId?: string;
    currentGoal?: string;
    understood?: string[];
    uncertain?: string[];
    missingEvidence?: string[];
    preferredNextActions?: string[];
    confidence?: "low" | "medium" | "high";
  }): Promise<boolean> {
    try {
      const [selfModel] = await this.carriers.read({
        agentId: params.agentId,
        projectId: params.projectId,
        files: ["self-model.md"]
      });

      const now = new Date().toISOString();
      let content = selfModel?.content ?? this.buildEmptySelfModel();

      // Update each section
      if (params.currentGoal) {
        content = this.updateSection(content, "Current Goal", params.currentGoal);
      }
      if (params.understood?.length) {
        content = this.appendToSection(content, "Understood", params.understood);
      }
      if (params.uncertain?.length) {
        content = this.updateSection(content, "Uncertain", params.uncertain.join("\n- "));
      }
      if (params.missingEvidence?.length) {
        content = this.updateSection(content, "Missing Evidence", params.missingEvidence.join("\n- "));
      }
      if (params.preferredNextActions?.length) {
        content = this.updateSection(content, "Preferred Next Actions", params.preferredNextActions.join("\n- "));
      }
      if (params.confidence) {
        content = this.updateSection(content, "Confidence", params.confidence);
      }

      content = setCarrierTimestamp(content, now);

      await this.carriers.merge({
        agentId: params.agentId,
        projectId: params.projectId,
        patches: [{ filename: "self-model.md", content }]
      });

      return true;
    } catch {
      return false;
    }
  }

  private buildEmptySelfModel(): string {
    return `# Self Model

## Current Goal
<!-- What is the agent currently trying to accomplish? -->

## Understood
<!-- What has the agent confidently understood? -->

## Uncertain
<!-- What is the agent unsure about? -->

## Missing Evidence
<!-- What information is still needed? -->

## Preferred Next Actions
<!-- What should the agent do next? -->

## Confidence
<!-- low | medium | high -->

## Updated At
<!-- ${new Date().toISOString()} -->
`;
  }

  private updateSection(content: string, heading: string, value: string): string {
    const regex = new RegExp(`(##\\s*${heading}\\s*\\n)([\\s\\S]*?)(?=\\n##\\s|$)`);
    const match = content.match(regex);
    if (match) {
      return content.replace(match[0], `## ${heading}\n${value}\n`);
    }
    // Section doesn't exist — append before Updated At
    const updatedAtMatch = content.match(/\n##\s*Updated\s*At\s*\n/);
    if (updatedAtMatch) {
      const insertPos = content.indexOf(updatedAtMatch[0]);
      return (
        content.slice(0, insertPos) +
        `\n## ${heading}\n${value}\n\n` +
        content.slice(insertPos)
      );
    }
    return content.trimEnd() + `\n\n## ${heading}\n${value}\n`;
  }

  private appendToSection(content: string, heading: string, items: string[]): string {
    const regex = new RegExp(`(##\\s*${heading}\\s*\\n)([\\s\\S]*?)(?=\\n##\\s|$)`);
    const match = content.match(regex);
    if (match) {
      const existing = match[2].trim();
      const newItems = items.filter((item) => !existing.includes(item));
      if (newItems.length === 0) return content;
      const prefix = existing ? existing + "\n" : "";
      const newBlock = prefix + newItems.map((i) => `- ${i}`).join("\n") + "\n";
      return content.replace(match[0], `## ${heading}\n${newBlock}`);
    }
    return this.updateSection(content, heading, items.map((i) => `- ${i}`).join("\n"));
  }
}
