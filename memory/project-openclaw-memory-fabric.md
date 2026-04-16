---
name: openclaw-memory-fabric project state
description: Final completion status of the openclaw-memory-fabric monorepo — all 14 phases + compliance audit complete, shipped to GitHub
type: project
---

All 14 phases + PRD compliance audit (phase-14) are implemented and verified. Project published to GitHub.

**Why:** Multi-agent memory orchestration plugin for OpenClaw, no upstream modification required.

**How to apply:** Project is feature-complete and published. Future work = new phases or maintenance.

## Final state (as of 2026-04-16) — v1.6.0

- Phases 1–13: all completed ✓
- Phase 14 (PRD gap closure): all 7 gaps fixed ✓
- ESLint 9 (flat config) + Prettier: configured and all files passing ✓
- Tests: plugin 40 + sidecar 67 = **107 unit/integration tests**, all passing ✓
- E2E: 9 tests, all passing ✓
- `pnpm -r build` → clean (0 TypeScript errors) ✓
- `pnpm lint` → 0 errors ✓
- `pnpm format:check` → all files pass ✓
- GitHub repo created and initial commit pushed ✓

## Phase 14 gaps fixed

1. 12 tools registered in `createPlugin()` and `openclaw.plugin.json` (was only 3)
2. `recallBudget` configSchema added to manifest
3. `before_tool_call` / `after_tool_call` hooks implemented and registered
4. `health_status` now checks all components (openviking, graphify, carriers)
5. `org_shared` routed to `shared/org/` independently from `project_shared`
6. `validateId()` / `validatePath()` applied across all services (path traversal protection)
7. MetricsCollector extended with graph + carrier merge metrics

## Architecture

```
packages/
  plugin/          @openclaw-memory-fabric/plugin v1.6.0
    src/
      config/      loadConfig() + JSON Schema validation (Ajv)
      hooks/       before_prompt_build, agent_end, before_tool_call, after_tool_call
      orchestrator/ RecallOrchestrator, CommitOrchestrator (with MetricsCollector)
      tools/       12 tool handlers
      utils/       SidecarClient, Logger, MetricsCollector
  sidecar/         @openclaw-memory-fabric/sidecar v1.6.0  (Fastify 5)
    src/
      adapters/    openviking-adapter.ts
      services/    OpenVikingService, SharedService, DistillService, GraphifyService, CarrierService
      repositories/ CarrierRepository (5 merge strategies)
      utils/       jsonl.ts, path-guard.ts (validateId, validatePath)
      routes/      health, recall, commit, carrier, distill, shared, graphify
      config/      SidecarConfig
scripts/
  e2e/             e2e.test.mjs (9 E2E tests)
  dev-start.sh / dev-stop.sh / health-check.sh
examples/
  project-sample/  bootstrap.sh + README.md
```

## Key design decisions

- Plugin → Sidecar: HTTP only via SidecarClient (no in-process coupling)
- Memory storage: JSONL files under `<openviking.basePath>/<org>/agents/<agentId>/<scope>/`
- `resolveScope(undefined)` → `"project"` (commitSession requires projectId for project scope)
- Carrier merge strategies: overwrite / append / dedup-append / ordered-accumulate / conflict-preserve
- org_shared: `shared/org/published-memory.jsonl`; project_shared: `shared/projects/<id>/published-memory.jsonl`
- Path security: validateId blocks `/`, `\`, `..`; validatePath uses resolve-prefix check

## Scripts

- `pnpm lint` / `pnpm lint:fix` — ESLint
- `pnpm format` / `pnpm format:check` — Prettier
- `pnpm -r build` — build all packages
- `pnpm test` — unit + integration (107 tests)
- `pnpm test:e2e` — E2E against real sidecar (9 tests)
- `bash scripts/dev-start.sh` — start sidecar
