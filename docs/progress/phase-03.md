# Phase 03 Record

Date: 2026-04-15
Status: completed

## Goal

Implement config schema validation with clear error messages and a reference example config file.

## Delivered

- `src/config/loader.ts`: `loadConfig(userConfig?)` merges partial user config with defaults then validates with ajv
- `ConfigValidationError` class with structured `validationErrors: string[]`
- JSON Schema defined inline in loader (avoids `JSONSchemaType` generics which conflict with NodeNext moduleResolution)
- ajv + ajv-formats loaded via `createRequire` to work correctly under `moduleResolution: NodeNext` without CJS constructability errors
- `examples/config/memory-fabric.yaml`: annotated reference configuration for all config fields

## Key Decisions

- kept the JSON Schema inline rather than in a separate `schema.ts` because `JSONSchemaType<MemoryFabricConfig>` from ajv does not compile cleanly under strict NodeNext moduleResolution — the inline approach avoids the generic inference issue entirely
- used `createRequire(import.meta.url)` to load ajv CJS bundle; this pattern is idiomatic for ESM packages consuming CJS-only libraries that lack an `exports` field
- renamed `errors` property on `ConfigValidationError` to `validationErrors` to avoid shadowing `Error.errors`

## Verification

- `pnpm -r build` and `pnpm -r typecheck` pass cleanly
- valid config loads without throwing
- missing required field (`sidecar.baseUrl`) causes `ConfigValidationError` with clear path message

## Known Gaps

- no automated unit tests for validation paths yet (deferred to Phase 13)
- schema does not enforce `recallBudget` ordering (l0 < l1 < l2)

## Next Start Point

Phase 4: Sidecar mock routes (`/recall`, `/commit`). See `phase-04.md`.
