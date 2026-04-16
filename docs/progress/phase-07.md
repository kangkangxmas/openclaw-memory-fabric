# Phase 07 Record

Date: 2026-04-15
Status: completed

## Goal

Implement the `before_prompt_build` hook so every agent turn receives a Memory Brief injected into its context window.

## Delivered

- `src/utils/sidecar-client.ts`: typed HTTP client wrapping all sidecar endpoints — `recall`, `commit`, `distill`, `carrierRead`, `carrierMerge`, `carrierInit`, `health`; uses native `fetch` + `AbortController` for timeout; throws `SidecarClientError` on non-2xx
- `src/hooks/types.ts`: `BeforePromptBuildContext`, `AgentEndContext`, `HookMessage`, `HookToolCall` — framework-agnostic hook contract interfaces
- `src/orchestrator/recall-orchestrator.ts`:
  - `plan()`: detects recall depth (l0/l1/l2) from message length, cross-module keywords, question density; detects scope from projectId
  - `execute()`: calls sidecar `/recall`; enriches with carrier files at L1/L2 (self-model + project-model at L1, plus decision-log + entities-glossary at L2); gracefully skips on carrier failure
- `src/hooks/before-prompt-build.ts`: calls `carrierInit` (idempotent), calls `RecallOrchestrator.execute()`, wraps result in `<!-- memory-fabric:begin|end -->` markers with depth/scope/sources metadata; degrades gracefully on sidecar failure
- Updated `src/index.ts`: `createPlugin()` now instantiates `SidecarClient` and exposes `hooks.before_prompt_build` and `hooks.agent_end`
- Added `engines: { node: ">=18.0.0" }` to plugin `package.json` (requires native `fetch`)

## Key Decisions

- `fetch` built-in (Node 18+) chosen over `node-fetch` / `axios` — zero extra dependencies, sufficient for in-process HTTP to localhost sidecar
- `<!-- memory-fabric:begin -->` / `<!-- memory-fabric:end -->` markers allow downstream tooling to strip or identify injected context
- Carrier init is fire-and-forget before recall; idempotency makes repeated calls safe
- Degraded mode injects a single HTML comment and continues — agent session is never blocked by memory failures

## Verification

- `pnpm -r build` passes cleanly
- `SidecarClient` typecheck passes with all endpoints typed

## Known Gaps

- No real OpenClaw runtime to test hook registration end-to-end
- Complexity detection heuristics are English/Chinese only; other languages will fall back to L0

## Next Start Point

Phase 8 (Distill & Commit) — completed in the same session. See `phase-08.md`.
