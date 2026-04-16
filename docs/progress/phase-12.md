# Phase 12 Record

Date: 2026-04-15
Status: completed

## Goal

Add structured observability to the plugin layer: a `Logger` that writes JSON to stderr,
an in-memory `MetricsCollector`, hook instrumentation, and an async `health_status` tool
that reports sidecar reachability + live metrics.

## Delivered

### `packages/plugin/src/utils/logger.ts`
- `Logger` class with configurable minimum log level (debug / info / warn / error)
- Writes structured JSON to **stderr** — avoids injecting noise into the agent's context window
- Each entry: `{ ts, level, plugin: "memory-fabric", msg, ...fields }`
- `timed<T>(label, fields, fn)` — times an async operation and logs latency on completion or failure
- `metricsEnabled()` accessor for conditional metric emission

### `packages/plugin/src/utils/metrics.ts`
- `MetricsCollector`: in-memory counters — `recallCount`, `recallErrorCount`, `recallTotalMs`, `commitCount`, `commitErrorCount`, `commitTotalMs`, `degradedModeCount`, `sharedPublishCount`
- `recordRecall(latencyMs, error?)`, `recordCommit(latencyMs, error?)`, `recordDegraded()`, `recordSharedPublish()`
- `snapshot()` returns all counters plus computed `recallAvgMs` / `commitAvgMs`

### `packages/plugin/src/tools/health-status.ts` (updated)
- Now **async** — pings `client.health()` to check sidecar reachability
- Returns `HealthStatus` including `sidecarReachable`, `uptimeSeconds`, and full metrics snapshot
- Top-level `ok` field reflects sidecar reachability so callers have a single boolean gate

### `packages/plugin/src/hooks/before-prompt-build.ts` (updated)
- Accepts `logger: Logger` and `metrics: MetricsCollector`
- On success: `metrics.recordRecall()` + `logger.info("recall ok", { latencyMs, sources, degraded: false })`
- On error: `metrics.recordRecall(_, true)` + `metrics.recordDegraded()` + `logger.warn("recall failed — degraded mode")`

### `packages/plugin/src/hooks/agent-end.ts` (updated)
- Accepts `logger: Logger` and `metrics: MetricsCollector`
- On success: `metrics.recordCommit()` + `logger.info("commit ok", { latencyMs })`
- On error: `metrics.recordCommit(_, true)` + `logger.warn("agent_end commit failed — non-fatal")`
- `console.warn` calls replaced with structured logger

### `packages/plugin/src/index.ts` (updated)
- Instantiates `Logger` and `MetricsCollector` inside `createPlugin()`
- Passes both to `createBeforePromptBuildHandler` and `createAgentEndHandler`

## Design decisions

- Logger writes to stderr: the agent's stdout is consumed as context window content; stderr is safe for operational noise
- Metrics are in-memory only: no external dependency, no persistence — surfaced via `health_status` tool on demand
- `health_status` is async: real reachability check on every call, not a stale cached flag
- All hook failures remain non-fatal: observability layer can never crash the agent session

## Build verification

`pnpm -r build` passes with zero errors after all Phase 12 changes.
