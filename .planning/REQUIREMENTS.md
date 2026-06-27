# Requirements: OpenClaw Memory Fabric

**Defined:** 2026-06-27
**Core Value:** OpenClaw agents can recall and write useful memory across sessions while preserving evidence traceability, compatibility, and rollback paths.

## Brownfield Baseline Requirements

### Plugin Integration

- [x] **PLUG-01**: Plugin registers OpenClaw tools and hooks from `packages/plugin/src/index.ts`.
- [x] **PLUG-02**: `before_prompt_build` can recall memory and return bounded `prependContext`.
- [x] **PLUG-03**: `agent_end` can distill and commit session memory without blocking the agent.
- [x] **PLUG-04**: Plugin config is validated and merged from defaults and user overrides.

### Sidecar and Persistence

- [x] **SIDE-01**: Sidecar runs as a local Fastify HTTP service.
- [x] **SIDE-02**: Legacy memory persists through OpenViking scoped JSONL files.
- [x] **SIDE-03**: Carrier markdown files support init/read/merge/replace workflows.
- [x] **SIDE-04**: Graphify, shared memory, lifecycle, export, and inspect APIs are implemented.

### Evidence-Backed v2 Memory

- [x] **EVID-01**: L0 events are append-only and include stable `eventId`, `contentHash`, `sourceUri`/source metadata where provided.
- [x] **EVID-02**: L1 candidates carry status, type, quality, confidence, tags, and `sourceRefs`.
- [x] **EVID-03**: Candidates without `sourceRefs` are gated into review/blocked states instead of trusted stable memory.
- [x] **EVID-04**: Consolidation promotes evidence-backed candidates into `MemoryEntryV2` stable memories with quality, supersedes, validity, and relation data.
- [x] **EVID-05**: Source trace can connect stable memory back to `sourceRefs`, L0 events, sources, and relation paths.

### Recall, Injection, and Rollout

- [x] **RECL-01**: Legacy recall remains available through `/recall`.
- [x] **RECL-02**: v2 recall can produce explainable retrieval plans and memory cards through `/v2/recall/plan`.
- [x] **RECL-03**: v2 recall records comparison audit data while keeping legacy fallback.
- [x] **ROLL-01**: Per-Agent/Project rollout modes support `off`, `shadow`, `v2-recall`, and `v2-write`.
- [x] **ROLL-02**: `v2-write` readiness considers worker coverage, queue health, source coverage, and audit data.

### Web Console and Operations

- [x] **WEB-01**: Inspector web UI is built from React/Vite and served by the sidecar static route.
- [x] **WEB-02**: V2 Inspector exposes canary status, multi-Agent rollout controls, candidate review, source trace, injection inspector, carrier projection, bench, and safety views.
- [x] **OPS-01**: Smoke scripts and monitor scripts exist for v2 gray status, v2 commit, acceptance loop, and canary monitoring.
- [x] **TEST-01**: Root and package scripts exist for build, typecheck, test, lint, format, and E2E checks.

## Deferred / Future Requirements

- **SEC-01**: Add server-side auth/capability enforcement for sidecar write/destructive routes.
- **STORE-01**: Add transactional or indexed storage for high-volume candidates/events/memories.
- **SAFE-01**: Add pre-write secret quarantine before candidates or distilled items enter durable memory.
- **API-01**: Normalize error status codes so not-found/validation failures do not return HTTP 200 with `ok:false`.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Re-run Phase 1 | Current implementation already exists; use verification or maintenance phases instead. |
| Hy-Memory runtime dependency | Project direction is self-developed v2; Hy-Memory is only a design reference. |
| OpenClaw core source edits | Existing architecture intentionally avoids upstream source modification. |
| Business credential upload module | This repo handles memory/evidence events, not a generic upload-credential product. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PLUG-01, PLUG-02, PLUG-03, PLUG-04 | Phase 1 | Complete |
| SIDE-01, SIDE-02, SIDE-03, SIDE-04 | Phase 1 | Complete |
| EVID-01, EVID-02, EVID-03, EVID-04, EVID-05 | Phase 1 | Complete |
| RECL-01, RECL-02, RECL-03, ROLL-01, ROLL-02 | Phase 1 | Complete |
| WEB-01, WEB-02, OPS-01, TEST-01 | Phase 1 | Complete |
| SEC-01, STORE-01, SAFE-01, API-01 | Future maintenance phase | Deferred |

**Coverage:**
- Brownfield baseline requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0

---
*Requirements defined: 2026-06-27*
*Last updated: 2026-06-27 after GSD brownfield adoption retrofit*
