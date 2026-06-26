# Codebase Structure

**Analysis Date:** 2026-06-26

## Directory Layout

```text
openclaw-memory-fabric/
|-- .claude/                 # Claude/GSD agent metadata, specs, commands, steering, templates
|-- .codex/                  # Local Codex config/agent metadata; project-local skills not detected
|-- .planning/               # GSD planning artifacts and generated codebase maps
|   `-- codebase/            # Codebase map output directory
|-- docs/                    # Product, architecture, API, deployment, v2, and progress docs
|   `-- progress/            # Phase-by-phase implementation records
|-- examples/                # Example config and bootstrap walkthrough
|   |-- config/
|   `-- project-sample/
|-- memory/                  # Project memory markdown used by this repo
|-- packages/                # pnpm workspace packages
|   |-- plugin/              # OpenClaw plugin package
|   |   |-- skills/          # Packaged OpenClaw runtime skill assets
|   |   |-- src/             # Plugin TypeScript source
|   |   `-- test/            # Plugin tests
|   |-- sidecar/             # Fastify sidecar package
|   |   |-- public/          # Copied web build output target
|   |   |-- src/             # Sidecar TypeScript source
|   |   `-- test/            # Sidecar tests
|   `-- web/                 # React/Vite inspector package
|       `-- src/             # Web UI TypeScript/React source
|-- scripts/                 # Dev, start/stop, health, e2e, v2 smoke/canary scripts
|   `-- e2e/                 # Node test e2e scenario
|-- package.json             # Root workspace scripts
|-- pnpm-workspace.yaml      # Workspace package list
|-- tsconfig.base.json       # Shared Node package TypeScript config
|-- eslint.config.js         # ESLint config
|-- .prettierrc.json         # Prettier config
|-- .npmrc                   # Package-manager config; do not read or quote contents
`-- AGENTS.md                # Project-level agent instructions
```

## Directory Purposes

**`.planning/codebase`:**
- Purpose: Holds GSD codebase map documents.
- Contains: `ARCHITECTURE.md`, `STRUCTURE.md`.
- Key files: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`.

**`docs`:**
- Purpose: Human-facing product, architecture, API, development, deployment, roadmap, and audit documentation.
- Contains: Markdown docs such as `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEVELOPMENT.md`, `docs/v2-production-roadmap.md`.
- Key files: `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEVELOPMENT.md`, `docs/web-v2-inspector-audit.md`.

**`docs/progress`:**
- Purpose: Per-phase delivery records.
- Contains: `phase-01.md` through `phase-14.md` plus README.
- Key files: `docs/progress/README.md`, `docs/progress/phase-14.md`.

**`examples`:**
- Purpose: Demonstrates configuration and project bootstrap.
- Contains: `examples/config/memory-fabric.yaml`, `examples/project-sample/README.md`, `examples/project-sample/bootstrap.sh`.
- Key files: `examples/config/memory-fabric.yaml`, `examples/project-sample/bootstrap.sh`.

**`memory`:**
- Purpose: Repo-local project memory/reference markdown.
- Contains: `memory/MEMORY.md`, `memory/project-openclaw-memory-fabric.md`.
- Key files: `memory/MEMORY.md`.

**`packages/plugin`:**
- Purpose: OpenClaw native plugin package.
- Contains: plugin source, plugin manifest, packaged skill assets, tests, package TypeScript configs.
- Key files: `packages/plugin/src/index.ts`, `packages/plugin/openclaw.plugin.json`, `packages/plugin/package.json`.

**`packages/plugin/src`:**
- Purpose: Plugin runtime source loaded by OpenClaw after build.
- Contains: `adapters`, `carriers`, `config`, `hooks`, `observability`, `orchestrator`, `tools`, `types`, `utils`.
- Key files: `packages/plugin/src/index.ts`, `packages/plugin/src/config/loader.ts`, `packages/plugin/src/utils/sidecar-client.ts`.

**`packages/plugin/src/hooks`:**
- Purpose: OpenClaw hook handlers.
- Contains: `before-prompt-build.ts`, `agent-end.ts`, `before-tool-call.ts`, `after-tool-call.ts`, `types.ts`.
- Key files: `packages/plugin/src/hooks/before-prompt-build.ts`, `packages/plugin/src/hooks/agent-end.ts`.

**`packages/plugin/src/orchestrator`:**
- Purpose: Hook-level memory planning and commit pipelines.
- Contains: recall/commit orchestrators and prompt injection rules.
- Key files: `packages/plugin/src/orchestrator/recall-orchestrator.ts`, `packages/plugin/src/orchestrator/commit-orchestrator.ts`, `packages/plugin/src/orchestrator/prompt-injection-policy.ts`.

**`packages/plugin/src/tools`:**
- Purpose: OpenClaw tool implementations backed by sidecar HTTP calls.
- Contains: health, brief, commit, shared publish/forget, bootstrap, graph, carrier tools.
- Key files: `packages/plugin/src/tools/memory-brief.ts`, `packages/plugin/src/tools/memory-commit.ts`, `packages/plugin/src/tools/project-graph-tools.ts`, `packages/plugin/src/tools/carrier-tools.ts`.

**`packages/plugin/skills`:**
- Purpose: Runtime skill definitions packaged with the OpenClaw plugin.
- Contains: `execution-gate`, `memory-hygiene`, `post-task-distill`, `project-sensemaking`.
- Key files: `packages/plugin/skills/execution-gate/SKILL.md`, `packages/plugin/skills/memory-hygiene/SKILL.md`, `packages/plugin/skills/post-task-distill/SKILL.md`, `packages/plugin/skills/project-sensemaking/SKILL.md`.

**`packages/sidecar`:**
- Purpose: Local Fastify sidecar package and HTTP API.
- Contains: source, tests, static public directory, package TypeScript configs.
- Key files: `packages/sidecar/src/server.ts`, `packages/sidecar/package.json`.

**`packages/sidecar/src`:**
- Purpose: Sidecar runtime source.
- Contains: `adapters`, `api`, `config`, `core`, `models`, `routes`, `services`, `stores`, `utils`.
- Key files: `packages/sidecar/src/server.ts`, `packages/sidecar/src/config/index.ts`.

**`packages/sidecar/src/routes`:**
- Purpose: Fastify route registration modules.
- Contains: legacy endpoints, graph/inspect/shared/federation endpoints, batch endpoints, and broad v2 endpoints.
- Key files: `packages/sidecar/src/routes/recall.ts`, `packages/sidecar/src/routes/commit.ts`, `packages/sidecar/src/routes/carrier.ts`, `packages/sidecar/src/routes/v2.ts`.

**`packages/sidecar/src/services`:**
- Purpose: Domain services for memory, carriers, graphing, sharing, v2 rollout, retrieval, consolidation, projection, learning, and reporting.
- Contains: service classes used by routes.
- Key files: `packages/sidecar/src/services/openviking-service.ts`, `packages/sidecar/src/services/carrier-service.ts`, `packages/sidecar/src/services/retrieval-planner.ts`, `packages/sidecar/src/services/memory-consolidator.ts`.

**`packages/sidecar/src/core`:**
- Purpose: V2 memory engine and query infrastructure.
- Contains: memory core, index/cache, query router, advanced query, sync, export/import.
- Key files: `packages/sidecar/src/core/memory-core-v2.ts`, `packages/sidecar/src/core/query-router.ts`, `packages/sidecar/src/core/memory-index.ts`, `packages/sidecar/src/core/memory-cache.ts`.

**`packages/sidecar/src/models`:**
- Purpose: Shared sidecar API/domain model types.
- Contains: legacy model index and v2 memory schema.
- Key files: `packages/sidecar/src/models/index.ts`, `packages/sidecar/src/models/schema-v2.ts`.

**`packages/sidecar/src/stores`:**
- Purpose: JSONL-backed stores for vector, experience, pattern, and skill draft state.
- Contains: store classes used by sidecar services.
- Key files: `packages/sidecar/src/stores/vector-store.ts`, `packages/sidecar/src/stores/vector-store-v2.ts`, `packages/sidecar/src/stores/experience-store.ts`, `packages/sidecar/src/stores/pattern-store.ts`, `packages/sidecar/src/stores/skill-draft-store.ts`.

**`packages/sidecar/src/utils`:**
- Purpose: Filesystem and mode helpers.
- Contains: JSONL helpers, path guards, v2 mode parsing, v2 path resolution.
- Key files: `packages/sidecar/src/utils/jsonl.ts`, `packages/sidecar/src/utils/path-guard.ts`, `packages/sidecar/src/utils/v2-mode.ts`, `packages/sidecar/src/utils/v2-paths.ts`.

**`packages/web`:**
- Purpose: Inspector web UI package.
- Contains: React/Vite source, package config, Tailwind/PostCSS/Vite configs.
- Key files: `packages/web/src/main.tsx`, `packages/web/src/App.tsx`, `packages/web/src/api/client.ts`, `packages/web/vite.config.ts`.

**`packages/web/src/pages`:**
- Purpose: Top-level inspector pages.
- Contains: overview, memory browser, graph view, carrier viewer, learning dashboard, federation page, and v2 inspector.
- Key files: `packages/web/src/pages/Overview.tsx`, `packages/web/src/pages/MemoryBrowser.tsx`, `packages/web/src/pages/V2Inspector.tsx`.

**`packages/web/src/components`:**
- Purpose: Shared UI shell and reusable presentational components.
- Contains: layout, sidebar, status bar, metrics row, page header.
- Key files: `packages/web/src/components/Layout.tsx`, `packages/web/src/components/Sidebar.tsx`, `packages/web/src/components/StatusBar.tsx`.

**`scripts`:**
- Purpose: Runtime, health, e2e, and v2 operations scripts.
- Contains: shell scripts and Node smoke/canary scripts.
- Key files: `scripts/dev-start.sh`, `scripts/start.sh`, `scripts/health-check.sh`, `scripts/e2e/e2e.test.mjs`, `scripts/v2-gray-smoke.mjs`.

## Key File Locations

**Entry Points:**
- `packages/plugin/src/index.ts`: Plugin module factory, exported types/utilities, tool registration, hook registration.
- `packages/plugin/openclaw.plugin.json`: OpenClaw plugin manifest and declared tool/config schema.
- `packages/sidecar/src/server.ts`: Fastify sidecar composition root and direct-run listener.
- `packages/web/src/main.tsx`: React app mount point.
- `packages/web/src/App.tsx`: Inspector app state and page routing.
- `scripts/dev-start.sh`: Local sidecar startup with repo-local runtime directories.
- `scripts/start.sh`: Home-directory sidecar startup with pid/log handling.

**Configuration:**
- `package.json`: Root scripts and workspace-level dependency versions.
- `pnpm-workspace.yaml`: Workspace package glob `packages/*`.
- `tsconfig.base.json`: Shared Node package TypeScript compiler options.
- `packages/plugin/tsconfig.json`: Plugin build config.
- `packages/sidecar/tsconfig.json`: Sidecar build config.
- `packages/web/tsconfig.json`: Web TypeScript config.
- `packages/web/vite.config.ts`: Vite plugin, base path, output directory, and sidecar dev proxies.
- `packages/plugin/src/config/defaults.ts`: Plugin default config values.
- `packages/plugin/src/config/loader.ts`: Plugin runtime config validation.
- `packages/sidecar/src/config/index.ts`: Sidecar environment config resolver.
- `.prettierrc.json`: Prettier config.
- `eslint.config.js`: ESLint config.
- `.npmrc`: Package-manager config file exists; do not read or quote contents.

**Core Logic:**
- `packages/plugin/src/hooks/before-prompt-build.ts`: Prompt-time recall hook.
- `packages/plugin/src/hooks/agent-end.ts`: Session-end commit hook.
- `packages/plugin/src/orchestrator/recall-orchestrator.ts`: Recall planning, v2/legacy selection, structural/carrier enrichment.
- `packages/plugin/src/orchestrator/commit-orchestrator.ts`: Distill/commit/carrier/self-model pipeline.
- `packages/plugin/src/utils/sidecar-client.ts`: HTTP boundary between plugin and sidecar.
- `packages/sidecar/src/routes/recall.ts`: Legacy `/recall` route.
- `packages/sidecar/src/routes/commit.ts`: `/commit` route with v2 rollout gate and legacy fallback.
- `packages/sidecar/src/routes/v2.ts`: V2 APIs for events, candidates, consolidation, recall plans, rollout, carrier projection, benchmarks, canary, and ops.
- `packages/sidecar/src/services/openviking-service.ts`: Legacy memory persistence and recall.
- `packages/sidecar/src/services/carrier-service.ts`: Carrier markdown templates and merge strategies.
- `packages/sidecar/src/core/memory-core-v2.ts`: Stable v2 memory CRUD/query/persistence engine.
- `packages/sidecar/src/models/schema-v2.ts`: V2 memory schema, builder, validation, migration helpers.
- `packages/sidecar/src/services/event-ledger-service.ts`: V2 evidence event ledger.
- `packages/sidecar/src/services/atomic-memory-store.ts`: V2 candidate queue.
- `packages/sidecar/src/services/memory-consolidator.ts`: Candidate promotion and relation creation.
- `packages/sidecar/src/services/retrieval-planner.ts`: V2 recall ranking and card selection.
- `packages/sidecar/src/services/memory-card-packager.ts`: Prompt card formatting.
- `packages/sidecar/src/services/carrier-projection-engine.ts`: V2 stable memory projection into carriers.
- `packages/web/src/api/client.ts`: Browser API client.

**Testing:**
- `packages/plugin/test`: Plugin unit tests.
- `packages/sidecar/test`: Sidecar unit/integration tests.
- `scripts/e2e/e2e.test.mjs`: E2E test that runs against compiled sidecar output.
- `packages/plugin/tsconfig.test.json`: Plugin test TypeScript build config.
- `packages/sidecar/tsconfig.test.json`: Sidecar test TypeScript build config.

**Documentation:**
- `README.md`: Quick start, layout, endpoints, and scripts overview.
- `docs/ARCHITECTURE.md`: Full existing architecture reference.
- `docs/API.md`: API docs.
- `docs/DEVELOPMENT.md`: Development instructions.
- `docs/progress/README.md`: Progress index.

## Naming Conventions

**Files:**
- Use kebab-case for most TypeScript modules: `before-prompt-build.ts`, `recall-orchestrator.ts`, `memory-core-v2.ts`, `carrier-projection-engine.ts`.
- Use `index.ts` for package or folder entry/re-export files: `packages/plugin/src/index.ts`, `packages/sidecar/src/models/index.ts`.
- Use PascalCase for React page/component filenames: `packages/web/src/App.tsx`, `packages/web/src/pages/V2Inspector.tsx`, `packages/web/src/components/StatusBar.tsx`.
- Use lowercase package config names: `package.json`, `tsconfig.json`, `vite.config.ts`.
- Use uppercase markdown map/doc names when they are top-level references: `README.md`, `CHANGELOG.md`, `.planning/codebase/ARCHITECTURE.md`.
- Use `*.test.ts` for package tests and `*.test.mjs` for the root e2e node test.

**Directories:**
- Workspace packages live under `packages/<package-name>`.
- Source code lives under `packages/*/src`.
- Tests live under `packages/*/test` for package tests and `scripts/e2e` for the root e2e scenario.
- Sidecar route modules live under `packages/sidecar/src/routes`.
- Sidecar domain services live under `packages/sidecar/src/services`.
- Sidecar v2 engine modules live under `packages/sidecar/src/core`.
- Web page components live under `packages/web/src/pages`; reusable web UI components live under `packages/web/src/components`.
- Packaged OpenClaw skills live under `packages/plugin/skills/<skill-name>/SKILL.md`.

## Where to Add New Code

**New Plugin Tool:**
- Primary code: add a factory in `packages/plugin/src/tools/<tool-name>.ts`.
- HTTP method: add a typed request/response method in `packages/plugin/src/utils/sidecar-client.ts` if the tool talks to the sidecar.
- Registration: register the tool in `packages/plugin/src/index.ts` and update `packages/plugin/openclaw.plugin.json`.
- Tests: add tests in `packages/plugin/test`.

**New Plugin Hook Behavior:**
- Primary code: put hook-specific logic in `packages/plugin/src/hooks`.
- Shared planning/commit behavior: put reusable pipeline logic in `packages/plugin/src/orchestrator`.
- Types: add event/context types in `packages/plugin/src/hooks/types.ts` or shared config/domain types in `packages/plugin/src/types/index.ts`.
- Tests: add tests in `packages/plugin/test`.

**New Sidecar Legacy Endpoint:**
- Route: add `packages/sidecar/src/routes/<feature>.ts` with a `register<Feature>Route(s)` function.
- Service logic: add or extend `packages/sidecar/src/services/<feature>-service.ts`.
- Models: add shared request/response/domain types in `packages/sidecar/src/models/index.ts`.
- Registration: register the route in `packages/sidecar/src/server.ts`.
- Tests: add route/service tests in `packages/sidecar/test`.

**New Sidecar V2 Endpoint:**
- Route wiring: add minimal validation/delegation in `packages/sidecar/src/routes/v2.ts`.
- Domain behavior: put logic in `packages/sidecar/src/services/*` or `packages/sidecar/src/core/*`.
- Stable memory changes: extend `packages/sidecar/src/models/schema-v2.ts` and related `MemoryCoreV2` code.
- Tests: add focused tests in `packages/sidecar/test` for service/core behavior and route integration as needed.

**New V2 Memory Service:**
- Primary code: `packages/sidecar/src/services/<domain>-service.ts`.
- Persistence helper: use `packages/sidecar/src/utils/jsonl.ts`, `packages/sidecar/src/utils/path-guard.ts`, or a dedicated store in `packages/sidecar/src/stores`.
- Route access: wire through `packages/sidecar/src/routes/v2.ts` or a focused route module if it is not part of v2.
- Tests: add unit tests in `packages/sidecar/test`.

**New Stable Memory Schema Field:**
- Model: update `packages/sidecar/src/models/schema-v2.ts`.
- Core handling: update `packages/sidecar/src/core/memory-core-v2.ts`.
- Query/index behavior: update `packages/sidecar/src/core/memory-index.ts`, `packages/sidecar/src/core/query-router.ts`, or `packages/sidecar/src/services/retrieval-planner.ts` if the field affects retrieval.
- Tests: add schema/core tests in `packages/sidecar/test`.

**New Carrier File or Merge Strategy:**
- Carrier definitions: edit `packages/sidecar/src/services/carrier-service.ts`.
- Projection behavior: update `packages/sidecar/src/services/carrier-projection-engine.ts` if v2 projection should manage it.
- Plugin recall enrichment: update `packages/plugin/src/orchestrator/recall-orchestrator.ts` if the carrier should be injected for a task type/depth.
- Tests: add carrier merge tests in `packages/sidecar/test`.

**New Graph/Structural Feature:**
- Core graph behavior: edit `packages/sidecar/src/services/graphify-service.ts` or add a service under `packages/sidecar/src/services`.
- Plugin exposure: add/update tools in `packages/plugin/src/tools/project-graph-tools.ts`.
- Web UI: add/update graph UI under `packages/web/src/pages/GraphView.tsx` or related components.
- Tests: add sidecar tests in `packages/sidecar/test`.

**New Inspector Page:**
- Page component: add `packages/web/src/pages/<PageName>.tsx`.
- Type updates: add page identifiers in `packages/web/src/types/index.ts`.
- Navigation/rendering: update `packages/web/src/App.tsx` and `packages/web/src/components/Sidebar.tsx`.
- API calls: add client methods in `packages/web/src/api/client.ts`.

**New Web Component:**
- Shared component: add to `packages/web/src/components`.
- Page-specific component: keep near the page only if it is not reused; otherwise move to `packages/web/src/components`.
- API state hook: add to `packages/web/src/hooks`.

**Utilities:**
- Plugin utilities: `packages/plugin/src/utils`.
- Sidecar filesystem/path utilities: `packages/sidecar/src/utils`.
- Sidecar reusable in-memory/file stores: `packages/sidecar/src/stores`.
- Web API helpers: `packages/web/src/api`.
- Web data hooks: `packages/web/src/hooks`.

**Docs:**
- Product/API/development docs: `docs`.
- Phase records: `docs/progress`.
- Examples: `examples`.
- Codebase map docs: `.planning/codebase`.

## Special Directories

**`.claude`:**
- Purpose: Agent workflow metadata, specs, steering, templates, and commands.
- Generated: No for checked-in workflow assets.
- Committed: Partially; verify with `git ls-files .claude` before editing.

**`.codex`:**
- Purpose: Local Codex project metadata.
- Generated: Local/runtime-managed.
- Committed: No tracked files detected in the current checkout.

**`.planning`:**
- Purpose: GSD planning and codebase-map artifacts.
- Generated: Yes.
- Committed: No tracked files detected before this mapping run.

**`packages/plugin/dist`:**
- Purpose: TypeScript build output for the OpenClaw plugin.
- Generated: Yes.
- Committed: No tracked files detected in the current checkout.

**`packages/plugin/dist-test`:**
- Purpose: TypeScript test build output for plugin tests.
- Generated: Yes.
- Committed: No tracked files detected in the current checkout.

**`packages/sidecar/dist`:**
- Purpose: TypeScript build output for the sidecar.
- Generated: Yes.
- Committed: No tracked files detected in the current checkout.

**`packages/sidecar/dist-test`:**
- Purpose: TypeScript test build output for sidecar tests.
- Generated: Yes.
- Committed: No tracked files detected in the current checkout.

**`packages/web/dist`:**
- Purpose: Vite web build output.
- Generated: Yes.
- Committed: No tracked files detected in the current checkout.

**`packages/sidecar/public`:**
- Purpose: Static web assets served by sidecar after root build copies `packages/web/dist/`.
- Generated: Yes.
- Committed: No tracked files detected in the current checkout.

**`node_modules` and `packages/*/node_modules`:**
- Purpose: Installed dependencies.
- Generated: Yes.
- Committed: No.

**`packages/plugin/skills`:**
- Purpose: OpenClaw runtime skill assets shipped with plugin package.
- Generated: No.
- Committed: Yes.

**`memory`:**
- Purpose: Repo-local memory reference files.
- Generated: No.
- Committed: Yes.

**`.npmrc`:**
- Purpose: Package-manager configuration.
- Generated: No.
- Committed: Present in working tree; contents intentionally not read.

---

*Structure analysis: 2026-06-26*
