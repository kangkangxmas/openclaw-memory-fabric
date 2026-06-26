<!-- refreshed: 2026-06-26 -->
# Architecture

**Analysis Date:** 2026-06-26

## System Overview

```text
+--------------------------------------------------------------------------------+
|                         OpenClaw Gateway / Agent Runtime                        |
|                         `packages/plugin/src/index.ts`                          |
+----------------------+----------------------+----------------------------------+
| Hook handlers        | Tool wrappers        | Orchestrators                    |
| `packages/plugin/   | `packages/plugin/    | `packages/plugin/src/            |
|  src/hooks`          |  src/tools`          |  orchestrator`                   |
+----------+-----------+----------+-----------+------------------+---------------+
           |                      |                              |
           |                      v                              |
           |           HTTP client boundary                      |
           |           `packages/plugin/src/utils/sidecar-client.ts`
           |                                                     |
           v                                                     v
+--------------------------------------------------------------------------------+
|                              Fastify Sidecar                                    |
|                         `packages/sidecar/src/server.ts`                        |
+----------------------+----------------------+----------------------------------+
| Routes               | Services             | V2 route composition             |
| `packages/sidecar/  | `packages/sidecar/   | `packages/sidecar/src/routes/   |
|  src/routes`         |  src/services`       |  v2.ts`                          |
+----------+-----------+----------+-----------+------------------+---------------+
           |                      |                              |
           v                      v                              v
+--------------------------------------------------------------------------------+
|                 Core Models, Query Engines, Stores, and Adapters                |
| `packages/sidecar/src/core` | `packages/sidecar/src/models` | `stores` | `utils` |
+----------------------+----------------------+----------------------------------+
           |                      |                              |
           v                      v                              v
+--------------------------------------------------------------------------------+
|                              Filesystem State                                   |
| OpenViking JSONL: `~/.openviking` / configured `OPENVIKING_BASE_PATH`           |
| Carriers: `~/.memory-fabric/carriers` / configured `CARRIERS_ROOT`              |
| Graphs: `~/.memory-fabric/graphs` / configured `GRAPHIFY_BASE_PATH`             |
| Auto skills: `~/.openclaw/skills/auto-generated`                                |
+--------------------------------------------------------------------------------+

+--------------------------------------------------------------------------------+
|                               Inspector Web UI                                  |
| React/Vite app: `packages/web/src`                                              |
| Build copied to sidecar static root by `package.json` build script              |
+--------------------------------------------------------------------------------+
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| OpenClaw plugin entry | Registers plugin metadata, tools, and hooks; creates shared `SidecarClient`, `Logger`, and `MetricsCollector`. | `packages/plugin/src/index.ts` |
| Plugin config loader | Merges user config with defaults and validates with AJV. | `packages/plugin/src/config/loader.ts` |
| Plugin config defaults | Defines default scope, recall budgets, sidecar URL, OpenViking target, Graphify behavior, publish policy, and observability defaults. | `packages/plugin/src/config/defaults.ts` |
| Hook types | Defines hook event/context shapes for OpenClaw integration. | `packages/plugin/src/hooks/types.ts` |
| Before-prompt hook | Initializes carriers, runs recall, logs metrics, and returns `prependContext`. | `packages/plugin/src/hooks/before-prompt-build.ts` |
| Agent-end hook | Normalizes session messages, strips injected memory blocks, commits distilled session memory, and optionally refreshes Graphify. | `packages/plugin/src/hooks/agent-end.ts` |
| Recall orchestrator | Builds recall depth/scope/task-type plans, chooses v2 recall when enabled, falls back to legacy recall, and enriches prompts with structural/carrier context. | `packages/plugin/src/orchestrator/recall-orchestrator.ts` |
| Commit orchestrator | Distills messages, commits memory, merges carrier patches, and updates `self-model.md` when safe. | `packages/plugin/src/orchestrator/commit-orchestrator.ts` |
| Prompt injection policy | Sanitizes carrier content and applies depth-specific injection budgets. | `packages/plugin/src/orchestrator/prompt-injection-policy.ts` |
| Sidecar client | Owns all HTTP request/response shapes between plugin and sidecar. | `packages/plugin/src/utils/sidecar-client.ts` |
| Sidecar server | Creates Fastify, instantiates services/stores, registers routes, and starts the HTTP listener. | `packages/sidecar/src/server.ts` |
| Sidecar config | Resolves port, host, OpenViking base path, carrier root, and Graphify path from environment variables. | `packages/sidecar/src/config/index.ts` |
| Legacy recall route | Handles `/recall`, delegates core retrieval to `OpenVikingService`, and appends shared memory/patterns when requested. | `packages/sidecar/src/routes/recall.ts` |
| Commit route | Handles `/commit`, gates v2 write modes, writes legacy memory, and starts async post-commit experience processing. | `packages/sidecar/src/routes/commit.ts` |
| V2 route module | Registers `/v2/*` APIs for evidence events, candidates, consolidation, recall plans, rollout, carrier projection, bench, canary, and operations endpoints. | `packages/sidecar/src/routes/v2.ts` |
| OpenViking service | Reads/writes scoped `memories.jsonl`, scores recall results, updates summary metadata, performs migration checks, and exposes inspect APIs. | `packages/sidecar/src/services/openviking-service.ts` |
| Carrier repository | Owns private/project markdown carrier templates, read/merge/replace logic, merge strategies, and journal rotation. | `packages/sidecar/src/services/carrier-service.ts` |
| Shared service | Publishes, retracts, and recalls shared memory entries under carrier-root JSONL files. | `packages/sidecar/src/services/shared-service.ts` |
| Graphify service | Scans project files, builds lightweight entity/co-occurrence graphs, writes graph artifacts, and serves structural briefs. | `packages/sidecar/src/services/graphify-service.ts` |
| V2 facade | Provides a high-level facade around `MemoryCoreV2`, `QueryRouter`, `AdvancedQuery`, `SyncEngine`, `ExportService`, `MemoryIndex`, and `MemoryCache`. | `packages/sidecar/src/services/v2-service-facade.ts` |
| Memory core v2 | Owns `MemoryEntryV2` CRUD, query, relation graph, cache/index integration, lifecycle cleanup, compaction, and persistence. | `packages/sidecar/src/core/memory-core-v2.ts` |
| Event ledger | Appends source-backed evidence events into v2 JSONL ledgers. | `packages/sidecar/src/services/event-ledger-service.ts` |
| Atomic memory store | Stores v2 memory candidates, review status, quality defaults, stats, and queue filtering. | `packages/sidecar/src/services/atomic-memory-store.ts` |
| Memory consolidator | Promotes evidence-backed candidates to stable `MemoryEntryV2` entries, merges duplicates, supersedes stale memories, and records relations. | `packages/sidecar/src/services/memory-consolidator.ts` |
| Consolidation worker | Runs consolidation on an in-process interval over one or more agent/project scopes. | `packages/sidecar/src/services/consolidation-worker.ts` |
| Retrieval planner | Classifies v2 recall intent, combines keyword/type/temporal/graph signals, filters source-less entries, and returns memory cards. | `packages/sidecar/src/services/retrieval-planner.ts` |
| Memory card packager | Converts stable v2 memories into bounded prompt-ready memory cards. | `packages/sidecar/src/services/memory-card-packager.ts` |
| Relation graph service | Persists semantic relations such as `DECIDES`, `IMPLEMENTS`, `SUPERSEDES`, `CAUSES`, `VALIDATES`, and `CONSTRAINS`. | `packages/sidecar/src/services/v2-relation-graph-service.ts` |
| Carrier projection engine | Audits, previews, applies, rolls back, and records v2-to-carrier markdown projections. | `packages/sidecar/src/services/carrier-projection-engine.ts` |
| Inspector web app | Provides UI navigation over overview, memories, graph, carriers, learning, federation, and v2 inspector pages. | `packages/web/src/App.tsx` |
| Web API client | Centralizes browser calls to sidecar legacy and v2 endpoints. | `packages/web/src/api/client.ts` |

## Pattern Overview

**Overall:** Plugin plus local sidecar with layered service/repository architecture and filesystem-backed event/memory stores.

**Key Characteristics:**
- Keep OpenClaw integration thin: `packages/plugin/src/index.ts` registers tools/hooks and delegates storage or retrieval to the sidecar through `packages/plugin/src/utils/sidecar-client.ts`.
- Treat the HTTP sidecar as the domain boundary: `packages/sidecar/src/server.ts` constructs domain services and route modules delegate to services.
- Persist memory as auditable files: scoped OpenViking memory uses `memories.jsonl`; carrier state uses markdown files; v2 evidence/candidates/audit files use JSONL.
- Run recall as a planned pipeline: plugin heuristics select depth/scope/task type, sidecar services retrieve and rank, prompt policy sanitizes and bounds injection.
- Run commit as a dual-write-compatible pipeline: `/commit` always preserves legacy OpenViking behavior and adds v2 evidence/candidate writes according to rollout mode.
- Package the browser UI as an inspector over sidecar APIs; build output is copied into `packages/sidecar/public` by the root `package.json` build script.

## Layers

**Workspace Layer:**
- Purpose: Coordinate the pnpm monorepo packages and top-level scripts.
- Location: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
- Contains: root build/test/lint scripts, workspace package list, shared TypeScript defaults.
- Depends on: pnpm workspace resolution.
- Used by: package builds in `packages/plugin`, `packages/sidecar`, and `packages/web`.

**Plugin Integration Layer:**
- Purpose: Expose Memory Fabric to OpenClaw as hooks and tools.
- Location: `packages/plugin/src`
- Contains: `index.ts`, `hooks`, `tools`, `orchestrator`, `config`, `types`, `utils`.
- Depends on: OpenClaw plugin API, `SidecarClient`, AJV config validation, local logger/metrics.
- Used by: OpenClaw gateway loading `packages/plugin/dist/index.js` from `packages/plugin/openclaw.plugin.json`.

**Plugin Orchestration Layer:**
- Purpose: Decide when and how to recall or commit memory from OpenClaw events.
- Location: `packages/plugin/src/orchestrator`
- Contains: `RecallOrchestrator`, `CommitOrchestrator`, and prompt injection policy.
- Depends on: `packages/plugin/src/utils/sidecar-client.ts`, `packages/plugin/src/types/index.ts`, hook contexts.
- Used by: `packages/plugin/src/hooks/before-prompt-build.ts` and `packages/plugin/src/hooks/agent-end.ts`.

**HTTP Boundary Layer:**
- Purpose: Keep plugin and sidecar decoupled through typed HTTP methods.
- Location: `packages/plugin/src/utils/sidecar-client.ts`
- Contains: request/response interfaces and `SidecarClient` methods for `/health`, `/recall`, `/commit`, `/distill`, `/carrier/*`, `/graph/*`, `/shared/*`, and `/v2/*`.
- Depends on: standard `fetch`, plugin `SidecarConfig`.
- Used by: plugin tools, hook handlers, and orchestrators.

**Sidecar API Layer:**
- Purpose: Validate request shapes and dispatch HTTP endpoints to services.
- Location: `packages/sidecar/src/routes`
- Contains: focused route modules such as `recall.ts`, `commit.ts`, `carrier.ts`, `graph.ts`, `inspect.ts`, `shared.ts`, plus the broad `v2.ts` module.
- Depends on: Fastify, sidecar services, sidecar models.
- Used by: `packages/sidecar/src/server.ts`.

**Sidecar Service Layer:**
- Purpose: Own domain operations for memory retrieval, commit, carriers, graphing, sharing, learning, v2 rollout, consolidation, and reporting.
- Location: `packages/sidecar/src/services`
- Contains: `OpenVikingService`, `CarrierRepository`, `GraphifyService`, `SharedService`, `DistillService`, `ExperienceService`, `PatternService`, `MemoryConsolidator`, `RetrievalPlanner`, `CarrierProjectionEngine`, and related services.
- Depends on: `packages/sidecar/src/models`, `packages/sidecar/src/core`, `packages/sidecar/src/stores`, filesystem utilities.
- Used by: route modules and server composition.

**Core Memory Layer:**
- Purpose: Define and query stable v2 memory entries.
- Location: `packages/sidecar/src/core`, `packages/sidecar/src/models`
- Contains: `MemoryCoreV2`, `MemoryEntryV2`, `QueryRouter`, `AdvancedQuery`, `MemoryIndex`, `MemoryCache`, `SyncEngine`, `ExportService`.
- Depends on: JSONL helpers, OpenViking path adapter, optional vector services.
- Used by: v2 services and routes.

**Persistence Adapter/Store Layer:**
- Purpose: Convert domain operations into filesystem paths and JSONL/markdown file operations.
- Location: `packages/sidecar/src/adapters`, `packages/sidecar/src/stores`, `packages/sidecar/src/utils`
- Contains: `openviking-adapter.ts`, JSONL helpers, path guards, vector/experience/pattern/skill stores.
- Depends on: Node filesystem/path APIs.
- Used by: sidecar services and core memory classes.

**Inspector Web Layer:**
- Purpose: Render browser UI over sidecar APIs.
- Location: `packages/web/src`
- Contains: React `App`, pages, components, hooks, `api/client.ts`, i18n, CSS.
- Depends on: React, Vite, browser `fetch`, sidecar API schemas in `packages/web/src/types/index.ts`.
- Used by: web build and sidecar static serving after copy to `packages/sidecar/public`.

## Data Flow

### Primary Request Path

1. OpenClaw calls the before-prompt hook registered by `createPlugin` (`packages/plugin/src/index.ts:108`).
2. The hook extracts agent/project/message context, initializes carriers, and invokes `RecallOrchestrator.execute()` (`packages/plugin/src/hooks/before-prompt-build.ts:32`, `packages/plugin/src/hooks/before-prompt-build.ts:43`, `packages/plugin/src/hooks/before-prompt-build.ts:49`).
3. `RecallOrchestrator.plan()` chooses recall depth, scope, query, structural-brief need, and task type (`packages/plugin/src/orchestrator/recall-orchestrator.ts:162`).
4. The orchestrator resolves v2 rollout mode and calls `/v2/recall/plan` when v2 recall is enabled; otherwise it uses `/recall` (`packages/plugin/src/orchestrator/recall-orchestrator.ts:183`, `packages/plugin/src/orchestrator/recall-orchestrator.ts:190`, `packages/plugin/src/orchestrator/recall-orchestrator.ts:285`).
5. `SidecarClient` sends typed HTTP requests with timeout/error handling (`packages/plugin/src/utils/sidecar-client.ts:266`, `packages/plugin/src/utils/sidecar-client.ts:297`, `packages/plugin/src/utils/sidecar-client.ts:301`).
6. The sidecar `/v2/recall/plan` route delegates to `RetrievalPlanner.recall()` (`packages/sidecar/src/routes/v2.ts:520`, `packages/sidecar/src/routes/v2.ts:540`).
7. `RetrievalPlanner` queries `MemoryCoreV2`, scores keyword/type/temporal/graph signals, filters memories without evidence, and packages memory cards (`packages/sidecar/src/services/retrieval-planner.ts:162`, `packages/sidecar/src/services/retrieval-planner.ts:175`, `packages/sidecar/src/services/retrieval-planner.ts:221`, `packages/sidecar/src/services/retrieval-planner.ts:229`).
8. Legacy fallback `/recall` delegates to `OpenVikingService.recallMemory()`, then optionally appends shared memory and learned patterns (`packages/sidecar/src/routes/recall.ts:14`, `packages/sidecar/src/routes/recall.ts:36`, `packages/sidecar/src/routes/recall.ts:39`, `packages/sidecar/src/routes/recall.ts:58`).
9. For L1/L2 recall, `RecallOrchestrator` adds Graphify structural briefs and carrier files before composing final prompt context (`packages/plugin/src/orchestrator/recall-orchestrator.ts:298`, `packages/plugin/src/orchestrator/recall-orchestrator.ts:313`, `packages/plugin/src/orchestrator/recall-orchestrator.ts:343`).
10. The before-prompt hook returns `prependContext` wrapped in memory-fabric markers (`packages/plugin/src/hooks/before-prompt-build.ts:78`, `packages/plugin/src/hooks/before-prompt-build.ts:85`).

### Commit Flow

1. OpenClaw calls the agent-end hook registered by `createPlugin` (`packages/plugin/src/index.ts:109`).
2. The hook normalizes messages, strips previously injected memory blocks, skips sessions without assistant turns, and invokes `CommitOrchestrator.execute()` (`packages/plugin/src/hooks/agent-end.ts:35`, `packages/plugin/src/hooks/agent-end.ts:39`, `packages/plugin/src/hooks/agent-end.ts:46`, `packages/plugin/src/hooks/agent-end.ts:50`).
3. `CommitOrchestrator` calls `/distill`, filters entities, calls `/commit`, merges carrier patches, and conditionally refreshes `self-model.md` (`packages/plugin/src/orchestrator/commit-orchestrator.ts:120`, `packages/plugin/src/orchestrator/commit-orchestrator.ts:138`, `packages/plugin/src/orchestrator/commit-orchestrator.ts:154`, `packages/plugin/src/orchestrator/commit-orchestrator.ts:169`).
4. The sidecar `/commit` route resolves v2 mode, optionally writes L0/L1 v2 records, writes legacy OpenViking memory, and starts async experience distillation (`packages/sidecar/src/routes/commit.ts:112`, `packages/sidecar/src/routes/commit.ts:113`, `packages/sidecar/src/routes/commit.ts:124`, `packages/sidecar/src/routes/commit.ts:149`, `packages/sidecar/src/routes/commit.ts:168`).
5. `EventLedgerService.append()` writes source-backed v2 evidence events (`packages/sidecar/src/services/event-ledger-service.ts:58`, `packages/sidecar/src/services/event-ledger-service.ts:88`, `packages/sidecar/src/services/event-ledger-service.ts:90`).
6. `AtomicMemoryStore.create()` writes candidate records and gates source-less candidates into `needs_review` (`packages/sidecar/src/services/atomic-memory-store.ts:90`, `packages/sidecar/src/services/atomic-memory-store.ts:102`, `packages/sidecar/src/services/atomic-memory-store.ts:105`, `packages/sidecar/src/services/atomic-memory-store.ts:113`).
7. `OpenVikingService.commitSession()` writes scoped `memories.jsonl`, invalidates recall cache, updates `summary.json`, and returns publish candidates (`packages/sidecar/src/services/openviking-service.ts:359`, `packages/sidecar/src/services/openviking-service.ts:418`, `packages/sidecar/src/services/openviking-service.ts:426`, `packages/sidecar/src/services/openviking-service.ts:430`, `packages/sidecar/src/services/openviking-service.ts:454`).
8. `CarrierRepository.merge()` applies markdown carrier merge strategies for journal, decision log, glossary, open questions, and self model (`packages/sidecar/src/services/carrier-service.ts:356`, `packages/sidecar/src/services/carrier-service.ts:436`).

### V2 Consolidation Flow

1. Operators or the web inspector call `/v2/consolidation/worker/start` or `/v2/consolidation/run` (`packages/sidecar/src/routes/v2.ts:454`, `packages/sidecar/src/routes/v2.ts:494`).
2. `ConsolidationWorker.start()` creates an in-process interval and `runOnce()` groups pending candidates by agent/project scope (`packages/sidecar/src/services/consolidation-worker.ts:80`, `packages/sidecar/src/services/consolidation-worker.ts:97`, `packages/sidecar/src/services/consolidation-worker.ts:121`, `packages/sidecar/src/services/consolidation-worker.ts:137`).
3. `MemoryConsolidator.run()` filters source-less, low-quality, low-signal, and high-trust candidates before promotion (`packages/sidecar/src/services/memory-consolidator.ts:98`, `packages/sidecar/src/services/memory-consolidator.ts:115`, `packages/sidecar/src/services/memory-consolidator.ts:126`, `packages/sidecar/src/services/memory-consolidator.ts:135`, `packages/sidecar/src/services/memory-consolidator.ts:145`).
4. Promotion writes stable `MemoryEntryV2` entries, marks candidates promoted, and records relation graph edges (`packages/sidecar/src/services/memory-consolidator.ts:212`, `packages/sidecar/src/services/memory-consolidator.ts:235`, `packages/sidecar/src/services/memory-consolidator.ts:238`, `packages/sidecar/src/services/memory-consolidator.ts:246`).
5. `MemoryCoreV2.create()` builds, persists, indexes, caches, optionally embeds, and emits creation events (`packages/sidecar/src/core/memory-core-v2.ts:170`, `packages/sidecar/src/core/memory-core-v2.ts:200`, `packages/sidecar/src/core/memory-core-v2.ts:201`, `packages/sidecar/src/core/memory-core-v2.ts:205`, `packages/sidecar/src/core/memory-core-v2.ts:223`).

### Carrier Projection Flow

1. Operators call `/v2/carriers/projection/preview`, `/apply-preview`, `/apply`, `/rollback`, or `/history` (`packages/sidecar/src/routes/v2.ts:1166`, `packages/sidecar/src/routes/v2.ts:1188`, `packages/sidecar/src/routes/v2.ts:1199`, `packages/sidecar/src/routes/v2.ts:1221`, `packages/sidecar/src/routes/v2.ts:1232`).
2. The v2 route queries stable memories from `MemoryCoreV2` and delegates to `CarrierProjectionEngine` (`packages/sidecar/src/routes/v2.ts:1172`, `packages/sidecar/src/routes/v2.ts:1180`, `packages/sidecar/src/routes/v2.ts:1213`).
3. Carrier projection APIs depend on `CarrierRepository`; if the sidecar starts without carriers, these endpoints return an explicit configuration error (`packages/sidecar/src/routes/v2.ts:1145`, `packages/sidecar/src/routes/v2.ts:1146`).

### Inspector Web Flow

1. `packages/web/src/main.tsx` mounts `App` into `#root` (`packages/web/src/main.tsx:6`).
2. `App` loads agents/projects and renders the selected page within the shared layout (`packages/web/src/App.tsx:52`, `packages/web/src/App.tsx:82`, `packages/web/src/App.tsx:95`).
3. Browser API calls go through `packages/web/src/api/client.ts`, which resolves an optional `/memory-fabric` base path and wraps `fetch` helpers (`packages/web/src/api/client.ts:50`, `packages/web/src/api/client.ts:57`, `packages/web/src/api/client.ts:73`).
4. Vite dev mode proxies sidecar paths to `http://127.0.0.1:7811` (`packages/web/vite.config.ts:11`, `packages/web/vite.config.ts:14`, `packages/web/vite.config.ts:30`).

**State Management:**
- Plugin state is per plugin instance: `createPlugin()` constructs a config, `SidecarClient`, `Logger`, and `MetricsCollector` (`packages/plugin/src/index.ts:77`).
- Sidecar process state includes instantiated service singletons, in-memory Fastify logger state, `OpenVikingService` index cache, `MemoryCoreV2` cache/index, and `ConsolidationWorker` timer/status (`packages/sidecar/src/server.ts:42`, `packages/sidecar/src/services/openviking-service.ts:218`, `packages/sidecar/src/core/memory-core-v2.ts:126`, `packages/sidecar/src/services/consolidation-worker.ts:64`).
- Durable state is file-based: OpenViking scoped `memories.jsonl`, carrier markdown, shared JSONL, v2 evidence JSONL, v2 candidate JSONL, graph JSON/report files, vector/experience/pattern stores.
- Web state is React local component state: app context and current page are managed in `packages/web/src/App.tsx`.

## Key Abstractions

**MemoryFabricConfig:**
- Purpose: Shared plugin configuration contract for recall budget, sidecar endpoint, OpenViking, Graphify, publish policy, and observability.
- Examples: `packages/plugin/src/types/index.ts`, `packages/plugin/src/config/defaults.ts`, `packages/plugin/src/config/loader.ts`
- Pattern: Typed config plus runtime JSON schema validation.

**SidecarConfig:**
- Purpose: Sidecar runtime configuration resolved from environment variables.
- Examples: `packages/sidecar/src/config/index.ts`
- Pattern: Environment-backed composition input.

**SidecarClient:**
- Purpose: Typed HTTP boundary used by plugin tools and hooks.
- Examples: `packages/plugin/src/utils/sidecar-client.ts`, `packages/plugin/src/tools/memory-brief.ts`, `packages/plugin/src/tools/memory-commit.ts`
- Pattern: Thin client with request timeout and typed method wrappers.

**RecallPlan:**
- Purpose: Encodes recall depth, scope, query, structural-brief need, and task type.
- Examples: `packages/plugin/src/orchestrator/recall-orchestrator.ts`
- Pattern: Heuristic plan object built before any retrieval call.

**CommitContext and CommitResult:**
- Purpose: Bridge normalized hook data to distill, commit, carrier merge, and self-model update.
- Examples: `packages/plugin/src/orchestrator/commit-orchestrator.ts`
- Pattern: Pipeline context/result objects.

**MemoryEntryV2:**
- Purpose: Stable memory schema with type, content blocks, timeline, relations, source tracing, source refs, validity window, quality, status, embedding, and metadata.
- Examples: `packages/sidecar/src/models/schema-v2.ts`
- Pattern: Rich domain model plus `MemoryEntryBuilder` and migration helpers.

**OpenVikingService:**
- Purpose: Legacy scoped memory access and recall formatting over `memories.jsonl`.
- Examples: `packages/sidecar/src/services/openviking-service.ts`
- Pattern: Service/repository hybrid with cache and filesystem persistence.

**MemoryCoreV2:**
- Purpose: V2 stable memory engine for CRUD, query, lifecycle, relations, cache, and persistence.
- Examples: `packages/sidecar/src/core/memory-core-v2.ts`
- Pattern: Core domain service with event hooks and internal cache/index.

**V2ServiceFacade:**
- Purpose: Convenience facade for routes needing high-level v2 CRUD, query, stats, sync, export, backup, cleanup, compact, cache, and index operations.
- Examples: `packages/sidecar/src/services/v2-service-facade.ts`
- Pattern: Facade over core/query/sync/export/cache collaborators.

**AtomicMemoryCandidate:**
- Purpose: Reviewable L1 candidate generated from evidence events before promotion into stable memory.
- Examples: `packages/sidecar/src/services/atomic-memory-store.ts`
- Pattern: Queue record with quality, confidence, status, source refs, and review metadata.

**CarrierRepository:**
- Purpose: Stable markdown carrier filesystem with per-file merge strategies.
- Examples: `packages/sidecar/src/services/carrier-service.ts`
- Pattern: Repository over private/project carrier templates.

**RetrievalPlanner and MemoryCardPackager:**
- Purpose: Intent-aware v2 recall and bounded prompt rendering.
- Examples: `packages/sidecar/src/services/retrieval-planner.ts`, `packages/sidecar/src/services/memory-card-packager.ts`
- Pattern: Planner plus presentation packager.

**GraphifyService:**
- Purpose: Local structural graph bootstrap, query, path, explain, and brief generation.
- Examples: `packages/sidecar/src/services/graphify-service.ts`
- Pattern: Lightweight graph generator over project files.

**Packaged OpenClaw Skills:**
- Purpose: Runtime skill assets bundled with the plugin package.
- Examples: `packages/plugin/skills/execution-gate/SKILL.md`, `packages/plugin/skills/memory-hygiene/SKILL.md`, `packages/plugin/skills/post-task-distill/SKILL.md`, `packages/plugin/skills/project-sensemaking/SKILL.md`
- Pattern: Markdown skill definitions shipped with `packages/plugin`.

## Entry Points

**Root build/test orchestration:**
- Location: `package.json`
- Triggers: developer commands such as `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm test:e2e`.
- Responsibilities: Build web, copy web output into sidecar public assets, build plugin, build sidecar, run package tests.

**OpenClaw plugin manifest:**
- Location: `packages/plugin/openclaw.plugin.json`
- Triggers: OpenClaw plugin discovery/loading.
- Responsibilities: Declares plugin id, activation, `dist/index.js` entry, tools, and config schema.

**Plugin module entry:**
- Location: `packages/plugin/src/index.ts`
- Triggers: OpenClaw imports plugin module.
- Responsibilities: Exports types/utilities, creates plugin instance, registers tools, registers hooks.

**Sidecar server entry:**
- Location: `packages/sidecar/src/server.ts`
- Triggers: `node packages/sidecar/dist/server.js`, `pnpm -C packages/sidecar start`, `scripts/start.sh`, or `scripts/dev-start.sh`.
- Responsibilities: Load config, instantiate services, register routes, listen on configured host/port.

**Web entry:**
- Location: `packages/web/src/main.tsx`
- Triggers: Vite dev server or browser loading built web bundle.
- Responsibilities: Mount React `App`.

**Development sidecar script:**
- Location: `scripts/dev-start.sh`
- Triggers: developer shell usage.
- Responsibilities: Set local runtime directories, build stale sidecar output, and start sidecar with source maps.

**Production-style sidecar script:**
- Location: `scripts/start.sh`
- Triggers: developer shell usage.
- Responsibilities: Set home-directory runtime paths, stop any existing sidecar, start sidecar in background, and health-check it.

**V2 smoke/ops scripts:**
- Location: `scripts/v2-gray-smoke.mjs`, `scripts/v2-acceptance-loop.mjs`, `scripts/v2-commit-smoke.mjs`, `scripts/v2-canary-monitor.mjs`
- Triggers: developer shell usage through root package scripts.
- Responsibilities: Exercise v2 rollout, commit, acceptance, canary, and gray-status workflows.

## Architectural Constraints

- **Threading:** Runtime is single-process Node.js async I/O. `ConsolidationWorker` uses `setInterval` and an `inFlight` guard, not worker threads (`packages/sidecar/src/services/consolidation-worker.ts:64`, `packages/sidecar/src/services/consolidation-worker.ts:97`, `packages/sidecar/src/services/consolidation-worker.ts:121`).
- **Global state:** Plugin-level constants include plugin name/version and recall marker maps (`packages/plugin/src/index.ts:74`, `packages/plugin/src/orchestrator/recall-orchestrator.ts:125`). Sidecar service instances are process singletons created by `buildServer()` (`packages/sidecar/src/server.ts:42`).
- **Persistence model:** Do not assume a database. Use JSONL helpers in `packages/sidecar/src/utils/jsonl.ts`, carrier markdown through `CarrierRepository`, and graph artifacts through `GraphifyService`.
- **Path safety:** User-controlled IDs that become path segments must pass `validateId()` (`packages/sidecar/src/utils/path-guard.ts:25`). File paths relative to an allowed root should use `validatePath()` (`packages/sidecar/src/utils/path-guard.ts:7`).
- **Config boundary:** Plugin config is schema-validated in `packages/plugin/src/config/loader.ts`; sidecar config is environment-resolved in `packages/sidecar/src/config/index.ts`.
- **Rollout behavior:** V2 recall/write is controlled by rollout mode and must preserve legacy fallback semantics in `/commit` and `RecallOrchestrator` (`packages/sidecar/src/routes/commit.ts:113`, `packages/plugin/src/orchestrator/recall-orchestrator.ts:188`).
- **Static web serving:** Root build copies `packages/web/dist/` into `packages/sidecar/public/`; source changes belong in `packages/web/src`, not in generated public files (`package.json:12`).
- **Circular imports:** No circular dependency chain is declared in configuration. Keep plugin -> sidecar communication through HTTP; do not import sidecar modules into plugin source.

## Anti-Patterns

### Route-Level Domain Growth

**What happens:** `packages/sidecar/src/routes/v2.ts` constructs many v2 services and contains route-local rollout/readiness/helper logic in one module (`packages/sidecar/src/routes/v2.ts:38`, `packages/sidecar/src/routes/v2.ts:45`, `packages/sidecar/src/routes/v2.ts:97`).
**Why it's wrong:** Adding domain behavior directly to this file increases coupling between API wiring, rollout policy, business rules, and storage concerns.
**Do this instead:** Put reusable behavior in `packages/sidecar/src/services/*` or `packages/sidecar/src/core/*`, then keep `packages/sidecar/src/routes/v2.ts` to validation, parameter parsing, and delegation.

### Direct Filesystem Memory Writes

**What happens:** Multiple services persist JSONL or markdown files. Bypassing their APIs skips validation, cache invalidation, summary updates, source-ref policy, or carrier merge strategies.
**Why it's wrong:** Direct writes can leave `OpenVikingService` caches stale, create source-less v2 memories, bypass carrier conflict preservation, or violate path safety.
**Do this instead:** Use `OpenVikingService.commitSession()` for legacy scoped memory (`packages/sidecar/src/services/openviking-service.ts:359`), `MemoryCoreV2.create()` for stable v2 memory (`packages/sidecar/src/core/memory-core-v2.ts:170`), `AtomicMemoryStore.create()` for candidates (`packages/sidecar/src/services/atomic-memory-store.ts:90`), and `CarrierRepository.merge()` for carriers (`packages/sidecar/src/services/carrier-service.ts:356`).

### Plugin-Side Persistence

**What happens:** Plugin hooks have rich context and could be tempting places to write files.
**Why it's wrong:** Plugin code should remain a gateway integration layer; sidecar services own filesystem layout, migration, validation, and observability.
**Do this instead:** Keep plugin code in `packages/plugin/src/hooks`, `packages/plugin/src/tools`, and `packages/plugin/src/orchestrator` delegating through `SidecarClient` (`packages/plugin/src/utils/sidecar-client.ts:253`).

### Generated Output Edits

**What happens:** Built files exist under `packages/plugin/dist`, `packages/plugin/dist-test`, `packages/sidecar/dist`, `packages/sidecar/dist-test`, `packages/web/dist`, and `packages/sidecar/public`.
**Why it's wrong:** These files are generated from `src` and package build scripts; manual edits are discarded or create source/build drift.
**Do this instead:** Edit `packages/plugin/src`, `packages/sidecar/src`, or `packages/web/src`, then run the appropriate build command from `package.json`.

## Error Handling

**Strategy:** Non-critical memory enrichment degrades without blocking agent execution; API validation and server errors return structured responses; HTTP client errors surface endpoint/status details.

**Patterns:**
- Fastify uses a unified error handler returning `ErrorResponse` with `BAD_REQUEST` or `SIDECAR_ERROR` (`packages/sidecar/src/server.ts:120`).
- `SidecarClient` throws `SidecarClientError` on non-2xx responses and aborts requests after configured timeout (`packages/plugin/src/utils/sidecar-client.ts:242`, `packages/plugin/src/utils/sidecar-client.ts:266`, `packages/plugin/src/utils/sidecar-client.ts:278`).
- Recall hook failures return a degraded `prependContext` marker instead of blocking the prompt (`packages/plugin/src/hooks/before-prompt-build.ts:63`, `packages/plugin/src/hooks/before-prompt-build.ts:73`).
- Agent-end commit failures are logged as non-fatal (`packages/plugin/src/hooks/agent-end.ts:75`).
- Recall enrichment failures for dynamic rollout, v2 recall, Graphify, and carrier reads are non-fatal (`packages/plugin/src/orchestrator/recall-orchestrator.ts:184`, `packages/plugin/src/orchestrator/recall-orchestrator.ts:277`, `packages/plugin/src/orchestrator/recall-orchestrator.ts:308`, `packages/plugin/src/orchestrator/recall-orchestrator.ts:338`).
- Shared memory and pattern injection errors are non-fatal inside `/recall` (`packages/sidecar/src/routes/recall.ts:52`, `packages/sidecar/src/routes/recall.ts:73`).
- Path and ID validation errors use thrown exceptions in `packages/sidecar/src/utils/path-guard.ts`.

## Cross-Cutting Concerns

**Logging:** Plugin logging uses `Logger` and `MetricsCollector` from `packages/plugin/src/utils`; sidecar uses Fastify logger from `Fastify({ logger: true })` in `packages/sidecar/src/server.ts`.

**Validation:** Plugin config uses AJV (`packages/plugin/src/config/loader.ts`); sidecar routes use Fastify JSON schemas; path segment validation uses `validateId()` (`packages/sidecar/src/utils/path-guard.ts`).

**Authentication:** Not detected. Sidecar routes bind to configured host/port and do not include auth middleware in `packages/sidecar/src/server.ts`.

**Observability:** Plugin metrics cover recall, commit, degraded mode, graph query, carrier injection, and truncation. Sidecar health and inspection endpoints live under `packages/sidecar/src/routes/health.ts` and `packages/sidecar/src/routes/inspect.ts`; v2 gray/canary/status endpoints live in `packages/sidecar/src/routes/v2.ts`.

**Security:** Do not read or emit `.npmrc` contents. A `.npmrc` file exists at repo root, and `.env*` files were not detected in the repository root scan. User-controlled path segments must use `validateId()` before filesystem writes.

---

*Architecture analysis: 2026-06-26*
