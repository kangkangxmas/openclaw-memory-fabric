# Phase 08 Record

Date: 2026-04-15
Status: completed

## Goal

Close the memory write-back loop: distill the agent's turn, commit to OpenViking, update carrier files, and refresh self-model after every `agent_end` event.

## Delivered

- `src/services/distill-service.ts` (sidecar): rule-based `DistillService.distill()` — detects decisions, facts, entities, patterns, and unresolved items from assistant messages using regex dictionaries; deduplicates and caps results; derives publishCandidates from decisions + unresolved
- `POST /distill` route in sidecar: validates `agentId` + `messages[]`, returns `DistillOutput`
- `src/orchestrator/commit-orchestrator.ts` (plugin):
  1. Calls sidecar `/distill`
  2. Calls sidecar `/commit` (private scope)
  3. Builds carrier patches: `execution-journal.md` (append), `decision-log.md` (ordered-accumulate), `entities-glossary.md` (dedup-append), `open-questions.md` (conflict-preserve)
  4. Calls `/carrier/merge` for all patches
  5. Calls `/carrier/merge` for `self-model.md` (overwrite) with freshly constructed model
- `src/hooks/agent-end.ts` (plugin): wraps `CommitOrchestrator.execute()` in try/catch — commit failures are logged as warnings, never propagated to abort the agent session

## Key Decisions

- Distillation is purely additive (no deletion from existing memories) — safe to call repeatedly without data loss
- `self-model.md` is rebuilt from scratch on each commit (overwrite strategy) so it always reflects current session state rather than accumulating stale entries
- `execution-journal.md` uses unconditional append with ISO timestamp separator — forms a canonical activity log
- CommitOrchestrator skips carrier patches when there's nothing to write (decisions/entities/unresolved are empty)
- `agent_end` catches all errors — the memory layer must never degrade the agent's core operation

## Verification

- `POST /distill` with a Chinese assistant message correctly extracts: decision "采用异步消息队列替代同步RPC", fact "PaymentService目前使用同步调用", entity "PaymentService", unresolved "消息队列选型尚未确定"
- publishCandidates surfaces decision + unresolved automatically
- commit round-trip: distill → commit → recall successfully retrieves distilled content
- `pnpm -r build` passes

## Known Gaps

- Distillation is heuristic — will miss implicit decisions not verbalized using detected patterns
- Patterns category (playbooks) extraction has low recall; needs more signal
- Entity extraction relies on PascalCase or quoted terms — misses plain-language entities

## Next Start Point

Phase 9: Graphify 接入
- Implement `src/services/graphify-service.ts` in sidecar
- Routes: `POST /bootstrap`, `POST /graph/query`, `POST /graph/path`, `POST /graph/explain`
- Read `GRAPH_REPORT.md` for structural brief
- Update `RecallOrchestrator` to include structural brief when `structuralNeeded=true`
