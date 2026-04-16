import { access, constants } from "fs/promises";
import type { FastifyInstance } from "fastify";
import type { SidecarConfig } from "../config/index.js";

const startTime = Date.now();

async function isReadable(p: string): Promise<boolean> {
  try {
    await access(p, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function isWritable(p: string): Promise<boolean> {
  try {
    await access(p, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function registerHealthRoute(app: FastifyInstance, cfg: SidecarConfig): void {
  app.get("/health", async () => {
    const [ovReadable, graphReadable, carriersWritable] = await Promise.all([
      isReadable(cfg.openviking.basePath),
      isReadable(cfg.graphify.basePath),
      isWritable(cfg.carriers.root)
    ]);

    // ok=true means the sidecar itself is running; component flags give deeper status
    const ok = true;

    return {
      ok,
      service: "@openclaw-memory-fabric/sidecar",
      version: "1.6.0",
      phase: "phase-14-gap-closure",
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      lastRefreshTime: new Date().toISOString(),
      components: {
        openviking: { reachable: ovReadable, basePath: cfg.openviking.basePath },
        graphify: { available: graphReadable, basePath: cfg.graphify.basePath },
        carriers: { writable: carriersWritable, root: cfg.carriers.root }
      }
    };
  });
}
