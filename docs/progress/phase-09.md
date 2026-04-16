# Phase 09 Record

Date: 2026-04-15
Status: completed

## Goal

Integrate Graphify-compatible structural cognition — local graph construction,
GRAPH_REPORT.md generation, and query/path/explain operations — and wire the
structural brief into the recall pipeline for complex tasks.

## Delivered

- `src/config/index.ts` (sidecar): added `graphify.basePath` (env: GRAPHIFY_BASE_PATH, default `~/.memory-fabric/graphs`)
- `src/services/graphify-service.ts`:
  - `bootstrapProjectGraph()`: walks project directories, extracts entities via PascalCase + headings + file stems, builds co-occurrence edges, prunes to top-200 nodes / top-500 edges, writes `graph.json` + `GRAPH_REPORT.md`
  - `readStructuralBrief()`: reads `graph.json`, computes freshness (< 24h = fresh), runs Union-Find community detection, returns `StructuralBrief`
  - `queryGraph()`: keyword-match nodes, sorted by mention count
  - `pathGraph()`: BFS between any two nodes in the edge graph
  - `explainGraph()`: returns node + neighbors + related edges + prose explanation
- `src/routes/bootstrap.ts`: `POST /bootstrap`
- `src/routes/graph.ts`: `POST /graph/brief`, `/graph/query`, `/graph/path`, `/graph/explain`
- `src/utils/sidecar-client.ts` (plugin): added `bootstrap`, `graphBrief`, `graphQuery`, `graphPath`, `graphExplain` methods
- `src/orchestrator/recall-orchestrator.ts` (plugin): `RecallPlan.needsStructuralBrief` flag; on L1/L2 tasks with a projectId, fetches graph brief and prepends structural section to MemoryBrief

## Key Decisions

- Local mode builds graph from file system — Graphify CLI is not required; output directory structure mirrors the documented `graphify-out/` convention for drop-in replacement
- Entity extraction uses three heuristics: file stem, markdown headings, PascalCase symbols — lightweight but effective for TypeScript/markdown projects
- Struct brief is skipped (non-fatal) when graph is missing or sidecar unreachable — agent continues with OpenViking brief only
- Community detection uses Union-Find on top-100 edges — O(N) and adequate for local graphs

## Verification

- `POST /bootstrap` on the `packages/` directory: 35 files, 200 nodes, 500 edges in ~30ms
- `GRAPH_REPORT.md` lists MemoryFabricConfig, FastifyInstance, RecallOrchestrator as core entities
- `POST /graph/query` for "Service" returns GraphifyService, OpenVikingService, DistillService
- `POST /graph/explain` for "RecallOrchestrator" correctly identifies connected nodes SidecarClient, MemoryFabricConfig
- `POST /graph/path` returns BFS path between any two connected nodes
- `pnpm -r build` passes

## Known Gaps

- Generic built-ins (Promise, Array, Error) rank highly by mention count — future improvement: add a blocklist
- Graph freshness check is time-based (24h), not content-based; directory change detection could improve staleness detection
- No `POST /graph/refresh` for incremental updates yet (Phase planned)

## Next Start Point

Phase 10: Skills packaging — all four SKILL.md files (completed in same session).
See `phase-10.md`.
