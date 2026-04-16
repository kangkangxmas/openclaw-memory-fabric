import { createRequire } from "module";
import { defaultConfig } from "./defaults.js";
import type { MemoryFabricConfig } from "../types/index.js";

// ajv and ajv-formats ship CJS without ESM `exports`. Use createRequire to
// avoid moduleResolution: NodeNext constructability issues.
const require = createRequire(import.meta.url);
const AjvCtor = require("ajv") as {
  new (opts: { allErrors: boolean; useDefaults: boolean }): {
    compile: (schema: object) => (data: unknown) => boolean & {
      errors?: Array<{ instancePath: string; schemaPath: string; message?: string }> | null;
    };
  };
};
const addFormats = require("ajv-formats") as (ajv: unknown) => void;

const ajv = new AjvCtor({ allErrors: true, useDefaults: true });
addFormats(ajv);

const configSchemaJson = {
  type: "object",
  required: [
    "defaultScope",
    "recallBudget",
    "sidecar",
    "openviking",
    "graphify",
    "publishPolicy",
    "observability"
  ],
  additionalProperties: false,
  properties: {
    defaultScope: { type: "string", enum: ["private", "project", "shared", "auto"] },
    recallBudget: {
      type: "object",
      required: ["l0Tokens", "l1Tokens", "l2Tokens"],
      additionalProperties: false,
      properties: {
        l0Tokens: { type: "number", minimum: 1 },
        l1Tokens: { type: "number", minimum: 1 },
        l2Tokens: { type: "number", minimum: 1 }
      }
    },
    sidecar: {
      type: "object",
      required: ["baseUrl", "timeoutMs"],
      additionalProperties: false,
      properties: {
        baseUrl: { type: "string", minLength: 1 },
        timeoutMs: { type: "number", minimum: 1000 }
      }
    },
    openviking: {
      type: "object",
      required: ["mode", "basePath", "targetRoot"],
      additionalProperties: false,
      properties: {
        mode: { type: "string", enum: ["local", "remote"] },
        basePath: { type: "string", minLength: 1 },
        targetRoot: { type: "string", minLength: 1 }
      }
    },
    graphify: {
      type: "object",
      required: ["basePath", "autoBootstrap", "autoRefresh"],
      additionalProperties: false,
      properties: {
        basePath: { type: "string", minLength: 1 },
        autoBootstrap: { type: "boolean" },
        autoRefresh: { type: "string", enum: ["manual", "on-demand", "scheduled"] }
      }
    },
    publishPolicy: {
      type: "object",
      required: ["defaultVisibility", "allowOrgShared"],
      additionalProperties: false,
      properties: {
        defaultVisibility: { type: "string", enum: ["private", "project_shared", "org_shared"] },
        allowOrgShared: { type: "boolean" }
      }
    },
    observability: {
      type: "object",
      required: ["logLevel", "emitMetrics"],
      additionalProperties: false,
      properties: {
        logLevel: { type: "string", enum: ["debug", "info", "warn", "error"] },
        emitMetrics: { type: "boolean" }
      }
    }
  }
} as const;

type ValidateError = { instancePath: string; schemaPath: string; message?: string };
type ValidateFn = ((data: unknown) => boolean) & { errors?: ValidateError[] | null };
const validate = ajv.compile(configSchemaJson) as unknown as ValidateFn;

export class ConfigValidationError extends Error {
  constructor(public readonly validationErrors: string[]) {
    super(`MemoryFabricConfig validation failed:\n${validationErrors.join("\n")}`);
    this.name = "ConfigValidationError";
  }
}

/**
 * Merges user-supplied partial config with defaults and validates the result.
 * Throws ConfigValidationError if the merged config does not satisfy the schema.
 */
export function loadConfig(userConfig?: Partial<MemoryFabricConfig>): MemoryFabricConfig {
  const merged: MemoryFabricConfig = {
    ...defaultConfig,
    ...userConfig,
    sidecar: { ...defaultConfig.sidecar, ...userConfig?.sidecar },
    openviking: { ...defaultConfig.openviking, ...userConfig?.openviking },
    graphify: { ...defaultConfig.graphify, ...userConfig?.graphify },
    publishPolicy: { ...defaultConfig.publishPolicy, ...userConfig?.publishPolicy },
    observability: { ...defaultConfig.observability, ...userConfig?.observability },
    recallBudget: { ...defaultConfig.recallBudget, ...userConfig?.recallBudget }
  };

  const valid = validate(merged);

  if (!valid) {
    const messages = (validate.errors ?? []).map((e: ValidateError) => {
      const field = e.instancePath || e.schemaPath;
      return `  ${field}: ${e.message ?? "invalid value"}`;
    });
    throw new ConfigValidationError(messages);
  }

  return merged;
}
