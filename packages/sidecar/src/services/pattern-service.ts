/**
 * PatternService — experience pattern detection engine.
 *
 * P1-1: Scans an agent's experience entries, clusters by taskType,
 *   and identifies stable patterns (frequency ≥ 3, successRate ≥ 0.8).
 *
 * Triggered by ExperienceService after every 10th new experience entry.
 */

import type { ExperienceEntry, ExperienceQuery } from "../stores/experience-store.js";
import type { Pattern, PatternStore } from "../stores/pattern-store.js";
import type { DistillLLMConfig } from "./distill-service.js";
import type { SkillGenService } from "./skill-gen-service.js";
import type { SharingService } from "./sharing-service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatternServiceConfig {
  /** Optional LLM for lesson synthesis. Falls back to frequency heuristic. */
  llmCfg?: DistillLLMConfig;
  /** Optional SkillGenService to auto-generate skills on pattern detection. */
  skillGen?: SkillGenService;
  /** Optional SharingService for cross-agent pattern sharing. */
  sharing?: SharingService;
}

export interface PatternDetectionResult {
  patterns: Pattern[];
  scannedCount: number;
}

interface _Cluster {
  taskType: string;
  entries: ExperienceEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_FREQUENCY = 2;
const MIN_SUCCESS_RATE = 0.8;
const DEFAULT_DAYS = 30;

const LESSON_SYNTHESIS_PROMPT = `You are a pattern synthesis assistant.
Given a set of lessons learned from repeated tasks, synthesize 2-3 concise,
reusable patterns or principles.

Lessons:
{lessons}

Return ONLY a JSON array of strings, no markdown fences:
["pattern 1", "pattern 2"]`;

// ---------------------------------------------------------------------------
// LLM helpers
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

// ---------------------------------------------------------------------------
// Clustering & analysis
// ---------------------------------------------------------------------------

function clusterByTaskType(entries: ExperienceEntry[]): Map<string, ExperienceEntry[]> {
  const clusters = new Map<string, ExperienceEntry[]>();
  for (const e of entries) {
    const key = e.taskType || "other";
    const arr = clusters.get(key) ?? [];
    arr.push(e);
    clusters.set(key, arr);
  }
  return clusters;
}

function evaluateCluster(entries: ExperienceEntry[]): {
  frequency: number;
  successRate: number;
  firstSeen: number;
  lastSeen: number;
} {
  const successCount = entries.filter((e) => e.success).length;
  return {
    frequency: entries.length,
    successRate: successCount / entries.length,
    firstSeen: Math.min(...entries.map((e) => e.timestamp)),
    lastSeen: Math.max(...entries.map((e) => e.timestamp))
  };
}

/**
 * Find common tool-pair sequences that appear in ≥ 50% of entries.
 * Returns "toolA→toolB" strings sorted by frequency.
 */
function findCommonToolPairs(entries: ExperienceEntry[]): string[] {
  if (entries.length < MIN_FREQUENCY) return [];

  const pairCounts = new Map<string, number>();
  for (const e of entries) {
    const tools = e.toolsUsed;
    for (let i = 0; i < tools.length - 1; i++) {
      const pair = `${tools[i]}→${tools[i + 1]}`;
      pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    }
  }

  const threshold = entries.length * 0.5;
  return Array.from(pairCounts.entries())
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pair]) => pair);
}

/** Frequency-based lesson extraction (no LLM). */
function extractCommonLessonsHeuristic(entries: ExperienceEntry[]): string[] {
  const allLessons = entries.flatMap((e) => e.lessons);
  if (allLessons.length === 0) return [];

  const counts = new Map<string, number>();
  for (const l of allLessons) {
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([l]) => l);
}

/** LLM-based lesson synthesis. */
async function extractCommonLessonsLLM(
  entries: ExperienceEntry[],
  llmCfg: DistillLLMConfig
): Promise<string[]> {
  const allLessons = entries.flatMap((e) => e.lessons);
  if (allLessons.length === 0) return [];

  const user = allLessons.map((l, i) => `${i + 1}. ${l}`).join("\n");
  const raw = await callLLM(llmCfg, LESSON_SYNTHESIS_PROMPT, user);
  if (!raw) return extractCommonLessonsHeuristic(entries);

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((s) => typeof s === "string").slice(0, 3);
    }
  } catch {
    // fall through
  }
  return extractCommonLessonsHeuristic(entries);
}

// ---------------------------------------------------------------------------
// PatternService
// ---------------------------------------------------------------------------

export class PatternService {
  /** Tracks per-agent scan state to avoid redundant work. */
  private readonly lastScanCount = new Map<string, number>();

  constructor(
    private readonly expStore: {
      query: (q: ExperienceQuery) => Promise<ExperienceEntry[]>;
    },
    private readonly patStore: PatternStore,
    private readonly config?: PatternServiceConfig
  ) {}

  /**
   * Detect patterns for an agent.
   *
   * @param agentId   target agent
   * @param days      lookback window (default 30)
   * @param force     bypass entry-count delta check
   */
  async detectPatterns(
    agentId: string,
    days = DEFAULT_DAYS,
    force = false
  ): Promise<PatternDetectionResult> {
    const since = Date.now() - days * 86_400_000;
    const entries = await this.expStore.query({ agentId, since });

    if (entries.length < MIN_FREQUENCY) {
      return { patterns: [], scannedCount: entries.length };
    }

    // Skip if not enough new entries since last scan (unless forced)
    if (!force) {
      const lastCount = this.lastScanCount.get(agentId) ?? 0;
      if (entries.length - lastCount < 3) {
        return { patterns: [], scannedCount: entries.length };
      }
    }
    this.lastScanCount.set(agentId, entries.length);

    const clusters = clusterByTaskType(entries);
    const patterns: Pattern[] = [];

    for (const [taskType, clusterEntries] of clusters) {
      const stats = evaluateCluster(clusterEntries);

      if (
        stats.frequency >= MIN_FREQUENCY &&
        stats.successRate >= MIN_SUCCESS_RATE
      ) {
        const commonTools = findCommonToolPairs(clusterEntries);
        const commonLessons = this.config?.llmCfg
          ? await extractCommonLessonsLLM(clusterEntries, this.config.llmCfg)
          : extractCommonLessonsHeuristic(clusterEntries);

        const confidence = stats.frequency * stats.successRate;

        patterns.push({
          id: `pat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          agentId,
          taskType,
          frequency: stats.frequency,
          successRate: stats.successRate,
          commonTools,
          commonLessons,
          firstSeen: stats.firstSeen,
          lastSeen: stats.lastSeen,
          confidence,
          detectedAt: Date.now()
        });
      }
    }

    // Persist
    for (const p of patterns) {
      await this.patStore.append(p);

      // P1-2: Trigger skill generation for new patterns
      if (this.config?.skillGen) {
        void this.config.skillGen.onPatternDetected(p);
      }

      // P2-3: Cross-agent sharing for high-confidence patterns
      if (this.config?.sharing) {
        void this.config.sharing.sharePattern(p, []);
      }
    }

    return { patterns, scannedCount: entries.length };
  }

  /** Force re-scan for an agent (ignores delta check). */
  async forceDetect(agentId: string, days = DEFAULT_DAYS): Promise<PatternDetectionResult> {
    return this.detectPatterns(agentId, days, true);
  }

  /** List detected patterns for an agent. */
  async listPatterns(agentId: string, limit?: number): Promise<Pattern[]> {
    return this.patStore.query({ agentId, limit });
  }
}
