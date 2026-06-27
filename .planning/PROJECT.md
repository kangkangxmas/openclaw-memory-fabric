# OpenClaw Memory Fabric

## What This Is

OpenClaw Memory Fabric is a completed brownfield OpenClaw plugin plus local sidecar service that gives OpenClaw agents persistent, auditable, evidence-backed memory. It includes legacy OpenViking JSONL memory, carrier markdown projections, v2 L0/L1/Lx memory infrastructure, recall planning, consolidation, relation graph, bench tooling, and an Inspector web console.

This `.planning` tree is a GSD adoption retrofit over the existing codebase. It is not a greenfield plan and must not be used to re-run Phase 1 implementation.

## Core Value

OpenClaw agents can recall and write useful memory across sessions while preserving evidence traceability, compatibility, and rollback paths.

## Requirements

### Validated

- [x] Plugin integrates with OpenClaw hooks and tools without modifying upstream OpenClaw source.
- [x] Sidecar exposes local HTTP APIs for recall, commit, carrier, graph, shared memory, v2 memory, bench, rollout, and Inspector operations.
- [x] Legacy `/recall`, `/commit`, `/carrier/*`, OpenViking JSONL, and carrier markdown paths remain compatible.
- [x] v2 writes are evidence-backed through L0 events, L1 candidates, `sourceRefs`, and consolidation gates.
- [x] v2 recall can inject bounded memory cards with legacy fallback.
- [x] Inspector can show rollout modes, candidate review, source trace, injection inspector, carrier projection, bench, and safety views.
- [x] Tests and build scripts exist for plugin, sidecar, web, and E2E/smoke checks.

### Active

- [ ] Maintain and audit the existing baseline without rewriting Phase 1.
- [ ] Use GSD artifacts for maintenance, fixes, verification, and future feature additions.
- [ ] Keep multi-Agent rollout governance explicit and reversible.

### Out of Scope

- Re-executing Phase 1 implementation — the project is already implemented; Phase 1 is adopted as a completed baseline.
- Replacing the current TypeScript/Fastify/React stack as part of adoption — stack changes require a separate future phase.
- Introducing Hy-Memory as a runtime dependency — Hy-Memory remains design reference only.
- Modifying OpenClaw official core source — all integration remains in plugin, sidecar, web, scripts, and local configuration layers.

## Context

- Current codebase map is in `.planning/codebase/`.
- Product and architecture references live in `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/v2-self-research-implementation.md`, and `docs/v2-production-roadmap.md`.
- Historical implementation records live in `docs/progress/phase-01.md` through `docs/progress/phase-14.md`.
- The current repo is a pnpm monorepo with `packages/plugin`, `packages/sidecar`, and `packages/web`.
- The runtime sidecar is local-first, normally bound to `127.0.0.1:7811`; shared host exposure is handled outside this repo by Nginx.

## Constraints

- **Compatibility**: Keep `/recall`, `/commit`, `/carrier/*`, legacy JSONL, and carrier fallback paths working.
- **Evidence**: Stable v2 memories should retain `sourceRefs`; source-less content must not become trusted stable memory.
- **Rollout safety**: `v2-write` is controlled per Agent/Project and must remain reversible.
- **Storage**: Existing durable state is filesystem-backed JSONL/Markdown; do not assume SQL transactions without a new migration phase.
- **Security**: Sidecar is unauthenticated local control plane today; avoid widening exposure without auth/capability work.
- **Scope**: GSD adoption may add planning files only; business code changes require a separate maintenance/fix phase.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Treat project as brownfield completed baseline | Existing docs, progress records, APIs, tests, and code show the system is already implemented | Adopted |
| Do not re-run Phase 1 | Re-running would risk rewriting working functionality and history | Locked |
| Map requested Phase 1 slug to existing data/evidence foundation | User requested `01-data-foundation-upload-evidence`; current repo implements evidence through L0 events/sourceRefs, not a business upload product | Adopted with boundary note |
| Keep v2 self-research route as primary architecture baseline | Current docs and code implement self-developed v2 without Hy-Memory runtime dependency | Adopted |

---
*Last updated: 2026-06-27 after GSD brownfield adoption retrofit*
