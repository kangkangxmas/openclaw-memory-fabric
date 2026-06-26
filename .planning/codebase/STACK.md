# Technology Stack

**Analysis Date:** 2026-06-26

## Languages

**Primary:**
- TypeScript 5.8.3 - Shared language for the OpenClaw plugin in `packages/plugin/src/index.ts`, the Fastify sidecar in `packages/sidecar/src/server.ts`, and the React web console in `packages/web/src/App.tsx`; version is declared in `package.json`.

**Secondary:**
- TSX/React JSX - Browser UI components live under `packages/web/src/pages/`, `packages/web/src/components/`, and `packages/web/src/main.tsx`; JSX mode is configured in `packages/web/tsconfig.json`.
- JavaScript ESM - Operational smoke/e2e scripts use `.mjs`, including `scripts/v2-gray-smoke.mjs`, `scripts/v2-acceptance-loop.mjs`, `scripts/v2-commit-smoke.mjs`, and `scripts/e2e/e2e.test.mjs`.
- Bash - Local startup and health scripts live in `scripts/dev-start.sh`, `scripts/start.sh`, `scripts/dev-stop.sh`, `scripts/health-check.sh`, and `examples/project-sample/bootstrap.sh`.
- Markdown/YAML - Product docs and install guidance live in `docs/`, and the sample plugin configuration lives in `examples/config/memory-fabric.yaml`.

## Runtime

**Environment:**
- Node.js >=20.0.0 - Required by the root monorepo in `package.json`; local runtime observed as Node.js v22.22.1.
- Node.js >=18.0.0 - Minimum package engine for the plugin package in `packages/plugin/package.json`; the root `package.json` is stricter and should govern repo-wide development.
- Browser runtime - The inspector web UI is bundled by Vite from `packages/web/src/main.tsx` and served from the sidecar static asset path registered in `packages/sidecar/src/routes/inspect.ts`.

**Package Manager:**
- pnpm 10.32.1 - Declared as `packageManager` in `package.json`; local pnpm version observed as 10.32.1.
- Lockfile: present - `pnpm-lock.yaml`.
- Workspace config: present - `pnpm-workspace.yaml` includes `packages/*`.

## Frameworks

**Core:**
- Fastify 5.3.3 - Sidecar HTTP server and routes in `packages/sidecar/src/server.ts`, with route modules under `packages/sidecar/src/routes/`.
- @fastify/static 9.1.3 - Static serving for the web inspector assets in `packages/sidecar/src/routes/inspect.ts`.
- OpenClaw plugin runtime - Native plugin contract is declared in `packages/plugin/package.json` and `packages/plugin/openclaw.plugin.json`; runtime registration is implemented in `packages/plugin/src/index.ts`.
- React 18.3.1 - Web console pages and stateful UI in `packages/web/src/App.tsx` and `packages/web/src/pages/`.
- Vite 6.3.5 - Web build/dev server in `packages/web/vite.config.ts`.
- Tailwind CSS 3.4.17 - Web styling tokens and content scanning in `packages/web/tailwind.config.js`; PostCSS wiring is in `packages/web/postcss.config.js`.

**Testing:**
- Node built-in test runner - Package tests compile with `tsc` and run `node --test` from `packages/sidecar/package.json`, `packages/plugin/package.json`, and `scripts/e2e/e2e.test.mjs`.
- TypeScript compiler test builds - Test-specific configs live in `packages/sidecar/tsconfig.test.json` and `packages/plugin/tsconfig.test.json`.

**Build/Dev:**
- TypeScript compiler - Package builds use `tsc -p tsconfig.json` in `packages/sidecar/package.json` and `packages/plugin/package.json`.
- Vite build - Web build uses `tsc -b && vite build` in `packages/web/package.json`.
- Monorepo build pipeline - Root `package.json` builds web first, copies `packages/web/dist/` into `packages/sidecar/public/`, then builds plugin and sidecar.
- ESLint 9.39.4 with typescript-eslint 8.58.2 - Linting config lives in `eslint.config.js`.
- Prettier 3.8.3 - Formatting config lives in `.prettierrc.json`.

## Key Dependencies

**Critical:**
- `fastify` ^5.3.3 - Owns the sidecar HTTP API in `packages/sidecar/src/server.ts`.
- `@fastify/static` ^9.1.3 - Serves the inspector web build from `packages/sidecar/public/` through `packages/sidecar/src/routes/inspect.ts`.
- `ajv` ^8.18.0 and `ajv-formats` ^3.0.1 - Validate plugin configuration in `packages/plugin/src/config/loader.ts`.
- `react` ^18.3.1 and `react-dom` ^18.3.1 - Browser UI runtime declared in `packages/web/package.json`.
- `react-force-graph-2d` ^1.26.3 - Graph visualization dependency used by the web console in `packages/web/src/pages/GraphView.tsx`.
- `react-markdown` ^9.0.3 - Markdown rendering dependency used by carrier views in `packages/web/src/pages/CarrierViewer.tsx`.

**Infrastructure:**
- Node `fetch` - Used for sidecar client calls in `packages/plugin/src/utils/sidecar-client.ts`, model calls in `packages/sidecar/src/services/distill-service.ts`, and script smoke tests such as `scripts/v2-gray-smoke.mjs`.
- Node filesystem APIs - Local JSONL/Markdown persistence uses `fs/promises` in `packages/sidecar/src/services/openviking-service.ts`, `packages/sidecar/src/services/carrier-service.ts`, `packages/sidecar/src/services/federation-service.ts`, and `packages/sidecar/src/utils/jsonl.ts`.
- Node crypto APIs - Content IDs, hashes, and deduplication use `crypto` in `packages/sidecar/src/services/carrier-service.ts`, `packages/sidecar/src/services/event-ledger-service.ts`, and `packages/sidecar/src/services/skill-gen-service.ts`.

## Configuration

**Environment:**
- Sidecar env vars are read in `packages/sidecar/src/config/index.ts`: `PORT`, `HOST`, `OPENVIKING_MODE`, `OPENVIKING_BASE_PATH`, `OPENVIKING_TARGET_ROOT`, `CARRIERS_ROOT`, and `GRAPHIFY_BASE_PATH`.
- Optional sidecar LLM and embedding env vars are wired in `packages/sidecar/src/server.ts`: `DISTILL_LLM_BASE_URL`, `DISTILL_LLM_MODEL`, `DISTILL_LLM_API_KEY`, `DISTILL_LLM_MAX_TOKENS`, `DISTILL_LLM_TIMEOUT_MS`, `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, and `EMBEDDING_TIMEOUT_MS`.
- Optional experience-specific LLM overrides are read in `packages/sidecar/src/services/experience-service.ts`: `EXPERIENCE_LLM_BASE_URL`, `EXPERIENCE_LLM_MODEL`, and `EXPERIENCE_LLM_API_KEY`.
- V2 rollout and consolidation env vars are read in `packages/sidecar/src/utils/v2-mode.ts` and `packages/sidecar/src/routes/v2.ts`: `MEMORY_FABRIC_V2_MODE`, per-agent override lists, `MEMORY_FABRIC_CONSOLIDATION_*`, and `SIDECAR_INSTANCE_ID`.
- Plugin config defaults live in `packages/plugin/src/config/defaults.ts`; the JSON-schema validator lives in `packages/plugin/src/config/loader.ts`; the external manifest schema lives in `packages/plugin/openclaw.plugin.json`.
- `.env` and `.env.*` are ignored by `.gitignore`; no `.env` file was read. `.npmrc` exists at `.npmrc` and was not read because package-manager auth files are forbidden.

**Build:**
- Root build/test/lint/format commands live in `package.json`.
- Shared TypeScript options live in `tsconfig.base.json`; package configs live in `packages/sidecar/tsconfig.json`, `packages/plugin/tsconfig.json`, and `packages/web/tsconfig.json`.
- Web proxy and asset base configuration live in `packages/web/vite.config.ts`.
- Tailwind/PostCSS configuration lives in `packages/web/tailwind.config.js` and `packages/web/postcss.config.js`.
- Lint/format configuration lives in `eslint.config.js` and `.prettierrc.json`.

## Platform Requirements

**Development:**
- Install with pnpm from `package.json` and `pnpm-lock.yaml`; use `pnpm install`, `pnpm build`, `pnpm test`, and `pnpm test:e2e` from `README.md`.
- Start the development sidecar with `scripts/dev-start.sh`; it sets local data roots under `runtime-data/` and maps them to sidecar env vars.
- The web dev server runs on port 5173 and proxies sidecar API paths to `http://127.0.0.1:7811` as configured in `packages/web/vite.config.ts`.
- Packaged OpenClaw skills ship with the plugin under `packages/plugin/skills/project-sensemaking/SKILL.md`, `packages/plugin/skills/memory-hygiene/SKILL.md`, `packages/plugin/skills/execution-gate/SKILL.md`, and `packages/plugin/skills/post-task-distill/SKILL.md`.

**Production:**
- The production-oriented startup script is `scripts/start.sh`; it binds the sidecar to `127.0.0.1:7811`, writes logs to `~/.memory-fabric/sidecar.log`, and uses `~/.openviking/data/viking/openclaw-personal`, `~/.memory-fabric/carriers`, and `~/.memory-fabric/graphs`.
- Install/deployment guidance is documented in `docs/04-install-deployment.md`; no committed Dockerfile, docker-compose file, systemd unit, launchd plist, or CI workflow was detected.
- Shared-host web exposure is documented through an external Nginx prefix in `docs/04-install-deployment.md`; the repo itself only contains sidecar/web code and scripts.

---

*Stack analysis: 2026-06-26*
