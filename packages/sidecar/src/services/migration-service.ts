/**
 * Migration Service - Schema V1 → V2 迁移
 * 
 * 功能：
 * - 自动检测并迁移旧格式记忆条目
 * - 支持增量迁移（只迁移未迁移的）
 * - 迁移后保留原始备份
 * - 提供迁移状态报告
 */

import { readFile, writeFile, rename, access } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { readJsonl, writeJsonl, ensureDir } from "../utils/jsonl.js";
import {
  type MemoryEntryV1,
  type MemoryEntryV2,
  migrateV1ToV2,
  validateMemoryEntryV2,
  generateMemoryId
} from "../models/schema-v2.js";
import type { SidecarConfig } from "../config/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MigrationStatus {
  /** 是否已完成迁移 */
  migrated: boolean;
  /** 迁移版本 */
  version: number;
  /** 迁移时间 */
  migratedAt?: string;
  /** 总条目数 */
  totalEntries: number;
  /** 已迁移数 */
  migratedCount: number;
  /** 失败数 */
  failedCount: number;
}

export interface MigrationResult {
  /** 迁移的文件路径 */
  filePath: string;
  /** 备份路径 */
  backupPath: string;
  /** 迁移状态 */
  status: MigrationStatus;
  /** 错误信息 */
  errors?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIGRATION_VERSION = 2;
const MIGRATION_MARKER = ".migration-v2";
const BACKUP_SUFFIX = ".v1-backup";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 检测条目是否为 V1 格式
 */
function isV1Entry(entry: unknown): entry is MemoryEntryV1 {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Partial<MemoryEntryV1>;
  return (
    typeof e.id === "string" &&
    typeof e.type === "string" &&
    typeof e.content === "string" &&
    typeof e.agentId === "string" &&
    typeof e.scope === "string" &&
    typeof e.visibility === "string" &&
    typeof e.createdAt === "string" &&
    Array.isArray(e.tags) &&
    !("timeline" in e) // V2 有 timeline 字段
  );
}

/**
 * 检测条目是否为 V2 格式
 */
function isV2Entry(entry: unknown): boolean {
  return validateMemoryEntryV2(entry);
}

/**
 * 读取迁移标记文件
 */
async function readMigrationMarker(dir: string): Promise<MigrationStatus | null> {
  const markerPath = join(dir, MIGRATION_MARKER);
  try {
    const raw = await readFile(markerPath, "utf8");
    return JSON.parse(raw) as MigrationStatus;
  } catch {
    return null;
  }
}

/**
 * 写入迁移标记文件
 */
async function writeMigrationMarker(dir: string, status: MigrationStatus): Promise<void> {
  const markerPath = join(dir, MIGRATION_MARKER);
  await writeFile(markerPath, JSON.stringify(status, null, 2));
}

// ---------------------------------------------------------------------------
// Migration Service
// ---------------------------------------------------------------------------

export class MigrationService {
  constructor(private readonly cfg: SidecarConfig["openviking"]) {}

  /**
   * 检查指定目录是否需要迁移
   */
  async needsMigration(dir: string): Promise<boolean> {
    const memoriesPath = join(dir, "memories.jsonl");
    if (!existsSync(memoriesPath)) return false;

    const marker = await readMigrationMarker(dir);
    if (marker && marker.migrated && marker.version >= MIGRATION_VERSION) {
      return false;
    }

    // 检查是否有 V1 格式的条目
    const entries = await readJsonl<unknown>(memoriesPath);
    return entries.some(isV1Entry);
  }

  /**
   * 迁移单个 memories.jsonl 文件
   */
  async migrateFile(filePath: string): Promise<MigrationResult> {
    const dir = dirname(filePath);
    const backupPath = `${filePath}${BACKUP_SUFFIX}`;
    const errors: string[] = [];

    // 1. 读取现有条目
    const entries = await readJsonl<unknown>(filePath);
    const v2Entries: MemoryEntryV2[] = [];
    let migratedCount = 0;
    let failedCount = 0;

    for (const entry of entries) {
      if (isV2Entry(entry)) {
        // 已经是 V2，保留
        v2Entries.push(entry as MemoryEntryV2);
      } else if (isV1Entry(entry)) {
        // 需要迁移
        try {
          const v2 = migrateV1ToV2(entry);
          v2Entries.push(v2);
          migratedCount++;
        } catch (err) {
          failedCount++;
          errors.push(`Failed to migrate entry ${entry.id}: ${err}`);
          // 保留原始条目（降级为文本）
          v2Entries.push({
            id: entry.id || generateMemoryId(),
            type: "fact",
            content: JSON.stringify(entry),
            agentId: entry.agentId || "unknown",
            scope: entry.scope || "project",
            visibility: entry.visibility || "private",
            timeline: {
              createdAt: entry.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              version: 1
            },
            metadata: {
              tags: ["migration-failed", ...(entry.tags || [])]
            }
          });
        }
      } else {
        // 未知格式，作为原始文本保留
        failedCount++;
        errors.push(`Unknown entry format: ${JSON.stringify(entry).slice(0, 100)}`);
        v2Entries.push({
          id: generateMemoryId(),
          type: "fact",
          content: JSON.stringify(entry),
          agentId: "unknown",
          scope: "project",
          visibility: "private",
          timeline: {
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1
          },
          metadata: {
            tags: ["unknown-format"]
          }
        });
      }
    }

    // 2. 创建备份
    if (existsSync(filePath)) {
      await rename(filePath, backupPath);
    }

    // 3. 写入 V2 格式
    await writeJsonl(filePath, v2Entries);

    // 4. 写入迁移标记
    const status: MigrationStatus = {
      migrated: true,
      version: MIGRATION_VERSION,
      migratedAt: new Date().toISOString(),
      totalEntries: entries.length,
      migratedCount,
      failedCount
    };
    await writeMigrationMarker(dir, status);

    return {
      filePath,
      backupPath,
      status,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * 迁移指定作用域的所有记忆文件
   */
  async migrateScope(opts: {
    agentId: string;
    scope: "private" | "project" | "shared";
    projectId?: string;
  }): Promise<MigrationResult[]> {
    const { agentId, scope, projectId } = opts;
    const results: MigrationResult[] = [];

    // 构建路径（使用 openviking-adapter 的逻辑）
    const { resolveScopePath } = await import("../adapters/openviking-adapter.js");
    const dir = resolveScopePath({
      basePath: this.cfg.basePath,
      targetRoot: this.cfg.targetRoot,
      agentId,
      scope,
      projectId
    });

    const memoriesPath = join(dir, "memories.jsonl");
    if (!existsSync(memoriesPath)) {
      return results;
    }

    if (await this.needsMigration(dir)) {
      const result = await this.migrateFile(memoriesPath);
      results.push(result);
    }

    return results;
  }

  /**
   * 迁移所有 Agent 的所有作用域
   */
  async migrateAll(): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];
    const basePath = this.cfg.basePath;

    // 扫描所有 agent 目录
    const { readdir } = await import("fs/promises");
    const agentsDir = join(basePath, "org", "default", "agents");
    
    if (!existsSync(agentsDir)) {
      return results;
    }

    const agentDirs = await readdir(agentsDir, { withFileTypes: true });
    
    for (const agentDir of agentDirs) {
      if (!agentDir.isDirectory()) continue;
      
      const agentId = agentDir.name;
      
      // 迁移 private 作用域
      const privateResults = await this.migrateScope({ agentId, scope: "private" });
      results.push(...privateResults);

      // 迁移 project 作用域（扫描所有项目）
      const projectsDir = join(agentsDir, agentId, "projects");
      if (existsSync(projectsDir)) {
        const projectDirs = await readdir(projectsDir, { withFileTypes: true });
        for (const projectDir of projectDirs) {
          if (!projectDir.isDirectory()) continue;
          const projectResults = await this.migrateScope({
            agentId,
            scope: "project",
            projectId: projectDir.name
          });
          results.push(...projectResults);
        }
      }
    }

    return results;
  }

  /**
   * 获取迁移状态报告
   */
  async getMigrationReport(): Promise<{
    totalFiles: number;
    migratedFiles: number;
    pendingFiles: number;
    totalEntries: number;
    migratedEntries: number;
    failedEntries: number;
  }> {
    const results = await this.migrateAll();
    
    return {
      totalFiles: results.length,
      migratedFiles: results.filter(r => r.status.migrated).length,
      pendingFiles: results.filter(r => !r.status.migrated).length,
      totalEntries: results.reduce((sum, r) => sum + r.status.totalEntries, 0),
      migratedEntries: results.reduce((sum, r) => sum + r.status.migratedCount, 0),
      failedEntries: results.reduce((sum, r) => sum + r.status.failedCount, 0)
    };
  }

  /**
   * 回滚迁移（从备份恢复）
   */
  async rollback(filePath: string): Promise<boolean> {
    const backupPath = `${filePath}${BACKUP_SUFFIX}`;
    if (!existsSync(backupPath)) {
      return false;
    }

    try {
      await rename(backupPath, filePath);
      // 删除迁移标记
      const dir = dirname(filePath);
      const markerPath = join(dir, MIGRATION_MARKER);
      if (existsSync(markerPath)) {
        const { unlink } = await import("fs/promises");
        await unlink(markerPath);
      }
      return true;
    } catch {
      return false;
    }
  }
}
