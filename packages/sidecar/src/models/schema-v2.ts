/**
 * Schema V2 - Enhanced Memory Entry
 * 
 * 扩展支持：
 * - 多模态内容（代码片段、结构化数据）
 * - 时间线信息（有效期、更新时间、版本）
 * - 关联图谱（相关记忆 ID、来源追踪）
 * - 向量嵌入（embedding 缓存）
 */

// ---------------------------------------------------------------------------
// Base Types
// ---------------------------------------------------------------------------

export type MemoryType = "fact" | "decision" | "entity" | "pattern" | "unresolved" | "code" | "api" | "lesson";
export type MemoryScope = "private" | "project" | "shared";
export type Visibility = "private" | "project_shared" | "org_shared";
export type ContentFormat = "text" | "code" | "json" | "markdown" | "url";

// ---------------------------------------------------------------------------
// Content Block - 多模态内容支持
// ---------------------------------------------------------------------------

export interface ContentBlock {
  /** 内容格式 */
  format: ContentFormat;
  /** 实际内容 */
  content: string;
  /** 代码语言（仅 code 格式） */
  language?: string;
  /** 内容摘要（用于检索） */
  summary?: string;
  /** 字符数统计 */
  charCount?: number;
}

// ---------------------------------------------------------------------------
// Timeline - 时间线信息
// ---------------------------------------------------------------------------

export interface MemoryTimeline {
  /** 创建时间 ISO 8601 */
  createdAt: string;
  /** 最后更新时间 ISO 8601 */
  updatedAt: string;
  /** 过期时间（可选） */
  expiresAt?: string;
  /** 版本号（乐观锁） */
  version: number;
  /** 时间衰减因子（0-1，由生命周期服务计算） */
  decayFactor?: number;
}

// ---------------------------------------------------------------------------
// Relation - 关联图谱
// ---------------------------------------------------------------------------

export interface MemoryRelation {
  /** 关联类型 */
  type: "related" | "parent" | "child" | "supersedes" | "derived_from" | "contradicts";
  /** 关联目标记忆 ID */
  targetId: string;
  /** 关联强度（0-1） */
  strength: number;
  /** 关联说明 */
  description?: string;
}

// ---------------------------------------------------------------------------
// Source - 来源追踪
// ---------------------------------------------------------------------------

export interface MemorySource {
  /** 来源类型 */
  type: "session" | "document" | "code" | "external" | "imported";
  /** 来源标识（如 session ID、文件路径） */
  identifier: string;
  /** 来源上下文（如代码行号、文档章节） */
  context?: string;
  /** 来源时间 */
  timestamp: string;
  /** 来源 Agent ID（跨 Agent 共享时） */
  agentId?: string;
  /** 置信度（0-1） */
  confidence?: number;
}

// ---------------------------------------------------------------------------
// Embedding - 向量嵌入
// ---------------------------------------------------------------------------

export interface MemoryEmbedding {
  /** 向量模型名称 */
  model: string;
  /** 向量维度 */
  dimensions: number;
  /** 向量数据（Base64 编码或 Float32Array） */
  vector: number[];
  /** 生成时间 */
  generatedAt: string;
  /** 向量版本（模型变更时更新） */
  version: string;
}

// ---------------------------------------------------------------------------
// Metadata - 扩展元数据
// ---------------------------------------------------------------------------

export interface MemoryMetadata {
  /** 标签列表 */
  tags: string[];
  /** 任务类型（用于动态模板） */
  taskType?: string;
  /** 领域/分类 */
  domain?: string;
  /** 优先级（0-10） */
  priority?: number;
  /** 访问计数（用于热度排序） */
  accessCount?: number;
  /** 最后访问时间 */
  lastAccessedAt?: string;
  /** 自定义属性 */
  custom?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Memory Entry V2 - 完整记忆条目
// ---------------------------------------------------------------------------

export interface MemoryEntryV2 {
  /** 唯一标识 */
  id: string;
  /** 记忆类型 */
  type: MemoryType;
  /** 主内容（向后兼容） */
  content: string;
  /** 多模态内容块（可选） */
  blocks?: ContentBlock[];
  /** Agent ID */
  agentId: string;
  /** 项目 ID */
  projectId?: string;
  /** 作用域 */
  scope: MemoryScope;
  /** 可见性 */
  visibility: Visibility;
  /** 时间线 */
  timeline: MemoryTimeline;
  /** 关联图谱 */
  relations?: MemoryRelation[];
  /** 来源追踪 */
  sources?: MemorySource[];
  /** 向量嵌入 */
  embedding?: MemoryEmbedding;
  /** 元数据 */
  metadata: MemoryMetadata;
}

// ---------------------------------------------------------------------------
// Migration Helpers
// ---------------------------------------------------------------------------

/** V1 Entry（旧格式，用于迁移） */
export interface MemoryEntryV1 {
  id: string;
  type: "fact" | "decision" | "entity" | "pattern" | "unresolved";
  content: string;
  agentId: string;
  projectId?: string;
  scope: MemoryScope;
  visibility: Visibility;
  createdAt: string;
  tags: string[];
}

/**
 * 将 V1 条目迁移为 V2
 */
export function migrateV1ToV2(v1: MemoryEntryV1): MemoryEntryV2 {
  return {
    id: v1.id,
    type: v1.type,
    content: v1.content,
    agentId: v1.agentId,
    projectId: v1.projectId,
    scope: v1.scope,
    visibility: v1.visibility,
    timeline: {
      createdAt: v1.createdAt,
      updatedAt: v1.createdAt,
      version: 1
    },
    metadata: {
      tags: v1.tags || []
    }
  };
}

/**
 * 将 V2 条目降级为 V1（用于向后兼容）
 */
export function downgradeV2ToV1(v2: MemoryEntryV2): MemoryEntryV1 {
  return {
    id: v2.id,
    type: v2.type as MemoryEntryV1["type"],
    content: v2.content,
    agentId: v2.agentId,
    projectId: v2.projectId,
    scope: v2.scope,
    visibility: v2.visibility,
    createdAt: v2.timeline.createdAt,
    tags: v2.metadata.tags || []
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateMemoryEntryV2(entry: unknown): entry is MemoryEntryV2 {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Partial<MemoryEntryV2>;
  
  return (
    typeof e.id === "string" &&
    typeof e.type === "string" &&
    typeof e.content === "string" &&
    typeof e.agentId === "string" &&
    typeof e.scope === "string" &&
    typeof e.visibility === "string" &&
    e.timeline !== undefined &&
    typeof e.timeline.createdAt === "string" &&
    typeof e.timeline.updatedAt === "string" &&
    typeof e.timeline.version === "number" &&
    e.metadata !== undefined &&
    Array.isArray(e.metadata.tags)
  );
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export class MemoryEntryBuilder {
  private entry: Partial<MemoryEntryV2> = {
    metadata: { tags: [] }
  };

  id(id: string): this {
    this.entry.id = id;
    return this;
  }

  type(type: MemoryType): this {
    this.entry.type = type;
    return this;
  }

  content(content: string): this {
    this.entry.content = content;
    return this;
  }

  block(format: ContentFormat, content: string, language?: string): this {
    if (!this.entry.blocks) this.entry.blocks = [];
    this.entry.blocks.push({ format, content, language });
    return this;
  }

  agentId(agentId: string): this {
    this.entry.agentId = agentId;
    return this;
  }

  projectId(projectId?: string): this {
    this.entry.projectId = projectId;
    return this;
  }

  scope(scope: MemoryScope): this {
    this.entry.scope = scope;
    return this;
  }

  visibility(visibility: Visibility): this {
    this.entry.visibility = visibility;
    return this;
  }

  timeline(timeline: Partial<MemoryTimeline>): this {
    this.entry.timeline = { ...this.entry.timeline, ...timeline } as MemoryTimeline;
    return this;
  }

  relation(relation: MemoryRelation): this {
    if (!this.entry.relations) this.entry.relations = [];
    this.entry.relations.push(relation);
    return this;
  }

  source(source: MemorySource): this {
    if (!this.entry.sources) this.entry.sources = [];
    this.entry.sources.push(source);
    return this;
  }

  embedding(embedding: MemoryEmbedding): this {
    this.entry.embedding = embedding;
    return this;
  }

  metadata(metadata: Partial<MemoryMetadata>): this {
    this.entry.metadata = { ...this.entry.metadata, ...metadata } as MemoryMetadata;
    return this;
  }

  tag(tag: string): this {
    if (!this.entry.metadata) this.entry.metadata = { tags: [] };
    if (!this.entry.metadata.tags) this.entry.metadata.tags = [];
    this.entry.metadata.tags.push(tag);
    return this;
  }

  build(): MemoryEntryV2 {
    if (!this.entry.id) throw new Error("MemoryEntryV2 requires id");
    if (!this.entry.type) throw new Error("MemoryEntryV2 requires type");
    if (!this.entry.content) throw new Error("MemoryEntryV2 requires content");
    if (!this.entry.agentId) throw new Error("MemoryEntryV2 requires agentId");
    if (!this.entry.scope) throw new Error("MemoryEntryV2 requires scope");
    if (!this.entry.visibility) throw new Error("MemoryEntryV2 requires visibility");
    if (!this.entry.timeline?.createdAt) {
      const now = new Date().toISOString();
      this.entry.timeline = {
        ...this.entry.timeline,
        createdAt: now,
        updatedAt: now,
        version: this.entry.timeline?.version ?? 1
      } as MemoryTimeline;
    }
    if (!this.entry.metadata) {
      this.entry.metadata = { tags: [] };
    }

    return this.entry as MemoryEntryV2;
  }
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * 生成唯一记忆 ID
 */
export function generateMemoryId(): string {
  return `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 计算记忆年龄（天数）
 */
export function getMemoryAgeDays(entry: MemoryEntryV2): number {
  const created = new Date(entry.timeline.createdAt).getTime();
  const now = Date.now();
  return (now - created) / (1000 * 60 * 60 * 24);
}

/**
 * 检查记忆是否过期
 */
export function isMemoryExpired(entry: MemoryEntryV2): boolean {
  if (!entry.timeline.expiresAt) return false;
  return new Date(entry.timeline.expiresAt).getTime() < Date.now();
}

/**
 * 获取记忆的所有文本内容（用于检索）
 */
export function getMemoryText(entry: MemoryEntryV2): string {
  const parts: string[] = [entry.content];
  if (entry.blocks) {
    for (const block of entry.blocks) {
      parts.push(block.summary || block.content);
    }
  }
  return parts.join("\n");
}

/**
 * 更新记忆访问统计
 */
export function touchMemory(entry: MemoryEntryV2): MemoryEntryV2 {
  return {
    ...entry,
    timeline: {
      ...entry.timeline,
      updatedAt: new Date().toISOString(),
      version: entry.timeline.version + 1
    },
    metadata: {
      ...entry.metadata,
      accessCount: (entry.metadata.accessCount || 0) + 1,
      lastAccessedAt: new Date().toISOString()
    }
  };
}
