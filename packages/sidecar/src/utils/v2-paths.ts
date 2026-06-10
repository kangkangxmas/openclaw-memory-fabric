import { join } from "path";
import type { SidecarConfig } from "../config/index.js";

export function resolveV2BaseDir(cfg: SidecarConfig["openviking"]): string {
  const match = cfg.targetRoot.match(/^viking:\/\/org\/([^/]+)/);
  const org = match?.[1] ?? "default";
  return join(cfg.basePath, org, "v2");
}
