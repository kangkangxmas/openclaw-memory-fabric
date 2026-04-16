# Phase 13 Record

Date: 2026-04-15
Status: completed

## Goal

Add a node:test unit test suite covering the plugin and sidecar core logic, with no
external test framework dependency. All tests must pass from a clean build.

## Delivered

### Test infrastructure

- Added `tsconfig.test.json` to both packages — compiles `src/` + `test/` into `dist-test/`
- Added `"test"` script to `packages/plugin/package.json` and `packages/sidecar/package.json`:
  `tsc -p tsconfig.test.json && node --test dist-test/test/*.test.js`
- Added `"test": "pnpm -r test"` to root `package.json`
- No external test framework — uses `node:test` + `node:assert/strict` (Node ≥ 18)

### Plugin tests (`packages/plugin/test/`)

#### `config-loader.test.ts` — 6 tests
- Default config returns correct field values
- Partial overrides are deep-merged with defaults
- Nested sections (observability, sidecar) merge correctly
- Invalid `defaultScope` throws `ConfigValidationError`
- `sidecar.timeoutMs` below minimum throws `ConfigValidationError`
- `ConfigValidationError` has correct `.name` and descriptive `.message`

#### `recall-orchestrator.test.ts` — 12 tests
- `plan()`: depth l0/l1/l2 detection from message length, keyword markers, question density, messageCount
- `plan()`: `needsStructuralBrief` is true only when depth ≥ l1 AND projectId present
- `plan()`: scope defaults to `private` for no-project context; `project` with projectId + non-private defaultScope
- `execute()`: returns brief string and sources on success (client stub)
- `execute()`: graphify source included when sidecar returns non-missing freshness
- `execute()`: gracefully skips graph brief when sidecar throws (non-fatal)
- `execute()`: carrier source appended when carrier files are populated at l1

### Sidecar tests (`packages/sidecar/test/`)

#### `carrier-merge.test.ts` — 12 tests
- `initAgent()`: creates all 3 private carrier files
- `initAgent()`: idempotent — second call does not overwrite existing content
- `initProject()`: creates all 6 project carrier files
- `merge()` overwrite: replaces entire file
- `merge()` append: new content appended below separator
- `merge()` dedup-append: duplicate lines suppressed; new lines added
- `merge()` ordered-accumulate: newer entry appears before older entry in the file
- `merge()` conflict-preserve: new item appended with `- [ ]` checkbox; duplicate not re-added
- `merge()`: unknown carrier filename → appears in `skipped` list with reason
- `merge()`: project carrier without projectId → appears in `skipped` list

#### `distill-service.test.ts` — 9 tests
- Empty input → all empty arrays
- User messages ignored (only assistant role processed)
- Decision patterns extracted from assistant messages
- CamelCase entity extraction (ServiceName, Repository, etc.)
- Unresolved/question markers extracted (Chinese pattern: 待确认)
- Entity deduplication across same message
- Decision array capped at 10
- Entity array capped at 20
- `publishCandidates` derived from decisions + unresolved, capped at 4

## Results

```
plugin:  18 tests, 18 pass, 0 fail
sidecar: 21 tests, 21 pass, 0 fail
total:   39 tests, 39 pass, 0 fail
```

`pnpm -r build && pnpm -r test` — clean from root.
