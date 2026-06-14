import type { RecallDepth } from "../types/index.js";
import type { CarrierReadResult, StructuralBriefResponse } from "../utils/sidecar-client.js";

export interface StructuralBriefInjection {
  section: string;
  source?: string;
  staleSkipped: boolean;
}

export interface CarrierInjection {
  enrichment: string;
  filenames: string[];
  filteredCount: number;
  droppedCount: number;
}

export interface ComposedInjection {
  text: string;
  truncated: boolean;
}

const LEGACY_INJECTION_LIMITS: Partial<Record<RecallDepth, number>> = {
  l1: 2200,
  l2: 4500
};

const POLLUTED_SECTION_PATTERNS = [
  /conversation\s+summary/i,
  /session\s+summary\s*\(compaction\)/i,
  /session\s+summary/i,
  /dream\s+diary/i,
  /梦境日记|梦日记/i
];

export function legacyInjectionLimit(depth: RecallDepth): number | undefined {
  return LEGACY_INJECTION_LIMITS[depth];
}

export function formatStructuralBriefForPrompt(brief: StructuralBriefResponse): StructuralBriefInjection {
  if (brief.freshness === "missing") {
    return { section: "", staleSkipped: false };
  }

  if (brief.freshness === "stale") {
    return {
      section: "### Structural Brief\nFreshness: stale | Structural graph may be outdated; detailed entities and clusters withheld.",
      source: "graphify:brief:stale-skipped",
      staleSkipped: true
    };
  }

  return {
    section: [
      "### Structural Brief",
      `Freshness: fresh | Core entities: ${brief.coreNodes.slice(0, 5).join(", ")}`,
      brief.communities.length > 0 ? `Clusters: ${brief.communities.slice(0, 3).join(" | ")}` : "",
      brief.summary.slice(0, 400)
    ]
      .filter(Boolean)
      .join("\n"),
    source: "graphify:brief:fresh",
    staleSkipped: false
  };
}

export function sanitizeCarrierForPrompt(content: string): { content: string; filtered: boolean } {
  let sanitized = content;

  sanitized = sanitized.replace(/<!--\s*memory-fabric:begin\s*-->[\s\S]*?<!--\s*memory-fabric:end\s*-->/gi, "");
  sanitized = stripPollutedHeadingSections(sanitized);
  sanitized = sanitized
    .split(/\r?\n/)
    .filter((line) => !isRawRoleLogLine(line))
    .join("\n");
  sanitized = sanitized
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim();

  return { content: sanitized, filtered: sanitized !== content.trim() };
}

export function buildCarrierEnrichment(
  carriers: CarrierReadResult[],
  depth: RecallDepth,
  maxChars = legacyInjectionLimit(depth) ?? 0
): CarrierInjection {
  if (depth === "l0" || maxChars <= 0) {
    return { enrichment: "", filenames: [], filteredCount: 0, droppedCount: carriers.filter((carrier) => carrier.exists).length };
  }

  const sections: string[] = [];
  const filenames: string[] = [];
  let used = 0;
  let filteredCount = 0;
  let droppedCount = 0;

  for (const carrier of carriers) {
    if (!carrier.exists) continue;

    const sanitized = sanitizeCarrierForPrompt(carrier.content);
    if (sanitized.filtered) filteredCount++;
    if (!sanitized.content) {
      droppedCount++;
      continue;
    }

    const prefix = sections.length > 0 ? "\n\n" : "";
    const header = `### Carrier: ${carrier.filename}\n`;
    const remaining = maxChars - used - prefix.length - header.length;
    if (remaining <= 0) {
      droppedCount++;
      continue;
    }

    const body = sanitized.content.length > remaining ? `${sanitized.content.slice(0, Math.max(0, remaining - 1)).trimEnd()}…` : sanitized.content;
    const section = `${prefix}${header}${body}`;
    sections.push(section);
    filenames.push(carrier.filename);
    used += section.length;
  }

  return { enrichment: sections.join(""), filenames, filteredCount, droppedCount };
}

export function composePromptInjection(sections: string[], depth: RecallDepth): ComposedInjection {
  const populated = sections.map((section) => section.trim()).filter(Boolean);
  const maxChars = legacyInjectionLimit(depth);
  if (!maxChars) return { text: populated.join("\n\n---\n\n"), truncated: false };

  const output: string[] = [];
  let used = 0;
  let truncated = false;

  for (const section of populated) {
    const separator = output.length > 0 ? "\n\n---\n\n" : "";
    const remaining = maxChars - used - separator.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    if (section.length > remaining) {
      output.push(`${separator}${section.slice(0, Math.max(0, remaining - 1)).trimEnd()}…`);
      truncated = true;
      break;
    }

    output.push(`${separator}${section}`);
    used += separator.length + section.length;
  }

  return { text: output.join(""), truncated };
}

function stripPollutedHeadingSections(content: string): string {
  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  let skipDepth: number | undefined;

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const depth = heading[1].length;
      const title = heading[2];
      if (skipDepth !== undefined && depth <= skipDepth) skipDepth = undefined;
      if (POLLUTED_SECTION_PATTERNS.some((pattern) => pattern.test(title))) {
        skipDepth = depth;
        continue;
      }
    }

    if (skipDepth !== undefined) continue;
    if (POLLUTED_SECTION_PATTERNS.some((pattern) => pattern.test(line)) && line.trim().length < 120) continue;
    kept.push(line);
  }

  return kept.join("\n");
}

function isRawRoleLogLine(line: string): boolean {
  return /^\s{0,3}(?:>\s*)?(?:[-*]\s*)?(?:\*\*)?(?:System|User|Assistant)(?:\*\*)?\s*[:：]/i.test(line);
}
