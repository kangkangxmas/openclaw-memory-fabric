/**
 * Brief Templates — task-type-driven dynamic Memory Brief formatting.
 *
 * Each task type maps to a TemplateConfig that controls section order,
 * emphasis, and budget allocation. The "general" template preserves
 * backward-compatible behavior (all sections, no emphasis).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SectionType = "fact" | "decision" | "entity" | "pattern" | "unresolved";

export interface TemplateConfig {
  /** Sections to include, in display order */
  sectionOrder: SectionType[];
  /** Sections that receive a larger share of the item budget */
  emphasized: SectionType[];
  /** Budget multiplier for emphasized sections (e.g. 1.5 = 50% more items) */
  emphasisWeight: number;
  /** Whether to inject patterns from PatternStore for this task type */
  includePatterns: boolean;
  /** Descriptive header line added after the brief header */
  headerNote: string;
}

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------

const TEMPLATES = new Map<string, TemplateConfig>([
  ["code_review", {
    sectionOrder: ["decision", "pattern", "fact", "entity"],
    emphasized: ["decision", "pattern"],
    emphasisWeight: 1.5,
    includePatterns: true,
    headerNote: "Focus: Code review \u2014 decisions and patterns prioritized",
  }],
  ["debug", {
    sectionOrder: ["entity", "unresolved", "fact", "decision"],
    emphasized: ["entity", "unresolved"],
    emphasisWeight: 1.5,
    includePatterns: true,
    headerNote: "Focus: Debugging \u2014 entities and open questions prioritized",
  }],
  ["architecture", {
    sectionOrder: ["decision", "entity", "fact", "pattern"],
    emphasized: ["decision", "entity"],
    emphasisWeight: 1.5,
    includePatterns: true,
    headerNote: "Focus: Architecture \u2014 decisions and entities prioritized",
  }],
  ["devops", {
    sectionOrder: ["fact", "decision", "pattern", "entity"],
    emphasized: ["fact", "pattern"],
    emphasisWeight: 1.5,
    includePatterns: true,
    headerNote: "Focus: DevOps \u2014 facts and patterns prioritized",
  }],
  ["qa", {
    sectionOrder: ["fact", "pattern", "unresolved", "entity"],
    emphasized: ["fact", "pattern"],
    emphasisWeight: 1.5,
    includePatterns: true,
    headerNote: "Focus: QA \u2014 facts and patterns prioritized",
  }],
  ["documentation", {
    sectionOrder: ["entity", "fact", "decision"],
    emphasized: ["entity", "fact"],
    emphasisWeight: 1.5,
    includePatterns: false,
    headerNote: "Focus: Documentation \u2014 entities and facts prioritized",
  }],
  ["refactor", {
    sectionOrder: ["entity", "decision", "pattern", "fact"],
    emphasized: ["entity", "decision"],
    emphasisWeight: 1.5,
    includePatterns: true,
    headerNote: "Focus: Refactoring \u2014 entities and decisions prioritized",
  }],
  ["general", {
    sectionOrder: ["fact", "decision", "entity", "pattern", "unresolved"],
    emphasized: [],
    emphasisWeight: 1.0,
    includePatterns: false,
    headerNote: "",
  }],
]);

/**
 * Get the template config for a task type. Falls back to "general" for
 * unknown types (including "other" from ExperienceService).
 */
export function getTemplateConfig(taskType?: string): TemplateConfig {
  if (!taskType) return TEMPLATES.get("general")!;
  return TEMPLATES.get(taskType) ?? TEMPLATES.get("general")!;
}

// ---------------------------------------------------------------------------
// Template-aware brief formatting
// ---------------------------------------------------------------------------

interface BriefEntry {
  type: string;
  content: string;
}

interface BriefContext {
  agentId: string;
  projectId?: string;
  scope: string;
  depth: string;
  taskType?: string;
}

const SECTION_LABELS: Record<string, string> = {
  fact: "Facts",
  decision: "Decisions",
  entity: "Entities",
  pattern: "Patterns",
  unresolved: "Unresolved",
};

/**
 * Format a Memory Brief using template-driven section ordering and emphasis.
 *
 * Emphasized sections receive ceil(maxPerSection * emphasisWeight) items;
 * non-emphasized sections receive the base maxPerSection.
 */
export function formatBriefWithTemplate(
  entries: BriefEntry[],
  ctx: BriefContext,
  template: TemplateConfig,
  maxEntries: number
): string {
  if (entries.length === 0) {
    return `## Memory Brief\nNo memories found for agent=${ctx.agentId} scope=${ctx.scope} depth=${ctx.depth}.\n`;
  }

  // Group entries by type
  const byType = new Map<string, string[]>();
  for (const e of entries) {
    const arr = byType.get(e.type) ?? [];
    arr.push(e.content);
    byType.set(e.type, arr);
  }

  // Compute per-section item limits
  const sectionCount = template.sectionOrder.length || 1;
  const basePerSection = Math.max(1, Math.floor(maxEntries / sectionCount));

  // Build header
  const lines: string[] = [
    "## Memory Brief",
    `Agent: ${ctx.agentId}${ctx.projectId ? ` | Project: ${ctx.projectId}` : ""} | Scope: ${ctx.scope} | Depth: ${ctx.depth}${ctx.taskType && ctx.taskType !== "general" ? ` | Task: ${ctx.taskType}` : ""}`,
  ];

  if (template.headerNote) {
    lines.push(`> ${template.headerNote}`);
  }
  lines.push("");

  // Render sections in template order
  for (const sectionType of template.sectionOrder) {
    const items = byType.get(sectionType);
    if (!items || items.length === 0) continue;

    const isEmphasized = template.emphasized.includes(sectionType);
    const limit = isEmphasized
      ? Math.ceil(basePerSection * template.emphasisWeight)
      : basePerSection;

    const label = SECTION_LABELS[sectionType] ?? sectionType;
    lines.push(`### ${label}`);
    items.slice(0, limit).forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  }

  return lines.join("\n");
}
