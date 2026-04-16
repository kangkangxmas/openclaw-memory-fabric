# Phase 11 Record

Date: 2026-04-15
Status: completed

## Goal

Implement audit-safe shared memory — a cross-agent publish/retract layer stored under
project scope so multiple agents can share pinned insights without merging into private
carrier files.

## Delivered

### `packages/sidecar/src/services/shared-service.ts`
- `SharedEntry` type: id (nanoid), sourceAgent, projectId, visibility, type, content, createdAt, status ("active" | "retracted"), tags
- JSONL storage under `carriers/shared/projects/<projectId>/published-memory.jsonl`
- `publish()`: appends one or more entries atomically
- `forget()`: full-file rewrite marking matched entries `status: "retracted"` — never physical deletion (audit-safe)
- `recall()`: reads JSONL, filters active entries, keyword-scores against query, returns top-N sorted by score

### `packages/sidecar/src/routes/*.ts` (shared routes)
- `POST /shared/publish` — accepts `{ agentId, projectId, entries[] }`, appends to JSONL
- `POST /shared/forget` — accepts `{ agentId, projectId, filter }` (by id/tag/type/sourceAgent), retracts matched entries
- `GET /shared/recall` — accepts `{ projectId, query, limit }`, returns scored active entries

### Plugin tool additions
- `createMemoryPublishShared(client)` → calls `client.sharedPublish()`
- `createMemoryForgetScoped(client)` → calls `client.sharedForget()`
- Both exposed on `plugin.tools.memory_publish_shared` / `plugin.tools.memory_forget_scoped`

### Recall route integration (`packages/sidecar/src/routes/recall.ts`)
- When `scope === "shared" || "auto"` and projectId is present, shared recall results are
  appended to the MemoryBrief returned to the plugin
- `SharedService` injected into the recall route factory

### Plugin client (`SidecarClient`)
- Added `sharedPublish()`, `sharedForget()` methods

## Design decisions

- Retraction not deletion: avoids audit gaps; operators can grep JSONL for retracted entries
- Separate JSONL per project: no cross-project leakage at the file level
- Keyword scoring reuses the same scorer as OpenVikingService — consistent relevance semantics
