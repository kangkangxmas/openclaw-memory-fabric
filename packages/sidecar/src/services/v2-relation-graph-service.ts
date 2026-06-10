import { createHash } from "crypto";
import { join } from "path";
import type { SidecarConfig } from "../config/index.js";
import { appendJsonl, ensureFileDir, readJsonl } from "../utils/jsonl.js";
import { validateId } from "../utils/path-guard.js";
import { resolveV2BaseDir } from "../utils/v2-paths.js";

export type V2RelationType = "DECIDES" | "IMPLEMENTS" | "SUPERSEDES" | "CAUSES" | "VALIDATES" | "CONSTRAINS";
export type V2RelationNodeKind = "memory" | "event" | "project" | "carrier" | "entity";

export interface V2Relation {
  relationId: string;
  agentId: string;
  projectId?: string;
  type: V2RelationType;
  sourceKind: V2RelationNodeKind;
  sourceId: string;
  targetKind: V2RelationNodeKind;
  targetId: string;
  confidence: number;
  evidenceRefs: string[];
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface AddV2RelationInput {
  agentId: string;
  projectId?: string;
  type: V2RelationType;
  sourceKind: V2RelationNodeKind;
  sourceId: string;
  targetKind: V2RelationNodeKind;
  targetId: string;
  confidence?: number;
  evidenceRefs?: string[];
  metadata?: Record<string, unknown>;
}

export interface ListV2RelationsOptions {
  agentId?: string;
  projectId?: string;
  type?: V2RelationType;
  memoryId?: string;
  limit?: number;
}

function relationId(input: AddV2RelationInput): string {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        agentId: input.agentId,
        projectId: input.projectId,
        type: input.type,
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        targetKind: input.targetKind,
        targetId: input.targetId,
      })
    )
    .digest("hex")
    .slice(0, 16);
  return `rel_${hash}`;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export class V2RelationGraphService {
  private readonly filePath: string;

  constructor(cfg: SidecarConfig["openviking"]) {
    this.filePath = join(resolveV2BaseDir(cfg), "relation-graph", "relations.jsonl");
  }

  async add(input: AddV2RelationInput): Promise<V2Relation> {
    validateId(input.agentId, "agentId");
    if (input.projectId) validateId(input.projectId, "projectId");
    const id = relationId(input);
    const existing = (await this.list({ agentId: input.agentId, projectId: input.projectId, limit: 10_000 })).find(
      (relation) => relation.relationId === id
    );
    if (existing) return existing;

    const relation: V2Relation = {
      relationId: id,
      agentId: input.agentId,
      projectId: input.projectId,
      type: input.type,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      targetKind: input.targetKind,
      targetId: input.targetId,
      confidence: clamp(input.confidence ?? 0.7),
      evidenceRefs: input.evidenceRefs ?? [],
      createdAt: new Date().toISOString(),
      metadata: input.metadata,
    };
    await ensureFileDir(this.filePath);
    await appendJsonl(this.filePath, relation);
    return relation;
  }

  async list(opts: ListV2RelationsOptions = {}): Promise<V2Relation[]> {
    if (opts.agentId) validateId(opts.agentId, "agentId");
    if (opts.projectId) validateId(opts.projectId, "projectId");
    const relations = await readJsonl<V2Relation>(this.filePath);
    return relations
      .filter((relation) => !opts.agentId || relation.agentId === opts.agentId)
      .filter((relation) => !opts.projectId || relation.projectId === opts.projectId)
      .filter((relation) => !opts.type || relation.type === opts.type)
      .filter((relation) => !opts.memoryId || relation.sourceId === opts.memoryId || relation.targetId === opts.memoryId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, Math.max(1, Math.min(opts.limit ?? 100, 10_000)));
  }
}
