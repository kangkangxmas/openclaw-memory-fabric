import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { SidecarConfig } from "../config/index.js";
import { appendJsonl, ensureFileDir } from "../utils/jsonl.js";
import { validateId } from "../utils/path-guard.js";
import { resolveV2BaseDir } from "../utils/v2-paths.js";
import { parseV2Mode, resolveV2ModeFromEnv, type V2Mode, type V2ModeSource } from "../utils/v2-mode.js";

export type V2RolloutModeSource = V2ModeSource | "runtime_override";

export interface V2RolloutOverride {
  agentId: string;
  projectId?: string;
  mode: V2Mode;
  previousMode?: V2Mode;
  previousSource?: V2RolloutModeSource;
  updatedAt: string;
  updatedBy: string;
  reason?: string;
}

export interface V2RolloutResolvedMode {
  agentId: string;
  projectId?: string;
  mode: V2Mode;
  source: V2RolloutModeSource;
  baseMode: V2Mode;
  baseSource: V2ModeSource;
  override?: V2RolloutOverride;
  canRollback: boolean;
  updatedAt?: string;
  updatedBy?: string;
  reason?: string;
}

export interface V2RolloutChangeRecord {
  action: "set" | "rollback";
  agentId: string;
  projectId?: string;
  fromMode: V2Mode;
  fromSource: V2RolloutModeSource;
  toMode: V2Mode;
  toSource: V2RolloutModeSource;
  changedAt: string;
  changedBy: string;
  reason?: string;
}

export interface V2RolloutConfigFile {
  version: 1;
  overrides: Record<string, V2RolloutOverride>;
}

export interface SetV2RolloutModeInput {
  agentId: string;
  projectId?: string;
  mode: V2Mode;
  updatedBy?: string;
  reason?: string;
}

export interface RollbackV2RolloutModeInput {
  agentId: string;
  projectId?: string;
  updatedBy?: string;
  reason?: string;
}

function scopeKey(agentId: string, projectId?: string): string {
  return projectId ? `${agentId}::${projectId}` : `${agentId}::`;
}

function validateScope(agentId: string, projectId?: string): void {
  validateId(agentId, "agentId");
  if (projectId) validateId(projectId, "projectId");
}

function normalizeMode(mode: V2Mode): V2Mode {
  return parseV2Mode(mode, "shadow");
}

export class V2RolloutConfigService {
  private readonly configPath: string;
  private readonly historyPath: string;

  constructor(cfg: SidecarConfig["openviking"]) {
    const root = join(resolveV2BaseDir(cfg), "rollout");
    this.configPath = join(root, "config.json");
    this.historyPath = join(root, "history.jsonl");
  }

  async resolveMode(agentId: string, projectId?: string): Promise<V2RolloutResolvedMode> {
    validateScope(agentId, projectId);
    const base = resolveV2ModeFromEnv(agentId);

    if (base.source === "env_agent_off") {
      return {
        agentId,
        projectId,
        mode: "off",
        source: base.source,
        baseMode: base.mode,
        baseSource: base.source,
        canRollback: false,
      };
    }

    const cfg = await this.readConfig();
    const scopedOverride = projectId ? cfg.overrides[scopeKey(agentId, projectId)] : undefined;
    const agentOverride = cfg.overrides[scopeKey(agentId)];
    const override = scopedOverride ?? agentOverride;

    if (override) {
      return {
        agentId,
        projectId,
        mode: override.mode,
        source: "runtime_override",
        baseMode: base.mode,
        baseSource: base.source,
        override,
        canRollback: override.previousMode !== undefined || override.previousSource !== undefined,
        updatedAt: override.updatedAt,
        updatedBy: override.updatedBy,
        reason: override.reason,
      };
    }

    return {
      agentId,
      projectId,
      mode: base.mode,
      source: base.source,
      baseMode: base.mode,
      baseSource: base.source,
      canRollback: false,
    };
  }

  async listOverrides(): Promise<V2RolloutOverride[]> {
    const cfg = await this.readConfig();
    return Object.values(cfg.overrides).sort((a, b) => a.agentId.localeCompare(b.agentId) || (a.projectId ?? "").localeCompare(b.projectId ?? ""));
  }

  async setMode(input: SetV2RolloutModeInput): Promise<V2RolloutResolvedMode> {
    validateScope(input.agentId, input.projectId);
    const current = await this.resolveMode(input.agentId, input.projectId);
    const mode = normalizeMode(input.mode);
    const now = new Date().toISOString();
    const cfg = await this.readConfig();
    const key = scopeKey(input.agentId, input.projectId);

    cfg.overrides[key] = {
      agentId: input.agentId,
      projectId: input.projectId,
      mode,
      previousMode: current.mode,
      previousSource: current.source,
      updatedAt: now,
      updatedBy: input.updatedBy ?? "inspector",
      reason: input.reason,
    };

    await this.writeConfig(cfg);
    await this.appendHistory({
      action: "set",
      agentId: input.agentId,
      projectId: input.projectId,
      fromMode: current.mode,
      fromSource: current.source,
      toMode: mode,
      toSource: "runtime_override",
      changedAt: now,
      changedBy: input.updatedBy ?? "inspector",
      reason: input.reason,
    });

    return this.resolveMode(input.agentId, input.projectId);
  }

  async rollback(input: RollbackV2RolloutModeInput): Promise<V2RolloutResolvedMode> {
    validateScope(input.agentId, input.projectId);
    const cfg = await this.readConfig();
    const key = scopeKey(input.agentId, input.projectId);
    const override = cfg.overrides[key];
    const current = await this.resolveMode(input.agentId, input.projectId);

    if (!override) return current;

    const now = new Date().toISOString();
    const changedBy = input.updatedBy ?? "inspector";
    const reason = input.reason ?? "rollback";

    if (override.previousSource && override.previousSource !== "runtime_override") {
      delete cfg.overrides[key];
      await this.writeConfig(cfg);
      await this.appendHistory({
        action: "rollback",
        agentId: input.agentId,
        projectId: input.projectId,
        fromMode: current.mode,
        fromSource: current.source,
        toMode: override.previousMode ?? current.baseMode,
        toSource: override.previousSource,
        changedAt: now,
        changedBy,
        reason,
      });
      return this.resolveMode(input.agentId, input.projectId);
    }

    const nextMode = override.previousMode ?? current.baseMode;
    cfg.overrides[key] = {
      agentId: input.agentId,
      projectId: input.projectId,
      mode: nextMode,
      previousMode: current.mode,
      previousSource: current.source,
      updatedAt: now,
      updatedBy: changedBy,
      reason,
    };
    await this.writeConfig(cfg);
    await this.appendHistory({
      action: "rollback",
      agentId: input.agentId,
      projectId: input.projectId,
      fromMode: current.mode,
      fromSource: current.source,
      toMode: nextMode,
      toSource: "runtime_override",
      changedAt: now,
      changedBy,
      reason,
    });
    return this.resolveMode(input.agentId, input.projectId);
  }

  private async readConfig(): Promise<V2RolloutConfigFile> {
    if (!existsSync(this.configPath)) return { version: 1, overrides: {} };
    const raw = await readFile(this.configPath, "utf8");
    const parsed = JSON.parse(raw) as V2RolloutConfigFile;
    return {
      version: 1,
      overrides: parsed.overrides ?? {},
    };
  }

  private async writeConfig(cfg: V2RolloutConfigFile): Promise<void> {
    await ensureFileDir(this.configPath);
    await writeFile(this.configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  }

  private async appendHistory(record: V2RolloutChangeRecord): Promise<void> {
    await ensureFileDir(this.historyPath);
    await appendJsonl(this.historyPath, record);
  }
}
