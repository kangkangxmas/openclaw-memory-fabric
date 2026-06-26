# Coding Conventions

**Analysis Date:** 2026-06-26

## Naming Patterns

**Files:**
- Use lowercase kebab-case for Node package modules in `packages/plugin/src/` and `packages/sidecar/src/`: `packages/plugin/src/tools/memory-brief.ts`, `packages/sidecar/src/services/v2-service-facade.ts`, `packages/sidecar/src/utils/path-guard.ts`.
- Use `index.ts` as a package or folder export surface where a module has multiple public exports: `packages/plugin/src/index.ts`, `packages/plugin/src/types/index.ts`, `packages/sidecar/src/models/index.ts`.
- Use PascalCase `.tsx` files for React components and pages in `packages/web/src/`: `packages/web/src/App.tsx`, `packages/web/src/pages/V2Inspector.tsx`, `packages/web/src/components/StatusBar.tsx`.
- Use `.test.ts` under package-level `test/` directories for compiled Node tests: `packages/plugin/test/tools.test.ts`, `packages/sidecar/test/routes-integration.test.ts`.
- Use `.test.mjs` for script-level Node E2E tests that run directly without TypeScript compilation: `scripts/e2e/e2e.test.mjs`.

**Functions:**
- Use camelCase for helpers and local functions: `extractTextContent()` in `packages/plugin/src/hooks/before-prompt-build.ts`, `validatePath()` in `packages/sidecar/src/utils/path-guard.ts`, `resolveApiBase()` in `packages/web/src/api/client.ts`.
- Use `createX` factory names for plugin tools and hook handlers: `createMemoryBrief()` in `packages/plugin/src/tools/memory-brief.ts`, `createBeforePromptBuildHandler()` in `packages/plugin/src/hooks/before-prompt-build.ts`.
- Use `registerXRoute` names for Fastify route modules: `registerRecallRoute()` in `packages/sidecar/src/routes/recall.ts`, `registerCarrierRoutes()` in `packages/sidecar/src/routes/carrier.ts`.
- Use async function return types for exported async operations when the contract matters: `memoryBrief(input): Promise<RecallResponse>` in `packages/plugin/src/tools/memory-brief.ts`, `buildServer()` in `packages/sidecar/src/server.ts`.

**Variables:**
- Use camelCase for local state and request data: `agentId`, `projectId`, `latestMessage` in `packages/plugin/src/hooks/before-prompt-build.ts`; `selectedProjectionFile`, `sortedCandidates` in `packages/web/src/pages/V2Inspector.tsx`.
- Use uppercase snake case for module constants that represent fixed values: `PLUGIN_NAME` and `PLUGIN_VERSION` in `packages/plugin/src/index.ts`, `CANARY_AGENT_ID` in `packages/web/src/pages/V2Inspector.tsx`, `E2E_PORT` in `scripts/e2e/e2e.test.mjs`.
- Use `private readonly` class fields for constructor-owned dependencies: `baseUrl` and `timeoutMs` in `packages/plugin/src/utils/sidecar-client.ts`, `minLevel` and `emitMetrics` in `packages/plugin/src/utils/logger.ts`.

**Types:**
- Use PascalCase for interfaces, classes, and type aliases: `MemoryFabricConfig` in `packages/plugin/src/types/index.ts`, `SidecarClientError` in `packages/plugin/src/utils/sidecar-client.ts`, `V2ServiceFacade` in `packages/sidecar/src/services/v2-service-facade.ts`.
- Use `Request` and `Response` suffixes for DTOs crossing API boundaries: `RecallRequest` and `RecallResponse` in `packages/plugin/src/utils/sidecar-client.ts`, `ErrorResponse` in `packages/sidecar/src/models/index.ts`.
- Use `Props` suffixes for React component props: `PageHeaderProps` in `packages/web/src/components/PageHeader.tsx`, `CarrierViewerProps` in `packages/web/src/pages/CarrierViewer.tsx`.
- Use literal unions for bounded options instead of loose strings: recall depth and scope in `packages/plugin/src/tools/memory-brief.ts`, V2 mode in `packages/plugin/src/utils/sidecar-client.ts`.

## Code Style

**Formatting:**
- Use Prettier from `.prettierrc.json`: semicolons, double quotes, no trailing commas, 100-character print width, 2-space indentation, always parenthesized arrow parameters, LF endings.
- Run `pnpm format` or package-local `pnpm -C packages/plugin format` / `pnpm -C packages/sidecar format` for plugin and sidecar TypeScript. The root format globs in `package.json` cover `packages/*/src/**/*.ts` and `packages/*/test/**/*.ts`.
- Treat `packages/web/src/**/*.tsx` as TypeScript/Vite-managed code. Root ESLint and Prettier scripts in `package.json` do not include `packages/web/**`, so keep web edits consistent with nearby files such as `packages/web/src/App.tsx` and `packages/web/src/components/StatusBar.tsx`.

**Linting:**
- Use ESLint 9 flat config in `eslint.config.js` for `packages/plugin/src`, `packages/plugin/test`, `packages/sidecar/src`, and `packages/sidecar/test`.
- Keep type-aware linting enabled through `typescript-eslint` `recommendedTypeChecked` with parser projects from `packages/plugin/tsconfig.json`, `packages/plugin/tsconfig.test.json`, `packages/sidecar/tsconfig.json`, and `packages/sidecar/tsconfig.test.json`.
- Use `import type` for type-only imports. `@typescript-eslint/consistent-type-imports` is an error in `eslint.config.js`.
- Handle floating promises with `await`, `return`, or `void`. `@typescript-eslint/no-floating-promises` is an error for production code in `eslint.config.js`; tests disable it under `packages/*/test/**/*.ts`.
- Prefix intentionally unused function arguments or variables with `_`; `eslint.config.js` allows underscore-prefixed unused names.
- Avoid `console.*` in plugin and sidecar production code. `eslint.config.js` allows only `console.error`, and `packages/sidecar/src/server.ts` uses it only in the direct-run startup failure handler.

## Import Organization

**Order:**
1. Built-in Node and external packages first, with `node:` prefixes where surrounding code uses them: `packages/plugin/src/hooks/before-prompt-build.ts`, `packages/sidecar/test/routes-integration.test.ts`.
2. Runtime local imports next, usually services, routes, stores, and utilities: `packages/sidecar/src/server.ts`.
3. Type-only imports use `import type` and may be grouped near the runtime import they describe: `packages/plugin/src/index.ts`, `packages/web/src/api/client.ts`.

**Path Aliases:**
- Not detected. Use relative imports in `packages/plugin/src/`, `packages/sidecar/src/`, and `packages/web/src/`; `tsconfig.base.json` and package `tsconfig.json` files do not define `paths`.
- Use explicit `.js` extensions for local imports in NodeNext packages so compiled output resolves correctly: `packages/plugin/src/index.ts`, `packages/sidecar/src/routes/recall.ts`.
- Do not add `.js` extensions in Vite React imports under `packages/web/src/`; existing web imports use extensionless bundler paths such as `../api/client` in `packages/web/src/App.tsx`.

## Error Handling

**Patterns:**
- Use custom `Error` subclasses for domain errors that need structured metadata: `ConfigValidationError` in `packages/plugin/src/config/loader.ts`, `SidecarClientError` in `packages/plugin/src/utils/sidecar-client.ts`, `MemoryBenchAlreadyRunningError` in `packages/sidecar/src/services/memory-bench-runner.ts`.
- Use Fastify schemas for request validation and the unified error handler in `packages/sidecar/src/server.ts` to return `ErrorResponse` with `BAD_REQUEST` or `SIDECAR_ERROR`.
- Let required operations throw and let route or caller-level error handling translate failures: `SidecarClient.request()` in `packages/plugin/src/utils/sidecar-client.ts`, `validateId()` and `validatePath()` in `packages/sidecar/src/utils/path-guard.ts`.
- Catch optional enrichment failures and continue when the result is explicitly best effort: shared recall and pattern injection in `packages/sidecar/src/routes/recall.ts`, carrier initialization in `packages/plugin/src/hooks/before-prompt-build.ts`.
- Degrade plugin hooks rather than blocking the agent when memory recall or commit fails: `createBeforePromptBuildHandler()` in `packages/plugin/src/hooks/before-prompt-build.ts`, `createAgentEndHandler()` in `packages/plugin/src/hooks/agent-end.ts`.
- In React code, convert thrown API errors to displayable strings through state helpers such as `useApi()` in `packages/web/src/hooks/useApi.ts`.

## Logging

**Framework:** Fastify logger plus custom plugin logger

**Patterns:**
- Use `Logger` in `packages/plugin/src/utils/logger.ts` for plugin logs. It writes JSON lines to `stderr` with `ts`, `level`, `plugin`, `msg`, and contextual fields.
- Log plugin hook success and degradation with structured fields such as `agentId`, `hook`, `latencyMs`, `sources`, and `degraded`: `packages/plugin/src/hooks/before-prompt-build.ts`, `packages/plugin/src/hooks/agent-end.ts`.
- Use `Logger.timed()` in `packages/plugin/src/utils/logger.ts` when an async operation should log latency and rethrow on failure.
- Use `Fastify({ logger: true })` in production sidecar startup through `packages/sidecar/src/server.ts`; tests use `Fastify({ logger: false })` in `packages/sidecar/test/routes-integration.test.ts`.
- Keep frontend network failures user-facing or silent based on local behavior. `packages/web/src/hooks/useApi.ts` stores `error`; polling and background loads in `packages/web/src/StatusBar.tsx` and `packages/web/src/App.tsx` intentionally ignore failures.

## Comments

**When to Comment:**
- Add comments for non-obvious interoperability or failure semantics: CommonJS interop in `packages/plugin/src/config/loader.ts`, degraded mode in `packages/plugin/src/hooks/before-prompt-build.ts`, generated route sections in `packages/sidecar/src/server.ts`.
- Use section banners for long API clients and test files to split responsibilities: `packages/plugin/src/utils/sidecar-client.ts`, `packages/plugin/test/tools.test.ts`, `packages/sidecar/test/routes-integration.test.ts`.
- Keep comments short and operational. Do not restate names or obvious assignments in service and route modules such as `packages/sidecar/src/routes/recall.ts`.

**JSDoc/TSDoc:**
- Use JSDoc on public helpers where caller behavior matters: `loadConfig()` in `packages/plugin/src/config/loader.ts`, `validatePath()` and `validateId()` in `packages/sidecar/src/utils/path-guard.ts`.
- Use inline type comments for field purpose when a DTO field is not self-explanatory: `toolCalls`, `turnCount`, and `sessionSummary` in `packages/plugin/src/utils/sidecar-client.ts`.

## Function Design

**Size:** Keep exported helpers small when they wrap one dependency, as in `packages/plugin/src/tools/memory-brief.ts`; larger orchestration belongs in classes such as `packages/plugin/src/orchestrator/recall-orchestrator.ts` or services such as `packages/sidecar/src/services/experience-service.ts`.

**Parameters:** Pass dependency instances explicitly into factories and route registration functions: `createMemoryBrief(client)` in `packages/plugin/src/tools/memory-brief.ts`, `registerRecallRoute(app, openviking, shared, patternStore)` in `packages/sidecar/src/routes/recall.ts`.

**Return Values:** Prefer typed object responses that mirror route and client contracts: `RecallResponse` in `packages/plugin/src/utils/sidecar-client.ts`, `ErrorResponse` in `packages/sidecar/src/models/index.ts`, React hook state from `packages/web/src/hooks/useApi.ts`.

## Module Design

**Exports:** Use named exports for plugin utilities, sidecar services, routes, and DTOs: `packages/plugin/src/index.ts`, `packages/sidecar/src/routes/health.ts`, `packages/sidecar/src/services/vector-service.ts`.

**Barrel Files:** Keep package-level and model-level barrels for stable public surfaces: `packages/plugin/src/index.ts`, `packages/sidecar/src/models/index.ts`. Avoid adding barrel files for every folder unless the folder already exposes one.

**Package Boundaries:** Put OpenClaw plugin hooks/tools/orchestrators under `packages/plugin/src/`, HTTP sidecar routes/services/stores under `packages/sidecar/src/`, and the inspector UI under `packages/web/src/`.

---

*Convention analysis: 2026-06-26*
