# Phase 06 Record

Date: 2026-04-15
Status: completed

## Goal

Implement the stable memory carrier file system — idempotent initialization, per-file merge strategies, and read/merge HTTP routes.

## Delivered

- `src/services/carrier-service.ts`:
  - 9 carrier file definitions with explicit `MergeStrategy` per file:
    - `identity.md`, `working-style.md`, `self-model.md` → `overwrite`
    - `decision-log.md` → `ordered-accumulate` (prepends newest entries)
    - `entities-glossary.md`, `playbooks.md` → `dedup-append` (line-level dedup)
    - `open-questions.md` → `conflict-preserve` (appends as checkbox, checks for duplicates)
    - `execution-journal.md` → `append` (unconditional append with timestamp separator)
    - `project-model.md` → `overwrite`
  - `initAgent(agentId)`: creates private carrier files from templates — idempotent
  - `initProject(agentId, projectId)`: creates project-scope carrier files — idempotent
  - `read(opts)`: returns content of requested carrier files (falls back to template if not yet initialized)
  - `merge(opts)`: applies `CarrierPatch[]` using each file's strategy; reports merged/skipped
- `src/routes/carrier.ts`: three routes wired to CarrierRepository
  - `POST /carrier/init`: idempotent init of agent + optional project carriers
  - `POST /carrier/read`: read one or more carrier files by filename
  - `POST /carrier/merge`: apply patches using per-file strategy
- `src/config/index.ts`: added `carriers.root` config field (env: CARRIERS_ROOT, default: `~/.memory-fabric/carriers`)
- Wired `CarrierRepository` into server

## Key Decisions

- Templates are embedded in code (not external files) so initialization works without a separate template directory
- Merge strategies are attached to carrier definitions — callers never specify a strategy, only provide content
- `dedup-append` uses trimmed line-level equality, which handles most practical cases without a diff library
- `conflict-preserve` checks a 40-char prefix to detect near-duplicates before appending
- Directory structure mirrors the OpenViking scope layout: `agents/<agentId>/private/` and `agents/<agentId>/projects/<projectId>/`

## Verification

- `POST /carrier/init` creates 9 files (3 private + 6 project) under CARRIERS_ROOT
- Merging `decision-log.md` with new entry → entry prepended after heading (newest-first)
- Merging `open-questions.md` → appended as `- [ ] ... (added: YYYY-MM-DD)`
- Merging `entities-glossary.md` twice with same content → second merge is a no-op (dedup)
- Read returns correct content; unknown filename → skipped with reason

## Known Gaps

- No test for `execution-journal.md` append separator
- No conflict detection for `ordered-accumulate` across sessions
- `self-model.md` overwrite could lose prior content if called without reading first — callers must read-before-write

## Next Start Point

Phase 7: Hook injection and Memory Brief.
- Implement `before_prompt_build` hook handler in `packages/plugin/src/hooks/`
- Build `RecallOrchestrator` that calls sidecar `/recall` and `/carrier/read`
- Generate formatted MemoryBrief and inject via `prependContext`
- Implement `agent_end` hook calling sidecar `/commit` and `/carrier/merge`
