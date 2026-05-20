/**
 * SharingService — cross-agent experience sharing.
 *
 * P2-3: When a pattern reaches confidence ≥ 0.9, find agents with
 *   similar tool chains (Jaccard similarity ≥ 0.6) and push the
 *   pattern as a shared experience entry to their store.
 */

import { readdir } from "fs/promises";
import { join } from "path";
import type { Pattern } from "../stores/pattern-store.js";
import type { ExperienceStore, ExperienceEntry } from "../stores/experience-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SharingResult {
  shared: boolean;
  targetAgents?: string[];
  reason?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function extractToolsFromPairs(pairs: string[]): string[] {
  const tools = new Set<string>();
  for (const pair of pairs) {
    const [a, b] = pair.split("→");
    if (a) tools.add(a);
    if (b) tools.add(b);
  }
  return Array.from(tools);
}

// ---------------------------------------------------------------------------
// SharingService
// ---------------------------------------------------------------------------

export class SharingService {
  constructor(
    private readonly expStore: ExperienceStore,
    private readonly openvikingBasePath: string,
    private readonly minConfidence = 9,
    private readonly minJaccard = 0.6
  ) {}

  /**
   * Push a high-confidence pattern to agents with similar tool profiles.
   */
  async sharePattern(pattern: Pattern, _allAgentIds: string[]): Promise<SharingResult> {
    if (pattern.confidence < this.minConfidence) {
      return { shared: false, reason: "confidence_too_low" };
    }

    const sourceTools = extractToolsFromPairs(pattern.commonTools);
    if (sourceTools.length === 0) {
      return { shared: false, reason: "no_tools" };
    }

    // Scan all agent directories
    const agentsDir = join(this.openvikingBasePath, "org", "default", "agents");
    let agentIds: string[];
    try {
      agentIds = await readdir(agentsDir);
    } catch {
      return { shared: false, reason: "agents_dir_unavailable" };
    }

    const targets: string[] = [];

    for (const targetId of agentIds) {
      if (targetId === pattern.agentId) continue;

      // Load target's recent experiences to extract their tool profile
      const entries = await this.expStore.query({
        agentId: targetId,
        limit: 20
      });

      if (entries.length === 0) continue;

      const targetTools = new Set<string>();
      for (const e of entries) {
        if (Array.isArray(e.toolsUsed)) {
          for (const t of e.toolsUsed) targetTools.add(t);
        }
      }

      const similarity = jaccardSimilarity(sourceTools, Array.from(targetTools));
      if (similarity >= this.minJaccard) {
        targets.push(targetId);
      }
    }

    if (targets.length === 0) {
      return { shared: false, reason: "no_similar_agents" };
    }

    // Write shared experience to each target
    for (const targetId of targets) {
      const sharedEntry: ExperienceEntry = {
        id: `shared-${pattern.id}-${targetId}`,
        agentId: targetId,
        projectId: pattern.agentId, // source agent as project marker
        timestamp: Date.now(),
        taskType: pattern.taskType,
        toolsUsed: sourceTools,
        toolCount: sourceTools.length,
        turnCount: 0,
        success: pattern.successRate >= 0.8,
        patterns: pattern.commonLessons,
        lessons: [`Shared from agent ${pattern.agentId}: ${pattern.commonLessons.join("; ")}`],
        tokenCost: 0,
        outcome: `Cross-agent pattern: ${pattern.taskType} (confidence ${pattern.confidence.toFixed(1)})`
      };

      await this.expStore.append(sharedEntry);
    }

    return { shared: true, targetAgents: targets };
  }
}
