import type { MemoryFabricConfig } from "../types/index.js";
import type { MetricsCollector } from "../utils/metrics.js";
import type { SidecarClient } from "../utils/sidecar-client.js";

const startTime = Date.now();

export interface HealthStatus {
  ok: boolean;
  packageName: string;
  version: string;
  phase: string;
  sidecarUrl: string;
  sidecarReachable: boolean;
  defaultScope: string;
  uptimeSeconds: number;
  components: {
    openviking: { reachable: boolean };
    graphify: { available: boolean };
    carriers: { writable: boolean };
  };
  lastRefreshTime?: string;
  metrics: ReturnType<MetricsCollector["snapshot"]>;
}

export async function createHealthStatus(
  config: MemoryFabricConfig,
  client: SidecarClient,
  metrics: MetricsCollector
): Promise<HealthStatus> {
  let sidecarReachable = false;
  let openvikingReachable = false;
  let graphifyAvailable = false;
  let carriersWritable = false;
  let lastRefreshTime: string | undefined;

  try {
    const h = await client.health();
    sidecarReachable = h.ok === true;
    lastRefreshTime = h.lastRefreshTime;
    openvikingReachable = h.components?.openviking?.reachable ?? false;
    graphifyAvailable = h.components?.graphify?.available ?? false;
    carriersWritable = h.components?.carriers?.writable ?? false;
  } catch {
    // all component flags remain false
  }

  return {
    ok: sidecarReachable,
    packageName: "@openclaw-memory-fabric/plugin",
    version: "1.6.0",
    phase: "phase-14-gap-closure",
    sidecarUrl: config.sidecar.baseUrl,
    sidecarReachable,
    defaultScope: config.defaultScope,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    lastRefreshTime,
    components: {
      openviking: { reachable: openvikingReachable },
      graphify: { available: graphifyAvailable },
      carriers: { writable: carriersWritable }
    },
    metrics: metrics.snapshot()
  };
}
