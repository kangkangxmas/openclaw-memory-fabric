/**
 * ScoringService — evaluates experience quality across 3 dimensions.
 *
 * P2-2: Self-assessment scores (0-100) for each experience entry:
 *   - Goal completion    (0-40)
 *   - Tool efficiency    (0-30)
 *   - Decision quality   (0-30)
 *
 * Falls back to heuristic scoring when LLM is unavailable.
 */

import type { DistillLLMConfig } from "./distill-service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoreResult {
  selfScore: number;
  scoreRationale: string;
}

export interface TaskReport {
  taskType: string;
  totalEntries: number;
  avgScore: number;
  avgSuccessRate: number;
  trend: "up" | "down" | "flat";
}

interface LLMResponse {
  choices: Array<{ message: { content: string } }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCORING_PROMPT = `You are an AI assistant performance evaluator.
Score the following task session on 3 dimensions (0-100 total):
- Goal completion (0-40): Was the user's original request fully resolved?
- Tool efficiency (0-30): Were tools used effectively without waste?
- Decision quality (0-30): Were architectural/technical decisions sound?

Return ONLY a JSON object in this exact format:
{"score": NUMBER, "rationale": "Brief explanation in Chinese or English"}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function callLLM(
  cfg: DistillLLMConfig,
  userPrompt: string
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 10_000);

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
          { role: "system", content: SCORING_PROMPT },
          { role: "user", content: userPrompt }
        ],
        max_tokens: cfg.maxTokens ?? 200,
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

function heuristicScore(params: {
  success: boolean;
  toolCount: number;
  turnCount: number;
  outcome?: string;
  patterns?: string[];
  lessons?: string[];
}): ScoreResult {
  const { success, toolCount, turnCount, outcome, patterns, lessons } = params;

  // Dimension 1: Goal completion (0-40)
  let goalScore = success ? 30 : 10;
  if (outcome && outcome.length > 20) goalScore += 5; // detailed outcome
  if (patterns && patterns.length > 0) goalScore += 5; // patterns extracted = deeper work

  // Dimension 2: Tool efficiency (0-30)
  let toolScore = 20;
  const toolRatio = toolCount / Math.max(turnCount, 1);
  if (toolRatio > 0.8) toolScore -= 10; // over-tooling
  if (toolRatio >= 0.3 && toolRatio <= 0.7) toolScore += 10; // sweet spot
  if (toolCount === 0) toolScore = 5; // no tools at all

  // Dimension 3: Knowledge quality (0-30)
  let knowledgeScore = 10;
  if (lessons && lessons.length > 0) knowledgeScore += 10; // learned something
  if (patterns && patterns.some((p) => p.length >= 20)) knowledgeScore += 5; // substantive pattern
  if (outcome && /\b(fix|resolve|implement|完成|修复|实现)\b/i.test(outcome)) knowledgeScore += 5;

  const total = Math.max(0, Math.min(100, goalScore + toolScore + knowledgeScore));
  const rationale =
    `goal=${goalScore}/40 tool=${toolScore}/30 knowledge=${knowledgeScore}/30` +
    ` | success=${success} tools=${toolCount} turns=${turnCount}`;

  return { selfScore: total, scoreRationale: rationale };
}

// ---------------------------------------------------------------------------
// ScoringService
// ---------------------------------------------------------------------------

export class ScoringService {
  constructor(private readonly llmCfg?: DistillLLMConfig) {}

  /**
   * Score a single experience entry.
   */
  async score(params: {
    success: boolean;
    toolCount: number;
    turnCount: number;
    outcome?: string;
    patterns?: string[];
    lessons?: string[];
  }): Promise<ScoreResult> {
    if (this.llmCfg) {
      const prompt = `Outcome: ${params.outcome ?? "N/A"}\nSuccess: ${params.success}\nTools used: ${params.toolCount}\nTurns: ${params.turnCount}\nPatterns: ${(params.patterns ?? []).join(", ") || "None"}`;
      const raw = await callLLM(this.llmCfg, prompt);

      if (raw) {
        const cleaned = raw
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "");
        try {
          const parsed = JSON.parse(cleaned) as { score?: unknown; rationale?: unknown };
          if (typeof parsed.score === "number") {
            return {
              selfScore: Math.max(0, Math.min(100, Math.round(parsed.score))),
              scoreRationale: typeof parsed.rationale === "string" ? parsed.rationale : "LLM scored"
            };
          }
        } catch {
          // fall through to heuristic
        }
      }
    }

    return heuristicScore(params);
  }

  /**
   * Generate a trend report from experience entries.
   */
  generateReport(
    entries: Array<{
      taskType: string;
      selfScore?: number;
      success: boolean;
      timestamp: number;
    }>
  ): TaskReport[] {
    const byType = new Map<string, typeof entries>();
    for (const e of entries) {
      const arr = byType.get(e.taskType) ?? [];
      arr.push(e);
      byType.set(e.taskType, arr);
    }

    const reports: TaskReport[] = [];
    for (const [taskType, items] of byType) {
      const scores = items
        .map((e) => e.selfScore)
        .filter((s): s is number => s !== undefined);
      const avgScore = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 0;
      const avgSuccess = items.filter((e) => e.success).length / items.length;

      // Simple trend: compare first half vs second half
      const mid = Math.floor(items.length / 2);
      const firstHalf = items.slice(0, mid);
      const secondHalf = items.slice(mid);
      const firstScore = firstHalf.filter((e) => e.success).length / Math.max(firstHalf.length, 1);
      const secondScore = secondHalf.filter((e) => e.success).length / Math.max(secondHalf.length, 1);

      let trend: "up" | "down" | "flat" = "flat";
      if (secondScore > firstScore + 0.1) trend = "up";
      else if (secondScore < firstScore - 0.1) trend = "down";

      reports.push({
        taskType,
        totalEntries: items.length,
        avgScore: Math.round(avgScore * 10) / 10,
        avgSuccessRate: Math.round(avgSuccess * 100) / 100,
        trend
      });
    }

    return reports.sort((a, b) => b.totalEntries - a.totalEntries);
  }
}
