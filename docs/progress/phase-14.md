# Phase 14 Record

Date: 2026-04-16
Status: completed

## Goal

Close all gaps between PRD/architecture documents and the actual implementation.
All 7 gaps identified via document-vs-code audit were resolved.

## Delivered

### Gap 1 (High): Tool registration completeness
- New tool files: `memory-brief.ts`, `memory-commit.ts`, `project-bootstrap.ts`, `project-state-refresh.ts`, `project-graph-tools.ts` (query/path/explain), `carrier-tools.ts` (read/merge)
- `createPlugin()` now registers all 12 tools declared in the architecture doc
- `openclaw.plugin.json` tools array updated with full inputSchema for every tool, including `agentId` as required field

### Gap 2 (Medium): configSchema missing recallBudget
- Added `recallBudget` object to `openclaw.plugin.json` configSchema
- Fields: `l0Tokens`, `l1Tokens`, `l2Tokens` each with `minimum: 1` and defaults

### Gap 3 (Medium): before_tool_call / after_tool_call hooks
- `hooks/before-tool-call.ts`: logs high-value tool calls (write, create, delete, commit, deploy, publish) at debug level using a keyword + set-based classifier
- `hooks/after-tool-call.ts`: logs all tool results with result shape summary (capped at 200 chars)
- Both registered in `createPlugin()` and `openclaw.plugin.json`

### Gap 4 (Medium): health_status component checks
- `routes/health.ts` now probes openviking basePath, graphify basePath, and carriers root using `fs/promises.access`
- Returns structured `components` object with per-dependency health booleans
- `HealthResponse` and plugin `HealthStatus` types updated; `health-status.ts` surfaces component flags from sidecar response

### Gap 5 (Low): org_shared directory routing
- `SharedService.sharedDir()` routes by visibility: `project_shared → shared/projects/<id>/`, `org_shared → shared/org/`
- `forget()` searches both; `recall()` merges both; new `recallOrg()` for org-only queries

### Gap 6 (Low): Path security
- `utils/path-guard.ts`: `validateId()` blocks path separators and `..` in IDs; `validatePath()` uses resolve-prefix check
- Applied in CarrierRepository (initAgent, initProject, read, merge), SharedService (publish), GraphifyService (bootstrapProjectGraph)

### Gap 7 (Low): Metrics coverage
- `MetricsCollector` adds: `graphBootstrapCount/TotalMs`, `graphQueryCount/TotalMs`, `carrierMergeConflictCount`
- `snapshot()` now includes `graphBootstrapAvgMs`, `graphQueryAvgMs`
- `RecallOrchestrator` and `CommitOrchestrator` accept optional `MetricsCollector`; hooks wire plugin-level instance through

## Build verification

`pnpm -r build && pnpm -r test` — clean from root:
- plugin:  18 tests, 18 pass, 0 fail
- sidecar: 52 tests, 52 pass, 0 fail
- total:   70 tests, 70 pass, 0 fail
