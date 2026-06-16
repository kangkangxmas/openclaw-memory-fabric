import { createHash } from "crypto";
import { join } from "path";
import type { SidecarConfig } from "../config/index.js";
import type { MemoryEntryV2 } from "../models/schema-v2.js";
import { appendJsonl, ensureFileDir, readJsonl, writeJsonl } from "../utils/jsonl.js";
import { resolveV2BaseDir } from "../utils/v2-paths.js";
import type { CarrierPatch, CarrierRepository } from "./carrier-service.js";

export interface CarrierDriftIssue {
  filename: string;
  memoryId: string;
  type: string;
  severity: "low" | "medium" | "high";
  message: string;
}

export interface CarrierDriftReport {
  agentId: string;
  projectId?: string;
  checkedAt: string;
  projectionVersion: string;
  issues: CarrierDriftIssue[];
  patches: CarrierPatch[];
}

export interface CarrierProjectionRecord {
  projectionId: string;
  agentId: string;
  projectId?: string;
  projectionVersion: string;
  status: "applied" | "rolled_back";
  appliedAt: string;
  rolledBackAt?: string;
  patches: CarrierPatch[];
  rollbackPatches: CarrierPatch[];
  merged: string[];
  skipped: string[];
}

export interface CarrierProjectionDiffLine {
  type: "context" | "added" | "removed";
  line: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface CarrierProjectionFilePreview {
  filename: string;
  before: string;
  after: string;
  changed: boolean;
  additions: number;
  removals: number;
  diff: CarrierProjectionDiffLine[];
}

export interface CarrierProjectionPreviewRecord {
  previewId: string;
  agentId: string;
  projectId?: string;
  projectionVersion: string;
  status: "preview";
  createdAt: string;
  expiresAt: string;
  patches: CarrierPatch[];
  rollbackPatches: CarrierPatch[];
  files: CarrierProjectionFilePreview[];
  skipped: string[];
  summary: {
    files: number;
    changedFiles: number;
    additions: number;
    removals: number;
  };
}

const PROJECTION_VERSION = "v2.0";
const PROJECTION_MARKER_PREFIX = `<!-- memory-fabric projection:${PROJECTION_VERSION} memory:`;
const SCHEMA_WHITELIST = new Set(["self-model.md", "decision-log.md", "execution-journal.md", "entities-glossary.md"]);
const OWNERSHIP_RULES = [
  { filename: "self-model.md", accepts: ["profile", "intent"], requirement: "high confidence L3/L5 with sourceRefs" },
  { filename: "decision-log.md", accepts: ["decision"], requirement: "L1 decision with sourceRefs" },
  { filename: "execution-journal.md", accepts: ["episode", "todo", "unresolved"], requirement: "L2 execution state with sourceRefs" },
  { filename: "entities-glossary.md", accepts: ["entity"], requirement: "L1 entity or graph-backed glossary item with sourceRefs" },
];

function targetFile(entry: MemoryEntryV2): string | null {
  switch (entry.type) {
    case "decision":
      return "decision-log.md";
    case "entity":
      return "entities-glossary.md";
    case "episode":
    case "todo":
    case "unresolved":
      return "execution-journal.md";
    case "profile":
    case "intent":
      return "self-model.md";
    default:
      return null;
  }
}

function qualityScore(entry: MemoryEntryV2): number {
  if (!entry.quality) return 0;
  return (entry.quality.specificity + entry.quality.actionability + entry.quality.stability + entry.quality.sourceCoverage) / 4;
}

function canProject(entry: MemoryEntryV2): boolean {
  if (entry.status === "superseded" || entry.status === "retracted") return false;
  if (!entry.sourceRefs || entry.sourceRefs.length === 0) return false;
  const filename = targetFile(entry);
  if (!filename) return false;
  if (filename === "self-model.md") {
    return (entry.type === "profile" || entry.type === "intent") && qualityScore(entry) >= 0.75 && (entry.quality?.sourceCoverage ?? 0) >= 1;
  }
  return true;
}

function projectionMarker(entry: MemoryEntryV2): string {
  return `${PROJECTION_MARKER_PREFIX}${entry.id} -->`;
}

function hasProjectionOwnership(patch: CarrierPatch): boolean {
  return patch.content.includes(PROJECTION_MARKER_PREFIX);
}

function patchFor(entry: MemoryEntryV2): CarrierPatch | null {
  const filename = targetFile(entry);
  if (!filename) return null;
  const sourceRefs = entry.sourceRefs?.length ? `\n**Sources:** ${entry.sourceRefs.join(", ")}` : "";
  const projection = projectionMarker(entry);

  if (filename === "decision-log.md") {
    return {
      filename,
      content: `## ${entry.timeline.createdAt.slice(0, 10)}: ${entry.content.slice(0, 70)}\n**Decision:** ${entry.content}${sourceRefs}\n${projection}\n`,
    };
  }
  if (filename === "entities-glossary.md") {
    return {
      filename,
      content: `- **${entry.content.slice(0, 80)}**: projected from ${entry.id}${entry.sourceRefs?.length ? ` (sources: ${entry.sourceRefs.join(", ")})` : ""}\n${projection}`,
    };
  }
  if (filename === "self-model.md") {
    return {
      filename,
      content: `# Self Model\n\n## Current Goal\nNot specified\n\n## Understood\n- ${entry.content}\n\n## Uncertain\n\n## Missing Evidence\n\n## Preferred Next Actions\n\n## Confidence\n${entry.quality && entry.quality.sourceCoverage >= 1 ? "medium" : "low"}\n\n## Updated At\n${new Date().toISOString()}\n${projection}\n`,
    };
  }
  return {
    filename,
    content: `## ${entry.timeline.createdAt}\n**Memory:** ${entry.content}${sourceRefs}\n${projection}\n`,
  };
}

function diffLines(before: string, after: string): CarrierProjectionDiffLine[] {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const max = Math.max(beforeLines.length, afterLines.length);
  const diff: CarrierProjectionDiffLine[] = [];
  let oldLineNumber = 1;
  let newLineNumber = 1;

  for (let i = 0; i < max; i++) {
    const beforeLine = beforeLines[i];
    const afterLine = afterLines[i];
    if (beforeLine === afterLine) {
      if (beforeLine !== undefined) {
        diff.push({ type: "context", line: beforeLine, oldLineNumber, newLineNumber });
        oldLineNumber++;
        newLineNumber++;
      }
      continue;
    }
    if (beforeLine !== undefined) {
      diff.push({ type: "removed", line: beforeLine, oldLineNumber });
      oldLineNumber++;
    }
    if (afterLine !== undefined) {
      diff.push({ type: "added", line: afterLine, newLineNumber });
      newLineNumber++;
    }
  }

  return compactDiff(diff);
}

function compactDiff(diff: CarrierProjectionDiffLine[], contextRadius = 3): CarrierProjectionDiffLine[] {
  const changed = new Set<number>();
  diff.forEach((line, index) => {
    if (line.type !== "context") {
      for (let i = Math.max(0, index - contextRadius); i <= Math.min(diff.length - 1, index + contextRadius); i++) {
        changed.add(i);
      }
    }
  });
  return diff.filter((line, index) => line.type !== "context" || changed.has(index)).slice(0, 300);
}

function projectPreviewContent(filename: string, before: string, patches: CarrierPatch[]): string {
  let next = before;
  for (const patch of patches) {
    const incoming = patch.content.trimEnd();
    if (!incoming.trim()) continue;

    if (filename === "self-model.md") {
      const hasManagedBlock = /<!--\s*memory-fabric:begin\b/.test(next);
      const isTemplate =
        !hasManagedBlock &&
        (next.includes("<!-- What is the agent currently trying to accomplish? -->") ||
          next.length < 200 ||
          next.includes("Not specified"));
      if (isTemplate) {
        next = patch.content;
      } else if (!next.includes(incoming)) {
        const ts = new Date().toISOString().slice(0, 10);
        next = `${next.trimEnd()}\n- [ ] ${incoming} (added: ${ts})\n`;
      }
      continue;
    }

    if (filename === "decision-log.md") {
      const headerEnd = next.indexOf("\n") + 1;
      next = `${next.slice(0, headerEnd)}\n${incoming}\n${next.slice(headerEnd)}`;
      continue;
    }

    if (filename === "entities-glossary.md") {
      const existingLines = new Set(next.split("\n").map((line) => line.trim()).filter(Boolean));
      const lines = incoming.split("\n").map((line) => line.trim()).filter((line) => line && !existingLines.has(line));
      if (lines.length > 0) next = `${next.trimEnd()}\n${lines.join("\n")}\n`;
      continue;
    }

    next = `${next.trimEnd()}\n<!-- appended: preview -->\n${incoming}\n`;
  }
  return next;
}

export class CarrierProjectionEngine {
  private readonly historyPath?: string;
  private readonly previewPath?: string;

  constructor(
    private readonly carriers: CarrierRepository,
    cfg?: SidecarConfig["openviking"]
  ) {
    if (cfg) {
      this.historyPath = join(resolveV2BaseDir(cfg), "carrier-projections", "history.jsonl");
      this.previewPath = join(resolveV2BaseDir(cfg), "carrier-projections", "previews.jsonl");
    }
  }

  async audit(opts: { agentId: string; projectId?: string; entries: MemoryEntryV2[] }): Promise<CarrierDriftReport> {
    const patches = opts.entries
      .filter(canProject)
      .map((entry) => patchFor(entry))
      .filter((patch): patch is CarrierPatch => patch !== null);
    const files = [...new Set(patches.map((patch) => patch.filename))];
    const carrierRead = await this.carriers.read({
      agentId: opts.agentId,
      projectId: opts.projectId,
      files,
    });
    const contentByFile = new Map(carrierRead.map((carrier) => [carrier.filename, carrier.content]));

    const issues: CarrierDriftIssue[] = [];
    for (const entry of opts.entries) {
      if (!canProject(entry)) continue;
      const filename = targetFile(entry);
      if (!filename) continue;
      const carrierContent = contentByFile.get(filename) ?? "";
      const hasProjection = carrierContent.includes(`memory:${entry.id}`) || carrierContent.includes(entry.content.slice(0, 60));
      if (!hasProjection) {
        issues.push({
          filename,
          memoryId: entry.id,
          type: entry.type,
          severity: entry.type === "intent" || entry.type === "profile" ? "high" : "medium",
          message: `Structured memory ${entry.id} is not represented in ${filename}`,
        });
      }
    }

    return {
      agentId: opts.agentId,
      projectId: opts.projectId,
      checkedAt: new Date().toISOString(),
      projectionVersion: PROJECTION_VERSION,
      issues,
      patches,
    };
  }

  async apply(opts: { agentId: string; projectId?: string; entries?: MemoryEntryV2[]; patches?: CarrierPatch[] }): Promise<CarrierProjectionRecord> {
    const { patches, policySkipped } = this.resolvePatches(opts);
    const files = [...new Set(patches.map((patch) => patch.filename))];
    const before = await this.carriers.read({
      agentId: opts.agentId,
      projectId: opts.projectId,
      files,
    });
    const rollbackPatches = before.map((carrier) => ({ filename: carrier.filename, content: carrier.content }));
    const mergeResult = patches.length > 0
      ? await this.carriers.merge({ agentId: opts.agentId, projectId: opts.projectId, patches })
      : { merged: [], skipped: [] };
    const appliedAt = new Date().toISOString();
    const projectionId = `proj_${createHash("sha256")
      .update(JSON.stringify({ agentId: opts.agentId, projectId: opts.projectId, patches, appliedAt }))
      .digest("hex")
      .slice(0, 12)}`;
    const record: CarrierProjectionRecord = {
      projectionId,
      agentId: opts.agentId,
      projectId: opts.projectId,
      projectionVersion: PROJECTION_VERSION,
      status: "applied",
      appliedAt,
      patches,
      rollbackPatches,
      merged: mergeResult.merged,
      skipped: [...policySkipped, ...mergeResult.skipped],
    };
    await this.appendHistory(record);
    return record;
  }

  async preview(opts: { agentId: string; projectId?: string; entries?: MemoryEntryV2[]; patches?: CarrierPatch[] }): Promise<CarrierProjectionPreviewRecord> {
    const { patches, policySkipped } = this.resolvePatches(opts);
    const files = [...new Set(patches.map((patch) => patch.filename))];
    const before = await this.carriers.read({
      agentId: opts.agentId,
      projectId: opts.projectId,
      files,
    });
    const beforeByFile = new Map(before.map((carrier) => [carrier.filename, carrier.content]));
    const rollbackPatches = before.map((carrier) => ({ filename: carrier.filename, content: carrier.content }));
    const filePreviews: CarrierProjectionFilePreview[] = [];

    for (const filename of files) {
      const beforeContent = beforeByFile.get(filename) ?? "";
      const filePatches = patches.filter((patch) => patch.filename === filename);
      const afterContent = projectPreviewContent(filename, beforeContent, filePatches);
      const diff = diffLines(beforeContent, afterContent);
      filePreviews.push({
        filename,
        before: beforeContent,
        after: afterContent,
        changed: beforeContent !== afterContent,
        additions: diff.filter((line) => line.type === "added").length,
        removals: diff.filter((line) => line.type === "removed").length,
        diff,
      });
    }

    const createdAt = new Date().toISOString();
    const previewId = `proj_preview_${createHash("sha256")
      .update(JSON.stringify({ agentId: opts.agentId, projectId: opts.projectId, patches, createdAt }))
      .digest("hex")
      .slice(0, 12)}`;
    const record: CarrierProjectionPreviewRecord = {
      previewId,
      agentId: opts.agentId,
      projectId: opts.projectId,
      projectionVersion: PROJECTION_VERSION,
      status: "preview",
      createdAt,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      patches,
      rollbackPatches,
      files: filePreviews,
      skipped: policySkipped,
      summary: {
        files: filePreviews.length,
        changedFiles: filePreviews.filter((file) => file.changed).length,
        additions: filePreviews.reduce((sum, file) => sum + file.additions, 0),
        removals: filePreviews.reduce((sum, file) => sum + file.removals, 0),
      },
    };
    await this.appendPreview(record);
    return record;
  }

  async applyPreview(opts: { previewId: string }): Promise<CarrierProjectionRecord | null> {
    const preview = (await this.readPreviews()).find((record) => record.previewId === opts.previewId);
    if (!preview) return null;
    return this.apply({
      agentId: preview.agentId,
      projectId: preview.projectId,
      patches: preview.patches,
    });
  }

  async rollback(opts: { projectionId: string }): Promise<CarrierProjectionRecord | null> {
    const records = await this.readHistory();
    const idx = records.findIndex((record) => record.projectionId === opts.projectionId);
    if (idx < 0) return null;
    const record = records[idx];
    await this.carriers.replace({
      agentId: record.agentId,
      projectId: record.projectId,
      files: record.rollbackPatches,
    });
    const updated: CarrierProjectionRecord = {
      ...record,
      status: "rolled_back",
      rolledBackAt: new Date().toISOString(),
    };
    records[idx] = updated;
    if (this.historyPath) {
      await ensureFileDir(this.historyPath);
      await writeJsonl(this.historyPath, records);
    }
    return updated;
  }

  async history(opts: { agentId?: string; projectId?: string; limit?: number } = {}): Promise<CarrierProjectionRecord[]> {
    return (await this.readHistory())
      .filter((record) => !opts.agentId || record.agentId === opts.agentId)
      .filter((record) => !opts.projectId || record.projectId === opts.projectId)
      .sort((a, b) => new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime())
      .slice(0, Math.max(1, Math.min(opts.limit ?? 50, 500)));
  }

  policy(): {
    projectionVersion: string;
    schemaWhitelist: string[];
    ownershipRules: typeof OWNERSHIP_RULES;
  } {
    return {
      projectionVersion: PROJECTION_VERSION,
      schemaWhitelist: [...SCHEMA_WHITELIST],
      ownershipRules: OWNERSHIP_RULES,
    };
  }

  private async appendHistory(record: CarrierProjectionRecord): Promise<void> {
    if (!this.historyPath) return;
    await ensureFileDir(this.historyPath);
    await appendJsonl(this.historyPath, record);
  }

  private async readHistory(): Promise<CarrierProjectionRecord[]> {
    if (!this.historyPath) return [];
    return readJsonl<CarrierProjectionRecord>(this.historyPath);
  }

  private resolvePatches(opts: { entries?: MemoryEntryV2[]; patches?: CarrierPatch[] }): { patches: CarrierPatch[]; policySkipped: string[] } {
    const rawPatches =
      opts.patches ??
      opts.entries
        ?.map((entry) => (canProject(entry) ? patchFor(entry) : null))
        .filter((patch): patch is CarrierPatch => patch !== null) ??
      [];
    const policySkipped: string[] = [];
    const patches = rawPatches.filter((patch) => {
      if (!SCHEMA_WHITELIST.has(patch.filename)) {
        policySkipped.push(`${patch.filename} (outside projection schema whitelist)`);
        return false;
      }
      if (opts.patches && !hasProjectionOwnership(patch)) {
        policySkipped.push(`${patch.filename} (missing memory-fabric projection marker)`);
        return false;
      }
      return true;
    });
    return { patches, policySkipped };
  }

  private async appendPreview(record: CarrierProjectionPreviewRecord): Promise<void> {
    if (!this.previewPath) return;
    await ensureFileDir(this.previewPath);
    await appendJsonl(this.previewPath, record);
  }

  private async readPreviews(): Promise<CarrierProjectionPreviewRecord[]> {
    if (!this.previewPath) return [];
    return readJsonl<CarrierProjectionPreviewRecord>(this.previewPath);
  }
}
