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

const PROJECTION_VERSION = "v2.0";
const SCHEMA_WHITELIST = new Set(["self-model.md", "decision-log.md", "execution-journal.md", "entities-glossary.md"]);

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

function patchFor(entry: MemoryEntryV2): CarrierPatch | null {
  const filename = targetFile(entry);
  if (!filename) return null;
  const sourceRefs = entry.sourceRefs?.length ? `\n**Sources:** ${entry.sourceRefs.join(", ")}` : "";
  const projection = `<!-- memory-fabric projection:${PROJECTION_VERSION} memory:${entry.id} -->`;

  if (filename === "decision-log.md") {
    return {
      filename,
      content: `## ${entry.timeline.createdAt.slice(0, 10)}: ${entry.content.slice(0, 70)}\n**Decision:** ${entry.content}${sourceRefs}\n${projection}\n`,
    };
  }
  if (filename === "entities-glossary.md") {
    return {
      filename,
      content: `- **${entry.content.slice(0, 80)}**: projected from ${entry.id}${entry.sourceRefs?.length ? ` (sources: ${entry.sourceRefs.join(", ")})` : ""}`,
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

export class CarrierProjectionEngine {
  private readonly historyPath?: string;

  constructor(
    private readonly carriers: CarrierRepository,
    cfg?: SidecarConfig["openviking"]
  ) {
    if (cfg) {
      this.historyPath = join(resolveV2BaseDir(cfg), "carrier-projections", "history.jsonl");
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
    const patches = (opts.patches ?? opts.entries?.map((entry) => (canProject(entry) ? patchFor(entry) : null)).filter((patch): patch is CarrierPatch => patch !== null) ?? [])
      .filter((patch) => SCHEMA_WHITELIST.has(patch.filename));
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
      skipped: mergeResult.skipped,
    };
    await this.appendHistory(record);
    return record;
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

  private async appendHistory(record: CarrierProjectionRecord): Promise<void> {
    if (!this.historyPath) return;
    await ensureFileDir(this.historyPath);
    await appendJsonl(this.historyPath, record);
  }

  private async readHistory(): Promise<CarrierProjectionRecord[]> {
    if (!this.historyPath) return [];
    return readJsonl<CarrierProjectionRecord>(this.historyPath);
  }
}
