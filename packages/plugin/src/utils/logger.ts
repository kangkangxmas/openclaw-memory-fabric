import type { LogLevel } from "../types/index.js";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LogFields {
  requestId?: string;
  agentId?: string;
  projectId?: string;
  hook?: string;
  latencyMs?: number;
  sources?: string[];
  degraded?: boolean;
  [key: string]: unknown;
}

export class Logger {
  constructor(
    private readonly minLevel: LogLevel,
    private readonly emitMetrics: boolean
  ) {}

  private shouldLog(level: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[this.minLevel];
  }

  private write(level: LogLevel, msg: string, fields?: LogFields): void {
    if (!this.shouldLog(level)) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      plugin: "memory-fabric",
      msg,
      ...fields
    };
    // Write to stderr to avoid polluting agent stdout/context
    process.stderr.write(JSON.stringify(entry) + "\n");
  }

  debug(msg: string, fields?: LogFields) {
    this.write("debug", msg, fields);
  }
  info(msg: string, fields?: LogFields) {
    this.write("info", msg, fields);
  }
  warn(msg: string, fields?: LogFields) {
    this.write("warn", msg, fields);
  }
  error(msg: string, fields?: LogFields) {
    this.write("error", msg, fields);
  }

  /** Convenience: time an async operation and log on completion */
  async timed<T>(label: string, fields: LogFields, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.info(label, { ...fields, latencyMs: Date.now() - start });
      return result;
    } catch (err) {
      this.warn(`${label} failed`, {
        ...fields,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  }

  metricsEnabled(): boolean {
    return this.emitMetrics;
  }
}
