/**
 * SkillGenService — auto-generates SKILL.md drafts from detected patterns.
 *
 * P1-2: When PatternService identifies a stable pattern, this service
 *   generates a skill draft, writes it to skills/auto-generated/, and
 *   tracks it in SkillDraftStore for human review.
 *
 * Safety rules (enforced):
 *   - Drafts are marked [AUTO-DRAFT]
 *   - Stored outside the skill scan path (auto-generated/)
 *   - Hash deduplication prevents duplicate generation
 *   - Human confirmation required to move to active skills/
 */

import { createHash } from "crypto";
import { join } from "path";
import { writeFile, mkdir } from "fs/promises";
import type { Pattern } from "../stores/pattern-store.js";
import type { SkillDraftStore, DraftMeta } from "../stores/skill-draft-store.js";
import type { DistillLLMConfig } from "./distill-service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillGenServiceConfig {
  /** Directory where auto-generated drafts live. */
  draftDir: string;
  /** Optional LLM for skill generation. Falls back to template. */
  llmCfg?: DistillLLMConfig;
}

export interface SkillGenResult {
  path?: string;
  skipped: boolean;
  reason?: string;
}

interface LLMResponse {
  choices: Array<{ message: { content: string } }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_CONFIDENCE = 3;

const SYSTEM_PROMPT = `You are an OpenClaw Agent Skill document generator.
Generate concise, actionable SKILL.md content. No markdown code fences around the output.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function callLLM(
  cfg: DistillLLMConfig,
  userPrompt: string
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
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt }
        ],
        max_tokens: cfg.maxTokens ?? 800,
        temperature: 0.3
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

function hashPattern(pattern: Pattern): string {
  const key = `${pattern.taskType}:${pattern.commonTools.join(",")}:${pattern.commonLessons.join(",")}`;
  return createHash("md5").update(key).digest("hex").slice(0, 8);
}

// ---------------------------------------------------------------------------
// SkillGenService
// ---------------------------------------------------------------------------

export class SkillGenService {
  private readonly draftDir: string;

  constructor(
    private readonly store: SkillDraftStore,
    private readonly config: SkillGenServiceConfig
  ) {
    this.draftDir = config.draftDir;
  }

  /**
   * Called by PatternService when a new stable pattern is detected.
   *
   * @returns path to the generated draft, or skip reason.
   */
  async onPatternDetected(pattern: Pattern): Promise<SkillGenResult> {
    const hash = hashPattern(pattern);

    // Deduplication
    if (await this.store.exists(hash)) {
      return { skipped: true, reason: "already_exists" };
    }

    // Confidence gate
    if (pattern.confidence < MIN_CONFIDENCE) {
      return { skipped: true, reason: "confidence_too_low" };
    }

    // Generate content
    const content = await this.generateContent(pattern);
    const fileName = `${pattern.taskType}-${hash}.md`;
    const filePath = join(this.draftDir, fileName);

    await mkdir(this.draftDir, { recursive: true });
    await writeFile(filePath, content, "utf-8");

    const meta: DraftMeta = {
      hash,
      taskType: pattern.taskType,
      filePath,
      status: "pending",
      createdAt: Date.now()
    };
    await this.store.add(meta);

    return { path: filePath, skipped: false };
  }

  /** List all pending drafts awaiting human review. */
  async getPendingDrafts(): Promise<DraftMeta[]> {
    return this.store.getPending();
  }

  // -------------------------------------------------------------------------
  // Private: content generation
  // -------------------------------------------------------------------------

  private async generateContent(pattern: Pattern): Promise<string> {
    const llmCfg = this.config.llmCfg;
    if (llmCfg) {
      const prompt = this.buildPrompt(pattern);
      const raw = await callLLM(llmCfg, prompt);
      if (raw) {
        return this.sanitizeContent(raw, pattern);
      }
    }
    return this.buildFallbackContent(pattern);
  }

  private buildPrompt(pattern: Pattern): string {
    return `Based on the following agent experience pattern, generate a standard SKILL.md file:

Task Type: ${pattern.taskType}
Frequency: ${pattern.frequency} times
Success Rate: ${(pattern.successRate * 100).toFixed(0)}%
Common Tool Chain: ${pattern.commonTools.join(" → ")}
Common Lessons: ${pattern.commonLessons.join(", ") || "None extracted"}

Requirements:
1. Include: description, when to use, step-by-step execution, notes/caveats
2. Steps should reference specific tool names and parameter templates
3. Header must include [AUTO-DRAFT] and generation timestamp
4. Append a Reviewer Instructions section at the end (enable/modify/ignore)
5. Pure Markdown format, do not wrap the entire response in code fences
6. The implied filename: ${pattern.taskType}-skill.md

Generate the complete SKILL.md content now.`;
  }

  private sanitizeContent(raw: string, pattern: Pattern): string {
    let content = raw;

    // Ensure [AUTO-DRAFT] header
    if (!content.includes("[AUTO-DRAFT]")) {
      content = `# ${pattern.taskType} Skill [AUTO-DRAFT]\n\n${content}`;
    }

    // Add generation metadata if missing
    const metaLine = `> 自动生成于 ${new Date().toISOString()} | 基于 ${pattern.frequency} 次经验 | 成功率 ${(pattern.successRate * 100).toFixed(0)}%\n\n`;
    if (!content.includes("自动生成于")) {
      // Insert after the first heading line
      const firstNewline = content.indexOf("\n");
      if (firstNewline > 0) {
        content = content.slice(0, firstNewline + 1) + metaLine + content.slice(firstNewline + 1);
      }
    }

    // Ensure Reviewer Instructions
    if (!content.includes("Reviewer Instructions")) {
      content += `\n\n---\n\n## Reviewer Instructions\n- **启用 (Enable)**: 将此文件移动到 \`~/.openclaw/skills/\` 目录\n- **修改 (Modify)**: 直接编辑后移动\n- **忽略 (Ignore)**: 删除此文件或保留不动\n`;
    }

    return content;
  }

  private buildFallbackContent(pattern: Pattern): string {
    const lines = [
      `# ${pattern.taskType} Skill [AUTO-DRAFT]`,
      `> 自动生成于 ${new Date().toISOString()} | 基于 ${pattern.frequency} 次经验 | 成功率 ${(pattern.successRate * 100).toFixed(0)}%`,
      "",
      "## Description",
      `This skill covers recurring \`${pattern.taskType}\` tasks identified from agent experience patterns.`,
      "",
      "## When to Use",
      `- Task type: ${pattern.taskType}`,
      `- Detected in ${pattern.frequency} successful sessions`,
      `- Confidence score: ${pattern.confidence.toFixed(1)}`,
      "",
      "## Steps"
    ];

    for (let i = 0; i < pattern.commonTools.length; i++) {
      lines.push(`${i + 1}. Use tool chain: \`${pattern.commonTools[i]}\``);
    }

    lines.push("", "## Notes");
    if (pattern.commonLessons.length > 0) {
      for (const l of pattern.commonLessons) {
        lines.push(`- ${l}`);
      }
    } else {
      lines.push("- No specific lessons extracted yet.");
    }

    lines.push(
      "",
      "---",
      "",
      "## Reviewer Instructions",
      "- **启用 (Enable)**: 将此文件移动到 `~/.openclaw/skills/` 目录",
      "- **修改 (Modify)**: 直接编辑后移动",
      "- **忽略 (Ignore)**: 删除此文件或保留不动",
      ""
    );

    return lines.join("\n");
  }
}
