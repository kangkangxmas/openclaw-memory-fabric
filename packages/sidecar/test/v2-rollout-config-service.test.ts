import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "./test-helpers.js";
import { V2RolloutConfigService } from "../src/services/v2-rollout-config-service.js";

describe("V2RolloutConfigService", () => {
  let tmpDir: string;
  let service: V2RolloutConfigService;
  let previousMode: string | undefined;
  let previousOffAgents: string | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "v2-rollout-"));
    previousMode = process.env.MEMORY_FABRIC_V2_MODE;
    previousOffAgents = process.env.MEMORY_FABRIC_V2_OFF_AGENT_IDS;
    delete process.env.MEMORY_FABRIC_V2_OFF_AGENT_IDS;
    process.env.MEMORY_FABRIC_V2_MODE = "shadow";
    service = new V2RolloutConfigService({
      mode: "local",
      basePath: tmpDir,
      targetRoot: "viking://org/test",
    });
  });

  afterEach(async () => {
    if (previousMode === undefined) delete process.env.MEMORY_FABRIC_V2_MODE;
    else process.env.MEMORY_FABRIC_V2_MODE = previousMode;
    if (previousOffAgents === undefined) delete process.env.MEMORY_FABRIC_V2_OFF_AGENT_IDS;
    else process.env.MEMORY_FABRIC_V2_OFF_AGENT_IDS = previousOffAgents;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("sets and resolves a runtime override for one agent/project", async () => {
    await service.setMode({
      agentId: "product",
      projectId: "Product",
      mode: "v2-write",
      updatedBy: "test",
      reason: "canary",
    });

    const effective = await service.resolveMode("product", "Product");
    expect(effective.mode).toBe("v2-write");
    expect(effective.source).toBe("runtime_override");
    expect(effective.baseMode).toBe("shadow");
    expect(effective.canRollback).toBe(true);
  });

  it("rolls back to the previous environment-backed mode", async () => {
    await service.setMode({ agentId: "product", projectId: "Product", mode: "v2-write" });
    const rolledBack = await service.rollback({ agentId: "product", projectId: "Product" });

    expect(rolledBack.mode).toBe("shadow");
    expect(rolledBack.source).toBe("env_global");
    expect(rolledBack.canRollback).toBe(false);
  });

  it("keeps env off allowlist as the highest-priority emergency stop", async () => {
    await service.setMode({ agentId: "product", projectId: "Product", mode: "v2-write" });
    process.env.MEMORY_FABRIC_V2_OFF_AGENT_IDS = "product";

    const effective = await service.resolveMode("product", "Product");
    expect(effective.mode).toBe("off");
    expect(effective.source).toBe("env_agent_off");
    expect(effective.canRollback).toBe(false);
  });
});
