# External Integrations

**Analysis Date:** 2026-06-26

## APIs & External Services

**OpenClaw Runtime:**
- OpenClaw plugin gateway - Loads the Memory Fabric plugin, registers hooks, and exposes plugin tools.
  - SDK/Client: Native OpenClaw plugin contract declared in `packages/plugin/package.json` and `packages/plugin/openclaw.plugin.json`; registration entrypoint is `packages/plugin/src/index.ts`.
  - Auth: Not configured in this repo; plugin config is validated by `packages/plugin/src/config/loader.ts`.
  - Hooks: `before_prompt_build`, `agent_end`, `before_tool_call`, and `after_tool_call` are wired in `packages/plugin/src/index.ts` and implemented under `packages/plugin/src/hooks/`.
  - Tools: `health_status`, `memory_brief`, `memory_commit`, `memory_publish_shared`, `memory_forget_scoped`, `project_bootstrap`, graph tools, and carrier tools are declared in `packages/plugin/openclaw.plugin.json` and implemented under `packages/plugin/src/tools/`.

**Local Sidecar HTTP API:**
- Memory Fabric sidecar - Fastify service used by the plugin, scripts, and web console.
  - SDK/Client: `packages/plugin/src/utils/sidecar-client.ts` wraps sidecar HTTP calls; `packages/web/src/api/client.ts` uses browser `fetch`; smoke scripts use direct `fetch` in `scripts/v2-gray-smoke.mjs`, `scripts/v2-acceptance-loop.mjs`, and `scripts/v2-commit-smoke.mjs`.
  - Auth: None detected in route handlers under `packages/sidecar/src/routes/`; the service defaults to `HOST=127.0.0.1` in `packages/sidecar/src/config/index.ts` and `scripts/start.sh`.
  - Base URL: Plugin default is `http://127.0.0.1:7811` in `packages/plugin/src/config/defaults.ts`; web dev proxy targets the same sidecar in `packages/web/vite.config.ts`.

**Optional OpenAI-Compatible Chat Completions:**
- LLM refinement/scoring provider - Optional calls to `/chat/completions` for distillation, experience extraction, pattern synthesis, skill draft generation, and scoring.
  - SDK/Client: Built-in `fetch` calls in `packages/sidecar/src/services/distill-service.ts`, `packages/sidecar/src/services/experience-service.ts`, `packages/sidecar/src/services/pattern-service.ts`, `packages/sidecar/src/services/skill-gen-service.ts`, and `packages/sidecar/src/services/scoring-service.ts`.
  - Auth: `DISTILL_LLM_API_KEY` and `EXPERIENCE_LLM_API_KEY` environment variables; local endpoints can use `"none"` as configured in `packages/sidecar/src/server.ts` and `packages/sidecar/src/services/experience-service.ts`.
  - Configuration: `DISTILL_LLM_BASE_URL`, `DISTILL_LLM_MODEL`, `DISTILL_LLM_MAX_TOKENS`, `DISTILL_LLM_TIMEOUT_MS`, plus `EXPERIENCE_LLM_BASE_URL` and `EXPERIENCE_LLM_MODEL`.
  - Provider: No vendor SDK is pinned in `package.json`; any OpenAI-compatible HTTP endpoint can be used.

**Optional Embedding Provider:**
- Ollama/OpenAI-compatible embedding endpoint - Optional vector embedding support for memory recall.
  - SDK/Client: Built-in `fetch` in `packages/sidecar/src/services/embedding-service.ts` and `packages/sidecar/src/services/embedding-service-v2.ts`.
  - Auth: Optional `EMBEDDING_API_KEY` environment variable in `packages/sidecar/src/server.ts`.
  - Endpoints: Tries Ollama-style `/api/embeddings` first, then OpenAI-compatible `/v1/embeddings` in `packages/sidecar/src/services/embedding-service.ts`.
  - Configuration: `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL`, and `EMBEDDING_TIMEOUT_MS` in `packages/sidecar/src/server.ts`.

**OpenViking Memory Namespace:**
- OpenViking-compatible storage layout - Current implementation resolves `viking://org/<org>` URIs into local filesystem paths.
  - SDK/Client: Local adapter functions in `packages/sidecar/src/adapters/openviking-adapter.ts`; service logic in `packages/sidecar/src/services/openviking-service.ts`.
  - Auth: None detected.
  - Configuration: `OPENVIKING_MODE`, `OPENVIKING_BASE_PATH`, and `OPENVIKING_TARGET_ROOT` in `packages/sidecar/src/config/index.ts`.
  - Remote status: `remote` is accepted by the config schema in `packages/plugin/src/config/loader.ts` and `packages/sidecar/src/config/index.ts`, but the implemented adapter in `packages/sidecar/src/adapters/openviking-adapter.ts` is local-path based.

**Graphify Structural Graph:**
- Graphify-compatible project graph service - Current implementation is a local file scanner and graph writer.
  - SDK/Client: Local `GraphifyService` in `packages/sidecar/src/services/graphify-service.ts`; plugin graph tools call the sidecar through `packages/plugin/src/tools/project-graph-tools.ts`.
  - Auth: None detected.
  - Configuration: `GRAPHIFY_BASE_PATH` in `packages/sidecar/src/config/index.ts`; plugin defaults in `packages/plugin/src/config/defaults.ts`.
  - External binary status: `packages/sidecar/src/services/graphify-service.ts` documents that a real Graphify binary can replace `bootstrap()`, but the current source implements local scanning and persistence.

## Data Storage

**Databases:**
- No database server, ORM, or hosted database integration detected.
  - Connection: Not applicable; searches did not find `DATABASE_URL`, PostgreSQL/MySQL/SQLite/Supabase clients, or ORM dependencies in `package.json`, `packages/sidecar/package.json`, `packages/plugin/package.json`, or `packages/web/package.json`.
  - Client: Local JSONL/JSON/Markdown utilities in `packages/sidecar/src/utils/jsonl.ts`, `packages/sidecar/src/services/openviking-service.ts`, and `packages/sidecar/src/services/carrier-service.ts`.

**File Storage:**
- OpenViking memory entries - JSONL files under `OPENVIKING_BASE_PATH`, resolved by `packages/sidecar/src/adapters/openviking-adapter.ts` and read/written by `packages/sidecar/src/services/openviking-service.ts`.
- Carrier files - Markdown files under `CARRIERS_ROOT`, owned by `packages/sidecar/src/services/carrier-service.ts`; shared carrier memory is handled by `packages/sidecar/src/services/shared-service.ts`.
- Graph files - `graph.json` and `GRAPH_REPORT.md` under `GRAPHIFY_BASE_PATH`, owned by `packages/sidecar/src/services/graphify-service.ts`.
- Federation files - JSONL and JSON files under the carrier federation directory, owned by `packages/sidecar/src/services/federation-service.ts`.
- Generated web assets - Root build copies `packages/web/dist/` into `packages/sidecar/public/` via `package.json`; `packages/sidecar/public/` is ignored by `.gitignore`.

**Caching:**
- In-memory OpenViking scope cache - `OpenVikingService` caches loaded JSONL entries for 60 seconds in `packages/sidecar/src/services/openviking-service.ts`.
- In-memory embedding LRU/TTL caches - `EmbeddingService` and `EmbeddingServiceV2` cache vectors in `packages/sidecar/src/services/embedding-service.ts` and `packages/sidecar/src/services/embedding-service-v2.ts`.
- In-memory plugin metrics - `MetricsCollector` stores counters in process memory in `packages/plugin/src/utils/metrics.ts`.
- External cache service: Not detected in `package.json`, `packages/sidecar/package.json`, `packages/plugin/package.json`, or `packages/web/package.json`.

## Authentication & Identity

**Auth Provider:**
- None detected for sidecar routes or web UI.
  - Implementation: Sidecar route modules under `packages/sidecar/src/routes/` do not enforce API keys, sessions, JWTs, OAuth, or user auth.
  - Boundary: The sidecar defaults to loopback binding in `packages/sidecar/src/config/index.ts`, `scripts/dev-start.sh`, and `scripts/start.sh`.
  - Agent identity: OpenClaw hook context supplies `agentId` and `workspaceDir` to `packages/plugin/src/hooks/before-prompt-build.ts` and `packages/plugin/src/hooks/agent-end.ts`; project IDs are derived from workspace directory names there.
  - Data safety: Path IDs are validated by `packages/sidecar/src/utils/path-guard.ts`; sensitive candidate patterns are checked in `packages/sidecar/src/routes/v2.ts` and `scripts/v2-acceptance-loop.mjs`.

## Monitoring & Observability

**Error Tracking:**
- External error tracking service: None detected.
- Sidecar errors: Fastify logger and unified error handler are configured in `packages/sidecar/src/server.ts`.
- Plugin errors: Structured JSON logs go to stderr through `packages/plugin/src/utils/logger.ts`.

**Logs:**
- Sidecar local logs - Production script writes to `~/.memory-fabric/sidecar.log` in `scripts/start.sh`.
- Health checks - Sidecar `/health` is registered from `packages/sidecar/src/routes/health.ts` and exercised by `scripts/health-check.sh`.
- Runtime metrics - Plugin counters are exposed through the `health_status` tool implemented by `packages/plugin/src/tools/health-status.ts` and collected in `packages/plugin/src/utils/metrics.ts`.
- Web/UI status - Inspector pages call `/health`, `/inspect/*`, `/report`, `/patterns`, `/federation/*`, and `/v2/*` through `packages/web/src/api/client.ts`.

## CI/CD & Deployment

**Hosting:**
- Local Node sidecar - `scripts/dev-start.sh` and `scripts/start.sh` run `packages/sidecar/dist/server.js` with Node source maps.
- OpenClaw plugin package - Plugin package metadata and files are in `packages/plugin/package.json`, with `dist`, `skills`, and `openclaw.plugin.json` as package files.
- Web inspector - Web build is served by the sidecar after root `package.json` copies `packages/web/dist/` to `packages/sidecar/public/`.
- Shared host/Nginx - Deployment docs describe a `/memory-fabric/` Nginx prefix in `docs/04-install-deployment.md`; no Nginx config file is committed in this repo.

**CI Pipeline:**
- None detected - No committed `.github/`, `.gitlab/`, `.circleci/`, Dockerfile, docker-compose file, systemd unit, launchd plist, or Procfile was detected.
- Verification commands are local scripts in `package.json`, `scripts/e2e/e2e.test.mjs`, `scripts/v2-gray-smoke.mjs`, `scripts/v2-acceptance-loop.mjs`, `scripts/v2-commit-smoke.mjs`, and `scripts/v2-canary-monitor.mjs`.

## Environment Configuration

**Required env vars:**
- None strictly required for local defaults; `packages/sidecar/src/config/index.ts` defaults `PORT`, `HOST`, `OPENVIKING_BASE_PATH`, `OPENVIKING_TARGET_ROOT`, `CARRIERS_ROOT`, and `GRAPHIFY_BASE_PATH`.
- Required for non-default sidecar binding/storage: `PORT`, `HOST`, `OPENVIKING_BASE_PATH`, `OPENVIKING_TARGET_ROOT`, `CARRIERS_ROOT`, and `GRAPHIFY_BASE_PATH` as shown in `scripts/start.sh` and `docs/04-install-deployment.md`.
- Required for optional LLM refinement: `DISTILL_LLM_BASE_URL` and `DISTILL_LLM_MODEL` in `packages/sidecar/src/server.ts`; `DISTILL_LLM_API_KEY` is optional and defaults to `"none"` there.
- Required for optional experience-specific LLM override: `EXPERIENCE_LLM_BASE_URL` and `EXPERIENCE_LLM_MODEL` in `packages/sidecar/src/services/experience-service.ts`; `EXPERIENCE_LLM_API_KEY` falls back to `DISTILL_LLM_API_KEY` or `"none"`.
- Required for optional embeddings: `EMBEDDING_BASE_URL` and `EMBEDDING_MODEL` in `packages/sidecar/src/server.ts`; `EMBEDDING_API_KEY` is optional.
- Optional rollout/consolidation control: `MEMORY_FABRIC_V2_MODE`, `MEMORY_FABRIC_V2_OFF_AGENT_IDS`, `MEMORY_FABRIC_V2_SHADOW_AGENT_IDS`, `MEMORY_FABRIC_V2_RECALL_AGENT_IDS`, `MEMORY_FABRIC_V2_WRITE_AGENT_IDS`, `MEMORY_FABRIC_CONSOLIDATION_*`, and `SIDECAR_INSTANCE_ID` in `packages/sidecar/src/utils/v2-mode.ts` and `packages/sidecar/src/routes/v2.ts`.

**Secrets location:**
- Runtime secrets are expected through environment variables or ignored `.env` files; `.gitignore` ignores `.env` and `.env.*`.
- `.npmrc` exists at `.npmrc` and was not read; package-manager auth values must not be copied into docs.
- Example sidecar `.env` guidance appears in `docs/04-install-deployment.md`, but no real `.env` contents were read.

## Webhooks & Callbacks

**Incoming:**
- None detected as third-party webhook receivers.
- The sidecar exposes local HTTP API routes under `packages/sidecar/src/routes/`, including `/health`, `/recall`, `/commit`, `/distill`, `/carrier/*`, `/graph/*`, `/shared/*`, `/federation/*`, `/lifecycle/gc`, `/batch/*`, and `/v2/*`.

**Outgoing:**
- Sidecar-to-LLM calls go to OpenAI-compatible `/chat/completions` endpoints from `packages/sidecar/src/services/distill-service.ts`, `packages/sidecar/src/services/experience-service.ts`, `packages/sidecar/src/services/pattern-service.ts`, `packages/sidecar/src/services/skill-gen-service.ts`, and `packages/sidecar/src/services/scoring-service.ts` when configured.
- Sidecar-to-embedding calls go to `/api/embeddings` or `/v1/embeddings` from `packages/sidecar/src/services/embedding-service.ts` and `packages/sidecar/src/services/embedding-service-v2.ts` when configured.
- Plugin-to-sidecar calls go through `packages/plugin/src/utils/sidecar-client.ts`.
- Web-to-sidecar calls go through `packages/web/src/api/client.ts`.

---

*Integration audit: 2026-06-26*
