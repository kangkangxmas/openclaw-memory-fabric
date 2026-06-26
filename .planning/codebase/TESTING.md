# Testing Patterns

**Analysis Date:** 2026-06-26

## Test Framework

**Runner:**
- Node built-in test runner through `node:test`; no Vitest or Jest config is present in `package.json`, `packages/plugin/package.json`, or `packages/sidecar/package.json`.
- TypeScript tests compile before execution through package `tsconfig.test.json` files: `packages/plugin/tsconfig.test.json`, `packages/sidecar/tsconfig.test.json`.
- Package test scripts emit compiled tests into `dist-test/` and run `node --test dist-test/test/*.test.js`: `packages/plugin/package.json`, `packages/sidecar/package.json`.

**Assertion Library:**
- Use `node:assert/strict` for plugin tests and many sidecar integration tests: `packages/plugin/test/config-loader.test.ts`, `packages/plugin/test/tools.test.ts`, `packages/sidecar/test/routes-integration.test.ts`.
- Use the local Jest-like adapter in `packages/sidecar/test/test-helpers.ts` for sidecar V2/core tests that prefer `expect()`, `beforeAll`, and `afterAll`: `packages/sidecar/test/advanced-query.test.ts`, `packages/sidecar/test/v2-service-facade.test.ts`.

**Run Commands:**
```bash
pnpm test                       # Run package tests through pnpm workspaces
pnpm -C packages/plugin test    # Compile and run plugin tests
pnpm -C packages/sidecar test   # Compile and run sidecar tests
pnpm test:e2e                   # Run script-level E2E test against compiled sidecar dist
pnpm typecheck                  # Run TypeScript type checks across workspaces
pnpm lint                       # Run ESLint for plugin and sidecar TypeScript
```

## Test File Organization

**Location:**
- Keep plugin tests in `packages/plugin/test/` beside the plugin package; examples include `packages/plugin/test/tools.test.ts`, `packages/plugin/test/hooks.test.ts`, and `packages/plugin/test/recall-orchestrator.test.ts`.
- Keep sidecar tests in `packages/sidecar/test/` beside the sidecar package; examples include `packages/sidecar/test/routes-integration.test.ts`, `packages/sidecar/test/vector-service-v2.test.ts`, and `packages/sidecar/test/memory-fabric-v2.test.ts`.
- Keep process-level E2E smoke coverage in `scripts/e2e/`; `scripts/e2e/e2e.test.mjs` starts the compiled sidecar process and calls HTTP endpoints.
- No web tests are detected under `packages/web/src/` or `packages/web/`; the web package has build-only validation through `packages/web/package.json`.

**Naming:**
- Use `*.test.ts` for TypeScript package tests: `packages/sidecar/test/path-guard.test.ts`, `packages/plugin/test/config-loader.test.ts`.
- Use domain names matching the implementation module under test: `packages/sidecar/test/brief-templates.test.ts` tests `packages/sidecar/src/services/brief-templates.ts`; `packages/sidecar/test/query-router.test.ts` tests `packages/sidecar/src/core/query-router.ts`.
- Use `e2e.test.mjs` for direct Node E2E scripts under `scripts/e2e/`.

**Structure:**
```text
packages/plugin/
├── src/
└── test/
    ├── tools.test.ts
    ├── hooks.test.ts
    └── config-loader.test.ts

packages/sidecar/
├── src/
└── test/
    ├── test-helpers.ts
    ├── routes-integration.test.ts
    └── *-service.test.ts

scripts/e2e/
└── e2e.test.mjs
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateId } from "../src/utils/path-guard.js";

describe("validateId", () => {
  it("throws on empty string", () => {
    assert.throws(() => validateId("", "agentId"), /must not be empty/);
  });
});
```

**Patterns:**
- Group tests by public function, route, or service method with `describe()` blocks: `packages/plugin/test/tools.test.ts`, `packages/sidecar/test/carrier-merge.test.ts`.
- Use one behavior per `it()` and put the expected behavior in the test name: `packages/sidecar/test/routes-integration.test.ts`, `packages/sidecar/test/path-guard.test.ts`.
- For route tests, build a package-local Fastify app, register only the needed routes, call `await app.ready()`, then test with `app.inject()`: `packages/sidecar/test/routes-integration.test.ts`.
- For filesystem-backed tests, create temporary roots with `mkdtemp(join(tmpdir(), "..."))` or `mkdtempSync(join(tmpdir(), "..."))` and clean them with `rm(..., { recursive: true })` or `rmSync(..., { recursive: true })`: `packages/sidecar/test/routes-integration.test.ts`, `packages/sidecar/test/experience-service.test.ts`.
- For process-level E2E, run against compiled `packages/sidecar/dist/server.js`, set test-specific env vars, poll `/health`, and clean up the spawned process and temp directory: `scripts/e2e/e2e.test.mjs`.

## Mocking

**Framework:** Manual stubs and local helpers

**Patterns:**
```typescript
function makeClient(overrides: Record<string, (...args: unknown[]) => unknown>) {
  return overrides as unknown as SidecarClient;
}

const client = makeClient({
  recall: async (req: unknown) => {
    captured = req;
    return { memoryBrief: "", sources: [], budgetUsed: 0 };
  }
});
```

**What to Mock:**
- Mock `SidecarClient` methods when testing plugin tool factories and orchestrators: `packages/plugin/test/tools.test.ts`, `packages/plugin/test/recall-orchestrator.test.ts`.
- Mock `Logger` with an in-memory call array when testing hook logging behavior: `packages/plugin/test/hooks.test.ts`.
- Use Fastify `inject()` instead of opening ports for sidecar route integration tests: `packages/sidecar/test/routes-integration.test.ts`, `packages/sidecar/test/memory-fabric-v2.test.ts`.
- Use temporary filesystem roots instead of real OpenViking or carrier directories: `packages/sidecar/test/openviking-scope.test.ts`, `packages/sidecar/test/carrier-merge.test.ts`.

**What NOT to Mock:**
- Do not mock the Fastify routing layer when the behavior is request validation or response shape; use `app.inject()` as in `packages/sidecar/test/routes-integration.test.ts`.
- Do not touch the developer's real `~/.openclaw`, OpenViking, carrier, or graph directories; tests use `tmpdir()`-scoped paths in `packages/sidecar/test/*.test.ts`.
- Do not rely on live network services for package tests. External embedding/LLM paths are covered with stubs or config-level tests such as `packages/sidecar/test/embedding-service-v2.test.ts`.

## Fixtures and Factories

**Test Data:**
```typescript
const createEntry = (
  id: string,
  content: string,
  type: string,
  agentId: string,
  tags?: string[],
  priority?: number
) => {
  const builder = new MemoryEntryBuilder()
    .id(id)
    .type(type as any)
    .content(content)
    .agentId(agentId)
    .scope("private")
    .visibility("private");
  tags?.forEach((t) => builder.tag(t));
  const entry = builder.build();
  if (priority !== undefined) entry.metadata.priority = priority;
  return entry;
};
```

**Location:**
- Keep small factories local to the test file when they are specific to one module: `createEntry()` in `packages/sidecar/test/advanced-query.test.ts`, `makeLogger()` in `packages/plugin/test/hooks.test.ts`.
- Use shared helpers only for cross-cutting assertion style and lifecycle wrappers: `packages/sidecar/test/test-helpers.ts`.
- Use service builders and domain builders from source when they are part of the contract under test: `MemoryEntryBuilder` in `packages/sidecar/test/schema-v2.test.ts`, `packages/sidecar/test/advanced-query.test.ts`.

## Coverage

**Requirements:** None enforced by package scripts. No coverage command, coverage threshold, `c8`, `nyc`, Vitest coverage, or Node test coverage flag is detected in `package.json`, `packages/plugin/package.json`, or `packages/sidecar/package.json`.

**View Coverage:**
```bash
# Not configured
```

## Test Types

**Unit Tests:**
- Use direct assertions for pure functions and small services: `packages/sidecar/test/path-guard.test.ts`, `packages/sidecar/test/brief-templates.test.ts`, `packages/plugin/test/config-loader.test.ts`.
- Use local builders and static arrays for deterministic core logic tests: `packages/sidecar/test/advanced-query.test.ts`, `packages/sidecar/test/memory-index.test.ts`.

**Integration Tests:**
- Use package-local Fastify apps with real sidecar route registration and temp-backed services: `packages/sidecar/test/routes-integration.test.ts`, `packages/sidecar/test/memory-fabric-v2.test.ts`.
- Use filesystem-backed stores and services against temporary directories for persistence and isolation checks: `packages/sidecar/test/federation-service.test.ts`, `packages/sidecar/test/carrier-merge.test.ts`.

**E2E Tests:**
- Use Node's test runner and real process startup through `scripts/e2e/e2e.test.mjs`.
- Build before running E2E because `scripts/e2e/e2e.test.mjs` starts `packages/sidecar/dist/server.js`.

## Common Patterns

**Async Testing:**
```typescript
before(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "sidecar-health-"));
  app = await buildTestApp(tmpDir);
});

after(async () => {
  await app.close();
  await rm(tmpDir, { recursive: true });
});
```

**Error Testing:**
```typescript
assert.throws(
  () => validatePath("../../etc/passwd", "/allowed/root"),
  /Path traversal detected/
);
```

**HTTP Route Testing:**
```typescript
const res = await app.inject({
  method: "POST",
  url: "/recall",
  payload: { agentId: "agent-r1", depth: "l0" }
});
assert.equal(res.statusCode, 200);
const body = JSON.parse(res.body) as { memoryBrief: string; sources: string[] };
```

**Stub Verification:**
```typescript
let captured: unknown;
const client = makeClient({
  commit: async (req: unknown) => {
    captured = req;
    return { ok: true as const, committed: 0, publishCandidates: [] };
  }
});
```

---

*Testing analysis: 2026-06-26*
