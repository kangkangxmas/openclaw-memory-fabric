# Codebase Concerns

**Analysis Date:** 2026-06-26

## Tech Debt

**V2 route module is doing too much:**
- Issue: `packages/sidecar/src/routes/v2.ts` is a 1,722-line route registrar that constructs service instances, defines rollout policy helpers, owns sensitive-candidate scanning, worker control, bench operations, carrier projection operations, trace rendering, and CRUD endpoints in one closure.
- Files: `packages/sidecar/src/routes/v2.ts`, `packages/sidecar/test/memory-fabric-v2.test.ts`
- Impact: Small endpoint changes carry broad regression risk because helpers share local state and are difficult to test in isolation. The integration test file mirrors this breadth and is also large (`packages/sidecar/test/memory-fabric-v2.test.ts`).
- Fix approach: Split into focused route modules under `packages/sidecar/src/routes/v2/` such as `candidates.ts`, `consolidation.ts`, `rollout.ts`, `trace.ts`, `bench.ts`, `ops.ts`, and `carrier-projection.ts`. Move shared rollout/sensitive helper code into services with unit tests.

**Inspector UI is a large single page:**
- Issue: `packages/web/src/pages/V2Inspector.tsx` is 1,988 lines and mixes canary status, rollout mode changes, candidate review, trace, bench, acceptance ops, sensitive governance, and carrier projection controls.
- Files: `packages/web/src/pages/V2Inspector.tsx`, `packages/web/src/api/client.ts`, `packages/web/src/types/index.ts`
- Impact: High-risk operations and read-only inspection live in one component, which makes state coupling and accidental write actions easier to introduce. The product audit already identifies operation safety and information architecture as the main web issue.
- Fix approach: Split the page into domain panels under `packages/web/src/pages/v2-inspector/` and keep write operations behind explicit action components. Keep shared API state in hooks rather than the page component.

**JSONL persistence is used as a mutable database without write coordination:**
- Issue: `readJsonl`, `appendJsonl`, and `writeJsonl` operate directly on full files with `readFile`, `appendFile`, and `writeFile` and no file lock, temp-file rename, or version check. `MemoryCoreV2.updateEntryDirect` rewrites complete scope files.
- Files: `packages/sidecar/src/utils/jsonl.ts`, `packages/sidecar/src/core/memory-core-v2.ts`, `packages/sidecar/src/services/openviking-service.ts`, `packages/sidecar/src/services/atomic-memory-store.ts`
- Impact: Concurrent updates can lose writes or interleave append/update behavior. Large memory files increase latency because many operations scan and rewrite whole JSONL files.
- Fix approach: Introduce an append-only event log plus compacted snapshots, or move mutable indexes to SQLite. If JSONL stays, add per-file write queues, atomic temp-file replacement, and optimistic version checks for every rewrite.

**Root lint excludes scripts and the web package:**
- Issue: `eslint.config.js` ignores `scripts/**` and `packages/web/**`, while scripts contain operational smoke tests and the web package contains the high-risk Inspector controls.
- Files: `eslint.config.js`, `scripts/v2-gray-smoke.mjs`, `scripts/v2-canary-monitor.mjs`, `packages/web/src/pages/V2Inspector.tsx`
- Impact: Web and ops-script regressions rely mainly on TypeScript build/runtime tests, not lint rules such as unused code, unsafe promises, or console usage.
- Fix approach: Add a web ESLint config or include `packages/web/src` in the root config with its tsconfig. Add a lightweight ESLint target for `scripts/*.mjs` or keep scripts small and covered by node tests.

## Known Bugs

**`/v2/aggregate` ignores `groupBy`:**
- Symptoms: Requests with `groupBy` return the same aggregate shape as ungrouped requests.
- Files: `packages/sidecar/src/routes/v2.ts`, `packages/sidecar/src/core/advanced-query.ts`, `packages/sidecar/test/advanced-query.test.ts`
- Trigger: `POST /v2/aggregate` with `{ "field": "id", "op": "count", "groupBy": "agentId" }`.
- Workaround: Use `AdvancedQuery.aggregateGrouped()` directly in code; no route-level workaround is exposed.
- Fix approach: Add a facade method for grouped aggregation or call `facade.group()` plus `AdvancedQuery.aggregate()` from the route. Add a route integration test.

**Legacy `/commit` reports attempted writes, not actual writes:**
- Symptoms: Duplicate memory items are skipped, but the response still reports `committed: toWrite.length`.
- Files: `packages/sidecar/src/services/openviking-service.ts`, `packages/sidecar/src/routes/commit.ts`, `packages/sidecar/test/routes-integration.test.ts`
- Trigger: Commit the same fact/decision twice for the same `agentId`, `projectId`, and scope. The second write is skipped by existing-content deduplication but still counted.
- Workaround: Treat `committed` as attempted item count for legacy writes.
- Fix approach: Track `writtenCount` inside the write loop and return that value. Add a duplicate-commit integration test.

**PATCHing priority drops tags:**
- Symptoms: `V2ServiceFacade.update()` sets `metadata = { priority, tags: [] }` when priority is supplied, overwriting metadata prepared for tags in the same call.
- Files: `packages/sidecar/src/services/v2-service-facade.ts`, `packages/sidecar/src/routes/v2.ts`
- Trigger: `PATCH /v2/memories/:id` with both `tags` and `priority`, or priority against an entry that already has tags.
- Workaround: Avoid priority updates through the route until metadata merge is fixed.
- Fix approach: Build one metadata patch object that preserves existing metadata and merges `tags`, `priority`, and `custom` fields predictably.

**Not-found responses use HTTP 200 with `ok:false`:**
- Symptoms: Several v2 endpoints return `{ ok: false, error: "Not found" }` without setting a 404 status.
- Files: `packages/sidecar/src/routes/v2.ts`, `packages/web/src/api/client.ts`, `packages/plugin/src/utils/sidecar-client.ts`
- Trigger: `GET /v2/memories/:id`, `GET /v2/memories/:id/trace`, `PATCH /v2/memories/:id`, projection apply/rollback misses.
- Workaround: Callers must inspect response bodies, not only `res.ok`.
- Fix approach: Return proper HTTP status codes for not-found and validation failures, and update web/plugin clients to type `ok:false` responses explicitly.

## Security Considerations

**Sidecar control plane has no authentication or authorization:**
- Risk: Any caller that can reach the sidecar can write memories, delete memories, start/stop consolidation workers, change rollout modes, apply/rollback carrier projections, export/backup data, run fixture cleanup, and retract/delete sensitive promoted memories.
- Files: `packages/sidecar/src/server.ts`, `packages/sidecar/src/config/index.ts`, `packages/sidecar/src/routes/v2.ts`, `packages/sidecar/src/routes/commit.ts`, `packages/sidecar/src/routes/carrier.ts`
- Current mitigation: Default host is `127.0.0.1`, and the web audit adds client-side confirmations for dangerous Inspector actions.
- Recommendations: Add a Fastify auth hook for all non-health routes, require an API token or local-socket boundary, and enforce server-side capability checks for destructive endpoints. Keep `HOST=127.0.0.1` unless an authenticated reverse proxy is in front.

**Path-segment validation is inconsistent:**
- Risk: `validateId()` exists and is tested, but the legacy OpenViking path builder and the v2 core write path use raw `agentId`/`projectId` in filesystem joins.
- Files: `packages/sidecar/src/utils/path-guard.ts`, `packages/sidecar/src/adapters/openviking-adapter.ts`, `packages/sidecar/src/services/openviking-service.ts`, `packages/sidecar/src/core/memory-core-v2.ts`
- Current mitigation: `AtomicMemoryStore`, `EventLedgerService`, `CarrierRepository`, rollout config, recall audit, relation graph, and shared service call `validateId()` in many paths.
- Recommendations: Make `resolveScopePath()` validate `agentId` and `projectId`; validate IDs in `MemoryCoreV2.create()` and every route schema that accepts filesystem-backed IDs. Add traversal tests through HTTP routes, not only direct `validateId()` tests.

**Sensitive-memory handling is post-hoc for v2 candidates:**
- Risk: The plugin sends distilled facts, decisions, entities, patterns, and unresolved items to `/commit` before sensitive scanning, and `/v2/memories/candidates` accepts content before governance endpoints inspect it.
- Files: `packages/plugin/src/orchestrator/commit-orchestrator.ts`, `packages/sidecar/src/routes/commit.ts`, `packages/sidecar/src/routes/v2.ts`, `packages/sidecar/src/services/sensitive-candidate-audit-service.ts`
- Current mitigation: `/v2/ops/sensitive-candidates` identifies credential-like candidates without returning raw content, and `/v2/ops/sensitive-candidates/reject` can reject candidates and retract promoted memories.
- Recommendations: Add pre-write sensitive screening for `/commit` v2 writes and direct candidate creation. Quarantine matches before consolidation rather than relying on an operator to scan later.

**Optional LLM refinement can disclose extracted memory items:**
- Risk: `DistillService` sends heuristic memory items to an OpenAI-compatible endpoint when LLM refinement is enabled. The code trusts `DISTILL_LLM_BASE_URL` and attaches the configured API key.
- Files: `packages/sidecar/src/services/distill-service.ts`, `packages/sidecar/src/server.ts`
- Current mitigation: LLM refinement is optional and falls back to heuristics on errors.
- Recommendations: Document trusted endpoint expectations, add an allowlist/local-only option, and redact credential-like values before LLM refinement.

## Performance Bottlenecks

**Rollout mode/status endpoints scan broad state repeatedly:**
- Problem: `collectRolloutScopes()` loads up to 10,000 candidates and 10,000 recall-audit entries to discover scopes, then `buildRolloutRows()` fans out per-scope stats, candidate reads, and audit reads.
- Files: `packages/sidecar/src/routes/v2.ts`, `packages/sidecar/src/services/atomic-memory-store.ts`, `packages/sidecar/src/services/recall-audit-log-service.ts`
- Cause: JSONL storage has no indexed scope registry, so status discovery scans operational data.
- Improvement path: Maintain a scope registry updated on candidate/audit writes. Cache rollout rows for a short TTL and paginate scope status when scope count grows.

**Source trace repeats event scans per source reference:**
- Problem: `GET /v2/memories/:id/trace` loops over each `sourceRef` and calls `eventLedger.list(..., limit: 500)` inside the loop.
- Files: `packages/sidecar/src/routes/v2.ts`, `packages/sidecar/src/services/event-ledger-service.ts`
- Cause: Event lookup is list-and-filter instead of keyed by `eventId`.
- Improvement path: Load events once per trace request or add `EventLedgerService.get(eventId, agentId, projectId)`. Keep a map from `eventId` to event for trace generation.

**Reads mutate storage and amplify writes:**
- Problem: `MemoryCoreV2.read()` updates access metadata through `touchMemory()` and schedules a JSONL rewrite after a successful read.
- Files: `packages/sidecar/src/core/memory-core-v2.ts`, `packages/sidecar/src/models/schema-v2.ts`, `packages/sidecar/src/utils/jsonl.ts`
- Cause: Access tracking is stored inside the same memory entry file as durable content.
- Improvement path: Move access telemetry to a separate append-only stats log or in-memory counter flushed periodically. Do not rewrite primary memory records on every read.

**Export and backup silently cap data at 10,000 entries:**
- Problem: `V2ServiceFacade.exportEntries()` and `backup()` call `search("", 10000)`, so larger stores produce partial exports/backups without an explicit truncation marker.
- Files: `packages/sidecar/src/services/v2-service-facade.ts`, `packages/sidecar/src/core/export-service.ts`
- Cause: Export is implemented through the query API rather than a streaming storage scan.
- Improvement path: Implement paginated or streaming export across scopes and include `truncated`, `entryCount`, and expected totals in backup/export metadata.

## Fragile Areas

**V2 rollout semantics combine env, runtime overrides, worker state, queues, and warnings:**
- Files: `packages/sidecar/src/routes/v2.ts`, `packages/sidecar/src/utils/v2-mode.ts`, `packages/sidecar/src/services/v2-rollout-config-service.ts`, `packages/plugin/src/orchestrator/recall-orchestrator.ts`
- Why fragile: Correct interpretation depends on mode, per-agent allowlists, runtime overrides, worker coverage, queue thresholds, source coverage, and expected warnings such as `worker_preflight_not_active` for non-`v2-write` scopes.
- Safe modification: Treat `/v2/rollout/modes`, `/v2/canary/status`, and `/v2/consolidation/status` response shapes as API contracts. Add compatibility tests before changing field names or warning semantics.
- Test coverage: `packages/sidecar/test/memory-fabric-v2.test.ts` covers many canary scenarios, but exact live endpoint shape and cross-version client compatibility should stay covered.

**Carrier projection and bench fixture cleanup can mutate real memory state:**
- Files: `packages/sidecar/src/routes/v2.ts`, `packages/sidecar/src/services/carrier-projection-engine.ts`, `packages/sidecar/src/services/memory-bench-fixture-seeder.ts`, `packages/web/src/pages/V2Inspector.tsx`
- Why fragile: Projection apply/rollback and fixture cleanup are operationally useful but destructive. The web layer adds confirmations, yet sidecar endpoints accept direct calls without server-side role/capability checks.
- Safe modification: Keep preview/apply-preview separation, never bypass rollback snapshot creation, and add server-side destructive-operation guards.
- Test coverage: Integration tests cover happy paths for projection and cleanup; add denial/auth tests once auth exists.

**Memory quality gates mix heuristics and manual review tags:**
- Files: `packages/sidecar/src/services/memory-consolidator.ts`, `packages/sidecar/test/memory-fabric-v2.test.ts`, `packages/sidecar/src/routes/v2.ts`
- Why fragile: Promotion decisions depend on source refs, confidence, quality scores, low-signal text heuristics, profile/intent gates, manual review tags, and duplicate/supersede scoring.
- Safe modification: Add focused tests for each gate before tuning thresholds. Keep CJK and English examples because the current logic has language-specific rules.
- Test coverage: Existing tests cover low-signal fragments, CJK concise statements, profile/intent promotion, and supersedes behavior. Add regression tests for sensitive pre-write quarantine after that feature exists.

**Web client assumes HTTP status success means response shape success:**
- Files: `packages/web/src/api/client.ts`, `packages/web/src/pages/V2Inspector.tsx`, `packages/sidecar/src/routes/v2.ts`
- Why fragile: `get()` and `post()` throw only on non-2xx responses. Endpoints returning `ok:false` with status 200 can produce undefined fields in UI state.
- Safe modification: Normalize API responses in `packages/web/src/api/client.ts` and throw on `ok:false` where the type expects success.
- Test coverage: Add component or hook tests for not-found trace, missing projection preview, and rejected candidate review.

## Scaling Limits

**JSONL storage capacity is bounded by full-file scans and 10,000-row caps:**
- Current capacity: Several APIs explicitly cap reads at 10,000 candidates/audit entries, 2,000 evidence-audit memories, 500 trace/event reads, or 1,000 query rows.
- Limit: High-volume multi-agent deployments will hit slow status pages, partial exports, and increased write-loss risk under concurrent mutation.
- Scaling path: Add indexed storage for candidates, events, audits, and memories. Use SQLite/Postgres for mutable operational state, keep JSONL only as an audit/export format.

**In-memory caches are per-service-instance and not globally coherent:**
- Current capacity: `V2ServiceFacade`, `MemoryCoreV2`, `OpenVikingService`, retrieval planner, and worker services each own their own core/cache instances in several code paths.
- Limit: External writes and service-local caches can produce stale reads unless callers refresh or instantiate a fresh core.
- Scaling path: Centralize the memory store behind one repository with explicit cache invalidation, or use storage-level indexes that every service reads consistently.

**Bench and rollout workflows assume operator discipline:**
- Current capacity: The roadmap expects real fixtures, strict smoke scripts, queue thresholds, and canary monitoring before promotion.
- Limit: Without server-side enforcement, direct API calls can promote modes, seed fixtures, or apply projections outside the documented gate sequence.
- Scaling path: Encode promotion gates in sidecar services, not only scripts/docs/UI confirmations. Store gate evidence and require it for `v2-write` mode changes.

## Dependencies at Risk

**Not detected:**
- Risk: No obviously deprecated or abandoned runtime dependency was identified from `package.json`, `packages/sidecar/package.json`, `packages/plugin/package.json`, or `packages/web/package.json`.
- Impact: Dependency risk is lower than architecture/security/operational-risk concerns in this repo.
- Migration plan: Keep package updates on the normal pnpm upgrade path and run `pnpm -r test`, `pnpm -r build`, and v2 smoke scripts after upgrades.

## Missing Critical Features

**Server-side auth and capability model:**
- Problem: The system exposes read, write, destructive, governance, and rollout controls through the same unauthenticated Fastify app.
- Blocks: Safe exposure through a reverse proxy, shared local host environments, and multi-user operations.

**Transactional storage for memories/candidates/events:**
- Problem: The repository uses JSONL files for mutable state without locking or atomic replacement.
- Blocks: Reliable concurrent writes, large candidate pools, streaming backup/export, and high-frequency recall/write workloads.

**Pre-write secret quarantine:**
- Problem: Sensitive candidate governance scans after candidates exist and can retract promoted memories after the fact.
- Blocks: Strong guarantees that credential-like content never enters stable memory or downstream LLM refinement.

**Route-level operational audit for destructive calls:**
- Problem: Mode switches, worker start/stop, projection apply/rollback, fixture cleanup, memory delete, and sensitive rejection do not share a uniform audit envelope with actor/capability metadata.
- Blocks: Forensic review of production incidents and safe multi-agent operations.

## Test Coverage Gaps

**Unauthenticated and destructive routes:**
- What's not tested: Requests without credentials, with invalid credentials, or lacking capabilities for `/v2/rollout/modes`, `/v2/consolidation/worker/start`, `/v2/carriers/projection/apply-preview`, `/v2/bench/fixtures/cleanup`, `/v2/ops/sensitive-candidates/reject`, `/v2/memories/:id`.
- Files: `packages/sidecar/src/server.ts`, `packages/sidecar/src/routes/v2.ts`, `packages/sidecar/test/memory-fabric-v2.test.ts`
- Risk: Auth cannot be added safely without a clear expected denial matrix.
- Priority: High

**Filesystem traversal through HTTP routes:**
- What's not tested: `agentId` and `projectId` containing `/`, `\`, or `..` through `/commit`, `/recall`, `/inspect/projects`, `/v2/memories`, and `/v2/query`.
- Files: `packages/sidecar/src/utils/path-guard.ts`, `packages/sidecar/src/adapters/openviking-adapter.ts`, `packages/sidecar/src/services/openviking-service.ts`, `packages/sidecar/src/core/memory-core-v2.ts`, `packages/sidecar/test/path-guard.test.ts`
- Risk: Unit tests prove the validator works, but not that every route/service applies it.
- Priority: High

**Route-level advanced query behavior:**
- What's not tested: `/v2/aggregate` with `groupBy`, invalid aggregate fields, and client behavior for grouped results.
- Files: `packages/sidecar/src/routes/v2.ts`, `packages/sidecar/src/core/advanced-query.ts`, `packages/sidecar/test/advanced-query.test.ts`
- Risk: The core grouped implementation works but the route ignores it.
- Priority: Medium

**Metadata merge semantics:**
- What's not tested: PATCH requests that combine `tags`, `priority`, and existing `metadata.custom`.
- Files: `packages/sidecar/src/services/v2-service-facade.ts`, `packages/sidecar/src/core/memory-core-v2.ts`, `packages/sidecar/test/v2-service-facade.test.ts`
- Risk: Updating priority can erase tags or custom metadata.
- Priority: Medium

**Concurrent JSONL mutation:**
- What's not tested: Parallel commits, read-triggered access writes racing with updates/deletes, worker consolidation overlapping manual review, and fixture cleanup overlapping recall.
- Files: `packages/sidecar/src/utils/jsonl.ts`, `packages/sidecar/src/core/memory-core-v2.ts`, `packages/sidecar/src/services/atomic-memory-store.ts`, `packages/sidecar/src/services/consolidation-worker.ts`
- Risk: Lost updates and corrupted operational state under realistic multi-agent use.
- Priority: High

**Export and backup truncation:**
- What's not tested: Stores with more than 10,000 memories, export completeness, and backup metadata that proves whether a backup is complete.
- Files: `packages/sidecar/src/services/v2-service-facade.ts`, `packages/sidecar/src/core/export-service.ts`, `packages/sidecar/test/export-service.test.ts`
- Risk: Operators may trust partial exports/backups.
- Priority: Medium

---

*Concerns audit: 2026-06-26*
