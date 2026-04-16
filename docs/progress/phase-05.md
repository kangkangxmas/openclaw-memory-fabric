# Phase 05 Record

Date: 2026-04-15
Status: completed

## Goal

Implement the OpenViking local-mode adapter so `/recall` and `/commit` perform real disk-based memory storage and retrieval instead of returning mock data.

## Delivered

- `src/config/index.ts`: `loadSidecarConfig()` reads PORT, HOST, OPENVIKING_MODE, OPENVIKING_BASE_PATH, OPENVIKING_TARGET_ROOT from env with sensible defaults
- `src/adapters/openviking-adapter.ts`:
  - `resolveScopePath()` maps (basePath, targetRoot, agentId, scope, projectId) → local filesystem path
  - `buildVikingUri()` constructs canonical `viking://` URIs for logging/tracing
  - `extractOrg()` parses org segment from targetRoot
- `src/services/openviking-service.ts`:
  - `recallMemory()`: reads JSONL memory files from all applicable scopes, scores entries by keyword overlap with query, returns top N entries as formatted MemoryBrief markdown
  - `commitSession()`: appends typed MemoryEntry objects to `memories.jsonl`, updates `summary.json`, returns `publishCandidates` from unresolved items
  - `readScopeSummary()`: reads `summary.json` for L0 injection
- Updated `/recall` and `/commit` routes to call the real service instead of mock bodies

## Key Decisions

- Storage format: JSONL per scope directory (`memories.jsonl`), one entry per line — supports streaming append without full file parse/rewrite
- Recall scoring: simple keyword overlap between query and entry content, tie-broken by recency — sufficient for local mode, replaces full-text index later
- Scope hierarchy: `buildReadScopes()` always includes private, adds project when projectId present, adds shared only when scope=shared
- `publishCandidates` in commit response surfaces up to 3 unresolved items (truncated to 80 chars) for human review
- `summary.json` is a last-write-wins JSON file tracking last commit timestamp; used by L0 recall for minimal summary

## Verification

- `pnpm -r build` passes
- Commit 6 items (2 facts, 1 decision, 2 entities, 1 unresolved) → returns `committed: 6`, `publishCandidates: ["结算失败..."]`
- Recall with query "结算服务重构" → returns formatted MemoryBrief with 4 scored entries, source `openviking:project:l1`
- JSONL file persists across sidecar restarts

## Known Gaps

- Keyword scoring is approximate (no stemming, no Chinese tokenization)
- No pagination for very large memory stores
- `remote` mode not implemented (deferred — requires actual OpenViking server)

## Next Start Point

Phase 6: Carrier file system — see `phase-06.md` (completed in same session).
