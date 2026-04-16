import { homedir } from "os";
import { resolve } from "path";

export interface SidecarConfig {
  port: number;
  host: string;
  openviking: {
    mode: "local" | "remote";
    basePath: string;
    targetRoot: string;
  };
  carriers: {
    root: string;
  };
  graphify: {
    basePath: string;
  };
}

function resolvePath(p: string): string {
  if (p.startsWith("~/")) return resolve(homedir(), p.slice(2));
  return resolve(p);
}

export function loadSidecarConfig(): SidecarConfig {
  return {
    port: Number(process.env.PORT ?? 7811),
    host: process.env.HOST ?? "127.0.0.1",
    openviking: {
      mode: (process.env.OPENVIKING_MODE ?? "local") as "local" | "remote",
      basePath: resolvePath(process.env.OPENVIKING_BASE_PATH ?? "~/.openviking"),
      targetRoot: process.env.OPENVIKING_TARGET_ROOT ?? "viking://org/default"
    },
    carriers: {
      root: resolvePath(process.env.CARRIERS_ROOT ?? "~/.memory-fabric/carriers")
    },
    graphify: {
      basePath: resolvePath(process.env.GRAPHIFY_BASE_PATH ?? "~/.memory-fabric/graphs")
    }
  };
}
