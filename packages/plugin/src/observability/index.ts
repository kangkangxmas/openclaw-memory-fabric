// Re-export observability utilities from their canonical locations.
// The directory structure follows the spec in docs/03-vibecoding-dev-instructions.md.
export { Logger } from "../utils/logger.js";
export { MetricsCollector } from "../utils/metrics.js";
export type { LogFields } from "../utils/logger.js";
export type { PluginMetrics } from "../utils/metrics.js";
