# Changelog

All notable changes to this project are documented here.

## 1.7.0 - 2026-05-20

### Phase B: Inspector Web UI 重构
- 新增 `packages/web` 前端包 — React 18 + Vite + TypeScript + Tailwind CSS
- 5 个页面: 总览、记忆浏览、知识图谱 (react-force-graph-2d)、载体文件 (react-markdown)、自学习仪表板
- Sidecar 改用 `@fastify/static` 提供 SPA 静态文件，删除 808 行嵌入式 HTML

### Phase C: 自学习闭环增强
- 3 维度评分 (goal/tool/knowledge) 替代单一启发式 scoring
- self-model confidence 自动演进 (low→medium→high)
- 经验去重: Jaccard 相似度 (≥0.7) + 500 条上限自动压缩
- 学习曲线: `/inspect/learning-curve` API + SVG 折线图可视化

### Phase D: 记忆生命周期管理
- `lifecycle-service.ts`: 衰减评分 (指数衰减 + 类型加权) 整合进 recall 排序
- 容量控制: `compactMemoryFile()` 超 1000 条自动压缩到 750 条
- `summary.json` 乐观锁版本控制 (冲突检测 + 自动重试)
- `POST /lifecycle/gc` 垃圾回收端点 (清理 shared entries + skill drafts)

### Phase E: 性能与扩展
- OpenVikingService 60s TTL 内存索引缓存
- EmbeddingService 512 条 LRU 嵌入缓存
- `GraphifyService.incrementalUpdate()` 增量图谱更新
- `POST /batch/recall` + `POST /batch/commit` 批量操作 (最多 10 并发)

### Phase F: 多工作空间联邦
- `federation-service.ts`: 跨项目知识导出/导入/撤回
- 多项目依赖图谱 (自动追踪 + `GET /federation/dependencies`)
- 自适应记忆预算 (`POST /federation/recommend-budget`)
- 共享记忆审批流 (submit → pending → approved/rejected)

### 其他
- 自学习质量提升: 知识评分过滤 + self-model 主动合并 + 图谱自举
- 模式检测频率从每 10 次提升到每 5 次
- 技能生成置信度门槛从 5 降到 3
- 测试: 40 plugin + 107 sidecar = **147 总测试**

---

## 1.6.0 - 2026-04-16

### Requirements Gap Closure (PRD/Architecture alignment)

**Tool registration completeness**
- Added `memory-brief.ts`, `memory-commit.ts`, `project-bootstrap.ts`, `project-state-refresh.ts`, `project-graph-tools.ts`, `carrier-tools.ts` — 9 new tool handler files
- `createPlugin()` now registers all 12 tools: `health_status`, `memory_brief`, `memory_commit`, `memory_publish_shared`, `memory_forget_scoped`, `project_bootstrap`, `project_state_refresh`, `project_graph_query`, `project_graph_path`, `project_graph_explain`, `carrier_read`, `carrier_merge`
- `openclaw.plugin.json` tools array updated to match: all 12 tools with full `inputSchema`, required fields, and `agentId` params

**configSchema: recallBudget**
- Added `recallBudget` object to `openclaw.plugin.json` configSchema with `l0Tokens`/`l1Tokens`/`l2Tokens` fields (minimum: 1)

**New hooks: before_tool_call / after_tool_call**
- `hooks/before-tool-call.ts`: logs high-value tool calls (write, create, delete, commit, deploy, publish) at debug level
- `hooks/after-tool-call.ts`: logs every tool result summary (tool name, latency, result shape) at debug level
- Registered in `createPlugin()` and `openclaw.plugin.json`

**health_status: full component checks**
- `routes/health.ts` now checks `openviking.basePath` readability, `graphify.basePath` availability, and `carriers.root` writability
- Returns `components.openviking.reachable`, `components.graphify.available`, `components.carriers.writable`, `uptimeSeconds`, `lastRefreshTime`
- Plugin `health-status.ts` and `HealthResponse` type updated to surface all component flags

**org_shared: independent directory routing**
- `SharedService.sharedDir()` now routes by visibility: `project_shared → shared/projects/<id>/`, `org_shared → shared/org/`
- `forget()` searches both directories for a given project
- `recall()` merges entries from both directories
- Added `recallOrg()` for org-level-only queries

**Path security: validateId + validatePath**
- New `utils/path-guard.ts`: `validateId()` blocks path separators and `..` in agentId/projectId; `validatePath()` detects directory traversal via resolve-prefix check
- Applied in `CarrierRepository.initAgent/initProject/read/merge`, `SharedService.publish`, `GraphifyService.bootstrapProjectGraph`

**Metrics: graph and carrier coverage**
- `MetricsCollector` adds `graphBootstrapCount/TotalMs`, `graphQueryCount/TotalMs`, `carrierMergeConflictCount`
- `RecallOrchestrator` records graph brief latency via `recordGraphQuery()`
- `CommitOrchestrator` records carrier merge skipped count via `recordCarrierMergeConflicts()`
- `snapshot()` exposes `graphBootstrapAvgMs` and `graphQueryAvgMs`
- Orchestrators accept optional `MetricsCollector` — hooks pass the plugin-level instance

## 1.5.0 - 2026-04-16

### Code Quality: ESLint + Prettier

- added `eslint.config.js` — ESLint 9 flat config with `typescript-eslint` (type-aware, `recommendedTypeChecked`), `eslint-config-prettier`, and project-level `parserOptions.project` pointing to all four tsconfigs (src + test for each package)
- added `.prettierrc.json` — 100 char print width, double quotes, no trailing comma, LF
- added `.prettierignore`
- added `"type": "module"` to root `package.json` (eliminates ESLint startup warning)
- added `lint`, `lint:fix`, `format`, `format:check` scripts to root and both packages
- fixed all lint errors across codebase:
  - `commit-orchestrator.ts`: renamed unused `date` param to `_date`
  - `health-status.ts`: removed dead assignment in catch block
  - `distill-service.ts`: fixed `\-` useless escape in regex character class
  - `config/loader.ts`: removed stale `eslint-disable` comments (rules now configured globally)
- configured rule exceptions: `@typescript-eslint/require-await` off (Fastify async handlers), `@typescript-eslint/no-floating-promises` off in test files (node:test `describe`/`it` return Promise), `@typescript-eslint/no-require-imports` off (intentional `createRequire` for ajv CJS interop)
- `pnpm lint` → 0 errors; `pnpm format:check` → all files pass

## 1.4.0 - 2026-04-16

### Phase 13 (continued): Full test coverage + delivery artifacts

#### Additional unit tests
- **sidecar** `test/openviking-scope.test.ts` (18 tests): scope routing (private/project/auto/no-projectId fallback), brief composition (type grouping, metadata, keyword scoring, depth limits l0/l1), commit→recall round-trip, multi-agent isolation
- **sidecar** `test/routes-integration.test.ts` (27 tests): HTTP integration via Fastify `inject()` — GET /health, POST /recall (schema validation, commit→recall), POST /commit (count, 400), POST /distill, POST /carrier/init + /carrier/read, POST /shared/publish + /shared/recall + /shared/forget + recall-route shared append

#### E2E tests (`scripts/e2e/e2e.test.mjs`, 9 tests)
- Starts a real sidecar on port 17811, cleans up after suite
- Scenario 1: health check
- Scenario 2: multi-agent isolation (agent A cannot see agent B memories)
- Scenario 3: cross-session persistence (committed memory retrievable in next session)
- Scenario 4: shared governance (publish → recall → retract cycle; retracted entry no longer recalled)
- Scenario 5: graceful degradation (unknown agent, invalid scope, empty distill)
- Scenario 6: full pipeline round-trip (distill → commit → recall)
- `pnpm test:e2e` wired at root

#### Scripts
- `scripts/dev-start.sh` — starts sidecar with configurable port and data dir
- `scripts/dev-stop.sh` — kills sidecar by matching process
- `scripts/health-check.sh` — pings /health and exits non-zero on failure

#### Example project
- `examples/project-sample/README.md` — step-by-step bootstrap walkthrough
- `examples/project-sample/bootstrap.sh` — automated init + commit + verify script

#### Other
- `packages/plugin/src/observability/index.ts` — re-exports Logger, MetricsCollector per spec directory structure
- `README.md` rewritten with quick-start commands, endpoint table, env variables table, phase progress table, troubleshooting section

#### Test totals (all green)
```
plugin unit:  18 tests,  18 pass,  0 fail
sidecar unit: 52 tests,  52 pass,  0 fail
E2E:           9 tests,   9 pass,  0 fail
────────────────────────────────────────
total:        79 tests,  79 pass,  0 fail
```

## 1.3.0 - 2026-04-15

### Phase 13: Tests

- added `tsconfig.test.json` to plugin and sidecar packages (compiles `src/` + `test/` → `dist-test/`)
- added `"test"` scripts using `node:test` + `node:assert/strict` — zero external test framework dependencies
- **plugin** `test/config-loader.test.ts` (6 tests): default merge, partial overrides, nested section merge, schema rejection (invalid enum, below-minimum number), error shape
- **plugin** `test/recall-orchestrator.test.ts` (12 tests): depth heuristics (l0/l1/l2), `needsStructuralBrief` gating, scope resolution, execute happy path, graphify enrichment, graceful sidecar failure, carrier enrichment at L1
- **sidecar** `test/carrier-merge.test.ts` (12 tests): init idempotency, all 5 merge strategies (overwrite / append / dedup-append / ordered-accumulate / conflict-preserve), skip cases for unknown filenames and missing projectId
- **sidecar** `test/distill-service.test.ts` (9 tests): empty input, role filtering, pattern extraction (decisions / entities / unresolved), deduplication, output caps, publishCandidates derivation
- root `pnpm test` delegates to all packages: **39 tests, 0 failures**

## 1.2.0 - 2026-04-15

### Phase 12: Observability

- added `packages/plugin/src/utils/logger.ts` — `Logger` class writing structured JSON to stderr (configurable min level, `timed<T>()` helper)
- added `packages/plugin/src/utils/metrics.ts` — `MetricsCollector` with in-memory counters for recall/commit latency, error rates, degraded-mode events, shared publishes; `snapshot()` includes computed averages
- updated `packages/plugin/src/tools/health-status.ts` — now async, pings sidecar for real reachability check, returns `sidecarReachable` + full metrics snapshot
- updated `packages/plugin/src/hooks/before-prompt-build.ts` — structured logging + metrics recording on success and degraded-mode fallback
- updated `packages/plugin/src/hooks/agent-end.ts` — structured logging + metrics recording on commit success/failure; removed `console.warn`
- updated `createPlugin()` — instantiates Logger and MetricsCollector, passes to both hook factories
- `pnpm -r build` clean

### Phase 11: Shared Governance

- added `packages/sidecar/src/services/shared-service.ts` — `SharedEntry` JSONL store per project; audit-safe retraction (marks `status: "retracted"`, never deletes); keyword-scored `recall()`
- added `POST /shared/publish`, `POST /shared/forget`, `GET /shared/recall` routes
- updated `POST /recall` — appends shared entries to MemoryBrief when `scope === "shared" || "auto"` and projectId is present
- added `createMemoryPublishShared()` and `createMemoryForgetScoped()` plugin tools
- plugin `SidecarClient` extended with `sharedPublish()` / `sharedForget()` methods

## 0.9.0 - 2026-04-15

### Phase 9: Graphify Integration

- added `src/services/graphify-service.ts` — local graph construction (entity extraction via PascalCase + headings + file stems, co-occurrence edges, top-200 nodes / 500 edges, Union-Find community detection)
- generates `graph.json` + `GRAPH_REPORT.md` under `GRAPHIFY_BASE_PATH/<projectId>/graphify-out/`
- `POST /bootstrap`, `POST /graph/brief`, `POST /graph/query`, `POST /graph/path`, `POST /graph/explain` routes
- plugin `SidecarClient` extended with graph endpoints
- `RecallOrchestrator` injects Structural Brief at L1/L2 depth; gracefully skips when graph is missing

### Phase 10: Skills Packaging

- replaced all four SKILL.md placeholders with full definitions (frontmatter, triggers, rules, output formats, examples, degradation paths)
  - `project-sensemaking`: structural orientation before any retrieval
  - `memory-hygiene`: classification guide for long-term storage
  - `execution-gate`: Gate Block protocol before gated actions
  - `post-task-distill`: Distillation Block at task close

## 0.7.0 - 2026-04-15

### Phase 7: Hook Injection and Memory Brief

- added `src/utils/sidecar-client.ts` — typed HTTP client with `AbortController` timeout, `SidecarClientError` on failure
- added `src/hooks/types.ts` — `BeforePromptBuildContext`, `AgentEndContext`, `HookMessage`, `HookToolCall`
- added `src/orchestrator/recall-orchestrator.ts` — `RecallOrchestrator` with heuristic depth/scope detection and carrier enrichment at L1/L2
- added `src/hooks/before-prompt-build.ts` — idempotent carrier init + recall + context injection with graceful degradation
- `createPlugin()` now exposes `hooks.before_prompt_build` and `hooks.agent_end`
- added `engines: { node: ">=18.0.0" }` to plugin `package.json`

### Phase 8: Distill and Commit

- added `src/services/distill-service.ts` (sidecar) — `DistillService` with regex-based extraction of facts/decisions/entities/patterns/unresolved
- added `POST /distill` route: takes `agentId` + `messages[]`, returns `DistillOutput`
- added `src/orchestrator/commit-orchestrator.ts` (plugin) — four-step pipeline: distill → commit → carrier merge → self-model update
- added `src/hooks/agent-end.ts` — wraps CommitOrchestrator in non-fatal try/catch
- verified full distill→commit→recall round-trip with Chinese content

## 0.5.0 - 2026-04-15

### Phase 6: Carrier File System

- added `src/services/carrier-service.ts` with `CarrierRepository` — 9 carrier file definitions, each with an explicit merge strategy (overwrite / append / dedup-append / ordered-accumulate / conflict-preserve)
- `initAgent` / `initProject` are idempotent — safe to call on every session start
- `POST /carrier/init`, `POST /carrier/read`, `POST /carrier/merge` routes
- added `carriers.root` to sidecar config (env: CARRIERS_ROOT, default `~/.memory-fabric/carriers`)

## 0.4.0 - 2026-04-15

### Phase 5: OpenViking Local Adapter

- replaced mock `/recall` and `/commit` with real disk-based memory storage
- added `src/adapters/openviking-adapter.ts` — `resolveScopePath` + `buildVikingUri`
- added `src/services/openviking-service.ts` — `recallMemory` (JSONL read + keyword scoring), `commitSession` (JSONL append + summary.json), `readScopeSummary`
- added `src/config/index.ts` — `loadSidecarConfig()` reads all settings from environment
- verified commit→recall round-trip with Chinese content and correct publish candidates

## 0.3.0 - 2026-04-15

### Phase 4: Sidecar Mock Routes

- added `POST /recall` route with validated body schema (agentId required, optional projectId/scope/depth/query)
- added `POST /commit` route with validated body schema (agentId required, optional facts/decisions/entities/patterns/unresolved/visibility)
- added `src/models/index.ts` with shared request/response types (RecallRequest, RecallResponse, CommitRequest, CommitResponse, ErrorResponse)
- wired unified error handler with standard `{ error: { code, message, details } }` format
- enabled Fastify pino request/response logging (`logger: true`)
- smoke-tested all three routes (`/health`, `/recall`, `/commit`)

## 0.2.0 - 2026-04-15

### Phase 2: Plugin Manifest and Minimal Startup

- expanded `openclaw.plugin.json` with `configSchema`, `tools`, `skills`, and `hooks` declarations
- refactored `src/index.ts` to export `createPlugin()` with merged config and startup log
- updated `health_status` tool to return dynamic config summary (sidecarUrl, defaultScope, uptimeSeconds)
- expanded all core types in `src/types/index.ts` (MemoryBrief, DistillResult, SelfModel, StructuralBrief, etc.)

### Phase 3: Config Validation

- implemented `src/config/loader.ts` with `loadConfig()` and `ConfigValidationError`
- JSON Schema validation via `ajv` using `createRequire` for CJS interop under `moduleResolution: NodeNext`
- added defaults merge logic for all nested config sections
- added `examples/config/memory-fabric.yaml` with annotated reference configuration
- updated `defaultConfig` in `src/config/defaults.ts` to cover all config fields

## 0.1.0 - 2026-04-15

### Phase 1: Monorepo Skeleton

- initialized the `openclaw-memory-fabric` monorepo
- created plugin and sidecar package skeletons
- copied the four source project documents into `docs/`
- added phase progress documentation under `docs/progress/`
- added minimal TypeScript build targets for both packages
- verified `pnpm install`, `pnpm -r build`, and `pnpm -r typecheck`
