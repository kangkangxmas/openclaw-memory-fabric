# Phase 04 Record

Date: 2026-04-15
Status: completed

## Goal

Extend the Sidecar with validated `POST /recall` and `POST /commit` routes using mock data, a unified error response format, and structured request logging.

## Delivered

- `src/models/index.ts`: shared request/response types — `RecallRequest`, `RecallResponse`, `CommitRequest`, `CommitResponse`, `ErrorResponse`
- `src/routes/recall.ts`: `POST /recall` — validates `agentId` (required), optional `projectId/scope/depth/query`; returns mock `memoryBrief` string + `sources` + `budgetUsed`
- `src/routes/commit.ts`: `POST /commit` — validates `agentId` (required), counts committed items across facts/decisions/entities/patterns/unresolved; returns `ok: true` + `committed` count + empty `publishCandidates`
- `src/server.ts`: wired all three routes; added `setErrorHandler` returning `{ error: { code, message, details } }`; enabled pino logging via `logger: true`
- smoke-tested all routes manually

## Key Decisions

- JSON Schema validation declared inline in each route handler (Fastify's `schema.body` option) — keeps validation co-located with the route and avoids separate schema registry for now
- mock implementations clearly labelled with `// Phase 4: mock` comment so they can be replaced in Phase 5 without confusion
- `FastifyError` type used for `setErrorHandler` parameter to satisfy strict TypeScript

## Verification

- `pnpm -r build` passes
- `GET /health` returns 200 with phase label
- `POST /recall` with valid body returns `memoryBrief`, `sources`, `budgetUsed`
- `POST /commit` with valid body returns `ok: true`, `committed: N`

## Known Gaps

- routes return mock data only — real OpenViking integration deferred to Phase 5
- no tests yet

## Next Start Point

Phase 5: OpenViking adapter.

Tasks to implement in `packages/sidecar/src/services/openviking-service.ts` and `packages/sidecar/src/adapters/openviking-adapter.ts`:
- `recallMemory(agentId, projectId, scope, depth, query)` → real OpenViking read
- `commitSession(agentId, projectId, items)` → real OpenViking write
- URI construction: `viking://org/<org>/agents/<agentId>/...`
- local mode: read/write files under `openviking.basePath`
- wire into `/recall` and `/commit` routes replacing mock bodies
