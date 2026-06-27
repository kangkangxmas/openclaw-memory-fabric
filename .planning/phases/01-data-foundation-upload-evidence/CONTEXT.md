# Phase 1: Data Foundation and Upload Evidence Baseline - Context

**Gathered:** 2026-06-27
**Status:** Complete (brownfield adopted; do not execute)

<domain>

## Phase Boundary

This phase documents the existing OpenClaw Memory Fabric baseline as implemented today. It is not a future plan and must not trigger `gsd-execute-phase 1`.

The user-provided slug `data-foundation-upload-evidence` is interpreted for this repository as the memory data foundation and evidence-ingestion baseline: OpenClaw session data is distilled into legacy memory and v2 evidence-backed events/candidates, then consolidated into stable memory and made inspectable through APIs and the web console. This repo does not implement a generic business "upload credential" product; "upload/evidence" here means `/commit`, `/v2/events`, L0 evidence events, L1 candidates, and `sourceRefs`.

</domain>

<decisions>

## Implementation Decisions

### Project adoption state

- **D-01:** Treat the project as a completed brownfield/legacy baseline. Future GSD work should verify, repair, or extend it; it should not regenerate Phase 1.
- **D-02:** Preserve the existing plugin + sidecar + web monorepo boundary. OpenClaw official core source remains out of scope.
- **D-03:** Keep self-developed v2 as the architecture baseline. Hy-Memory is only a design reference and is not a runtime dependency.

### Adopted technology stack

- **D-04:** The repo is a pnpm TypeScript monorepo with `packages/plugin`, `packages/sidecar`, and `packages/web`.
- **D-05:** The sidecar is a Fastify 5 local HTTP service, normally reachable at `http://127.0.0.1:7811`.
- **D-06:** The Inspector UI is a React 18 + Vite + Tailwind SPA built from `packages/web` and copied into `packages/sidecar/public` by the root build script.
- **D-07:** Tests use TypeScript test builds plus Node's built-in `node:test`, with E2E and smoke scripts in `scripts/`.

### Data model and main entities

- **D-08:** Legacy memory remains OpenViking JSONL entries managed by `OpenVikingService`.
- **D-09:** Carrier state remains markdown projection files managed by `CarrierRepository`.
- **D-10:** v2 stable memory uses `MemoryEntryV2` with `type`, `content`, `agentId`, `projectId`, `scope`, `visibility`, `timeline`, `sourceRefs`, `validFrom`, `validUntil`, `supersedes`, `quality`, `status`, `relations`, `sources`, and metadata.
- **D-11:** L0 evidence is represented by `LedgerEvent` records with `eventId`, `agentId`, optional `projectId`, `sourceType`, `sourceUri`, `occurredAt`, `contentHash`, `summary`, optional payload, and retention.
- **D-12:** L1 candidate memory is represented by `AtomicMemoryCandidate` with status, type, content, `sourceRefs`, confidence, quality, tags, review reason, and optional promoted memory id.

### Upload/evidence processing flow

- **D-13:** The primary session write path starts at the OpenClaw `agent_end` hook, runs `CommitOrchestrator`, calls `/distill`, then calls `/commit`.
- **D-14:** `/commit` always preserves legacy OpenViking behavior. Depending on v2 mode it writes no v2 data, queues shadow v2 data, or writes v2-first with legacy fallback.
- **D-15:** v2 writes append an L0 event through `EventLedgerService.append()` and create L1 candidates through `AtomicMemoryStore.create()`.
- **D-16:** Direct evidence ingestion is also exposed as `POST /v2/events`; direct candidate ingestion is exposed as `POST /v2/memories/candidates`.
- **D-17:** A candidate with no `sourceRefs` is not trusted: it is stored as `needs_review` with `reviewReason=missing_source_refs`.
- **D-18:** The code does not currently implement file-upload credentials as a separate domain. File, diff, attachment, runtime, tool-call, and error evidence are modeled as L0 event `sourceType` values.

### Audit and consolidation flow

- **D-19:** `MemoryConsolidator` is the core promotion gate used by manual consolidation and background worker flows.
- **D-20:** Consolidation rejects or holds candidates for missing `sourceRefs`, low confidence/quality, low-signal fragments, and untrusted profile/intent claims.
- **D-21:** `profile` and `intent` require explicit user directive, manual review, or multiple high-quality sources before promotion.
- **D-22:** Promotion creates or updates `MemoryEntryV2`, merges duplicate evidence, marks superseded memories with `validUntil`, and records relation graph edges.
- **D-23:** `GET /v2/memories/:id/trace` is the adopted source-trace path from stable memory to `sourceRefs`, L0 events, source metadata, relations, and relation paths.

### Storage and persistence

- **D-24:** Durable state is file-based: JSONL for legacy memory, v2 events, candidates, recall audit, relation graph, bench/history, experiences, patterns, and vectors; Markdown for carriers.
- **D-25:** Default roots are resolved from environment by `loadSidecarConfig()`: `OPENVIKING_BASE_PATH`, `CARRIERS_ROOT`, and `GRAPHIFY_BASE_PATH`.
- **D-26:** JSONL helpers use direct read/write/append filesystem operations; there is no transactional database or cross-process locking in the current baseline.

### API, page, and service boundaries

- **D-27:** Plugin boundary: `packages/plugin/src/index.ts`, hooks, tools, orchestrators, config, and `SidecarClient`.
- **D-28:** Sidecar boundary: Fastify route modules under `packages/sidecar/src/routes` call services under `packages/sidecar/src/services`.
- **D-29:** Web boundary: `packages/web/src` calls sidecar APIs through `packages/web/src/api/client.ts`.
- **D-30:** v2 public surfaces include `/v2/events`, `/v2/memories/candidates`, `/v2/consolidation/*`, `/v2/recall/plan`, `/v2/recall/audit`, `/v2/memories/:id/trace`, `/v2/rollout/*`, `/v2/bench/*`, `/v2/carriers/*`, `/v2/graph/relations`, and `/v2/ops/*`.
- **D-31:** Legacy public surfaces `/recall`, `/commit`, `/carrier/*`, `/graph/*`, `/shared/*`, `/health`, and `/inspect` remain compatibility contracts.

### Permissions, validation, and errors

- **D-32:** The sidecar is local-first and unauthenticated in the current baseline; widening network exposure requires a future auth/capability phase.
- **D-33:** Several v2 services validate `agentId`/`projectId` with `validateId()`, but path validation is not uniformly enforced across every legacy path.
- **D-34:** Route schemas use Fastify JSON schema validation for many inputs, but some endpoints return HTTP 200 with `ok:false` for not-found conditions.
- **D-35:** Plugin recall and carrier enrichment are designed to fail soft: v2 recall, graph brief, and carrier reads fall back instead of blocking prompt construction.

### Testing and acceptance

- **D-36:** Root scripts include `pnpm build`, `pnpm -r test`, `pnpm -r typecheck`, `pnpm test:e2e`, `pnpm v2:gray-smoke`, `pnpm v2:acceptance-loop`, `pnpm v2:commit-smoke`, and `pnpm v2:canary-monitor`.
- **D-37:** Package tests compile `src` plus `test` into `dist-test` and run `node --test`.
- **D-38:** Sidecar tests cover memory core, v2 APIs, retrieval, consolidation, carrier projection, rollout config, context health, lifecycle, federation, performance, and route integration.
- **D-39:** Plugin tests cover config loading, hooks, tools, and recall orchestrator behavior.
- **D-40:** Web acceptance is build-based today; no committed component/unit test runner was found for `packages/web`.

### Compatibility constraints for future phases

- **D-41:** Future work must preserve legacy `/recall`, `/commit`, `/carrier/*`, OpenViking JSONL, and carrier fallback behavior unless a migration phase explicitly retires them.
- **D-42:** Future work must preserve v2 rollout modes and allow per-Agent rollback.
- **D-43:** Future work must not let source-less content become trusted stable memory or prompt-injected v2 cards.
- **D-44:** Carrier projection must remain a projection of structured memory, not the only fact source.
- **D-45:** `main/main` rollout should remain last unless the user explicitly changes rollout order.

### The Agent's Discretion

Future agents may choose exact implementation details for maintenance fixes, but only inside a new GSD quick task or new phase. They must not mutate business/runtime code from this Phase 1 context alone.

</decisions>

<specifics>

## Existing Implementation Baseline

Phase 1 is complete as a baseline because the current repo already includes:

- Plugin hook orchestration for recall and commit.
- Legacy sidecar recall/commit/carrier APIs.
- v2 L0 event ledger and L1 candidate queue.
- Consolidation worker and MemoryConsolidator promotion gates.
- MemoryEntryV2 stable memory model with evidence, quality, validity, supersedes, and status fields.
- RetrievalPlanner and MemoryCardPackager for evidence-backed memory cards.
- CarrierProjectionEngine with whitelist, preview/apply, rollback, and history.
- V2RelationGraphService semantic relations.
- MemoryBenchRunner and fixture seeding.
- V2 Inspector operations UI.
- Build, typecheck, unit/integration, E2E, smoke, and canary scripts.

## Completed Summary

The implemented system can ingest session memory, persist it through legacy and v2 paths, gate v2 candidates through evidence and quality checks, consolidate candidates into stable memories, trace stable memories back to L0 events, and recall bounded memory cards for prompt injection while keeping legacy fallback paths available.

## Known Issues, Technical Debt, and Risks

- `packages/sidecar/src/routes/v2.ts` is large and mixes many operational domains.
- `packages/web/src/pages/V2Inspector.tsx` is large and mixes read-only and destructive operations.
- JSONL storage lacks transactional write coordination and indexes.
- Sidecar write/destructive routes have no server-side auth/capability model.
- Sensitive candidate handling is mostly post-hoc; pre-write quarantine is future work.
- Some not-found responses return HTTP 200 with `ok:false`.
- Path-segment validation is not fully uniform across all legacy/v2 storage paths.
- Exports/backups and some status endpoints use broad scans and fixed caps.

</specifics>

<canonical_refs>

## Canonical References

Downstream agents MUST read these before verification, maintenance, or new feature work.

### Product and architecture

- `README.md` - Current product summary, endpoint list, environment variables, and historical phase completion table.
- `docs/ARCHITECTURE.md` - Current architecture, v2 production supplement, plugin/sidecar/web/data flows.
- `docs/API.md` - Sidecar HTTP contract, legacy APIs, and v2 APIs.
- `docs/v2-self-research-implementation.md` - Self-developed v2 baseline, components, APIs, carrier rules, bench targets, rollout strategy.
- `docs/v2-production-roadmap.md` - Current productionization roadmap and completed v2 phases.

### Historical implementation records

- `docs/progress/phase-01.md` - Original monorepo skeleton phase, completed.
- `docs/progress/phase-02.md` through `docs/progress/phase-14.md` - Historical implementation records.

### Current codebase map

- `.planning/codebase/STACK.md` - Stack and dependencies.
- `.planning/codebase/ARCHITECTURE.md` - Current architecture map.
- `.planning/codebase/STRUCTURE.md` - Directory and module structure.
- `.planning/codebase/CONVENTIONS.md` - Coding conventions.
- `.planning/codebase/TESTING.md` - Test/build strategy.
- `.planning/codebase/INTEGRATIONS.md` - Runtime integrations.
- `.planning/codebase/CONCERNS.md` - Known risks and debt.

### Key source entry points

- `packages/plugin/src/index.ts` - Plugin registration.
- `packages/plugin/src/hooks/before-prompt-build.ts` - Recall hook.
- `packages/plugin/src/hooks/agent-end.ts` - Commit hook.
- `packages/plugin/src/orchestrator/recall-orchestrator.ts` - Recall planning and fallback.
- `packages/plugin/src/orchestrator/commit-orchestrator.ts` - Distill/commit/carrier merge.
- `packages/sidecar/src/server.ts` - Sidecar composition.
- `packages/sidecar/src/routes/commit.ts` - Legacy/v2 commit gate.
- `packages/sidecar/src/routes/v2.ts` - v2 API registrar.
- `packages/sidecar/src/models/schema-v2.ts` - Stable v2 memory model.
- `packages/sidecar/src/services/event-ledger-service.ts` - L0 evidence ledger.
- `packages/sidecar/src/services/atomic-memory-store.ts` - L1 candidate queue.
- `packages/sidecar/src/services/memory-consolidator.ts` - Promotion and quality gates.
- `packages/sidecar/src/services/retrieval-planner.ts` - v2 recall planning and ranking.
- `packages/web/src/pages/V2Inspector.tsx` - V2 Inspector operations UI.

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `SidecarClient` already centralizes plugin-to-sidecar HTTP calls.
- `EventLedgerService` and `AtomicMemoryStore` provide the evidence/candidate foundation.
- `MemoryConsolidator` is the single promotion gate to extend for new quality/security rules.
- `RetrievalPlanner` and `MemoryCardPackager` are the v2 prompt-injection path to extend for recall changes.
- `CarrierProjectionEngine` is the only supported route for structured memory to carrier projection.
- `MemoryBenchRunner` and smoke scripts are the right verification entry points for rollout changes.

### Established Patterns

- Sidecar routes validate request shape and delegate to service classes.
- Storage uses JSONL/Markdown helpers with local filesystem roots.
- Plugin orchestration is fail-soft and preserves legacy fallback.
- v2 rollout is gated by mode resolution: environment emergency off, runtime overrides, allowlists, and global mode.
- Tests favor `node:test` and compiled `dist-test` outputs.

### Integration Points

- New sidecar endpoints should be added to route modules, service classes, web API types/client, and tests together.
- New prompt-injection behavior should go through `PromptInjectionPolicy` or `MemoryCardPackager`, not ad hoc string injection.
- New v2 memory writes should go through L0 event + L1 candidate + consolidator, not direct stable memory insertion, unless explicitly building admin/import tooling.
- New Inspector operations should require visible operator intent and should prefer preview -> apply flows for destructive changes.

</code_context>

<deferred>

## Deferred Ideas

- Add server-side auth and capability enforcement for sidecar operations.
- Add transactional/indexed storage for candidates, events, recall audit, and stable memories.
- Add pre-write sensitive content quarantine.
- Split `routes/v2.ts` into focused route modules.
- Split `V2Inspector.tsx` into smaller operation panels and hooks.
- Normalize HTTP error status handling.
- Add browser/component tests for Inspector critical operations.

</deferred>

---

*Phase: 01-data-foundation-upload-evidence*
*Context gathered: 2026-06-27*
