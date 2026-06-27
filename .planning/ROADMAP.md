# Roadmap: OpenClaw Memory Fabric

## Overview

This roadmap is a brownfield adoption map for an already implemented project. It records the current baseline as completed so future GSD workflows can verify, audit, repair, or extend the system without replaying the original implementation.

## Phases

- [x] **Phase 1: Data Foundation and Upload Evidence Baseline** - Brownfield baseline covering the existing memory data foundation, evidence ledger, candidate queue, consolidation, recall, carrier projection, Inspector, and verification scripts.

## Phase Details

### Phase 1: Data Foundation and Upload Evidence Baseline

**Status:** Complete (brownfield adopted; do not execute)

**Goal:** Align GSD planning state with the existing OpenClaw Memory Fabric implementation. This phase documents what already exists: plugin/sidecar/web boundaries, evidence-backed v2 memory, legacy compatibility, persistence, APIs, tests, known limitations, and compatibility constraints.

**Depends on:** Nothing

**Requirements:** PLUG-01, PLUG-02, PLUG-03, PLUG-04, SIDE-01, SIDE-02, SIDE-03, SIDE-04, EVID-01, EVID-02, EVID-03, EVID-04, EVID-05, RECL-01, RECL-02, RECL-03, ROLL-01, ROLL-02, WEB-01, WEB-02, OPS-01, TEST-01

**Success Criteria** (already true in current baseline):
1. Plugin and sidecar can provide legacy memory recall/commit and carrier operations.
2. v2 can write L0 evidence events and L1 candidates with `sourceRefs`.
3. Consolidation can promote evidence-backed candidates into stable `MemoryEntryV2` records.
4. v2 recall can produce bounded memory cards and legacy fallback remains available.
5. Inspector and operational scripts can inspect rollout, candidates, evidence trace, bench, and safety state.
6. Build/test scripts exist for ongoing maintenance verification.

**Plans:** 0 executable plans in this adoption phase.

Plans:
- [x] 01-00: Existing implementation adopted as baseline; no execution plan should be run.

**Canonical refs:**
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/API.md`
- `docs/v2-self-research-implementation.md`
- `docs/v2-production-roadmap.md`
- `docs/progress/phase-01.md` through `docs/progress/phase-14.md`
- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/CONCERNS.md`
- `.planning/codebase/STACK.md`
- `.planning/codebase/TESTING.md`

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Data Foundation and Upload Evidence Baseline | 1/1 | Complete (brownfield adopted) | 2026-06-27 |

## Backlog / Future Maintenance

These are not part of Phase 1 and should become explicit future phases only after user confirmation.

- Server-side auth/capability enforcement for sidecar write/destructive routes.
- Transactional or indexed storage for high-volume JSONL-backed state.
- Pre-write sensitive content quarantine before durable candidate creation.
- Route/module decomposition for large v2 route and V2 Inspector page.
- HTTP status normalization for `ok:false` responses.

---
*Roadmap adopted: 2026-06-27*
