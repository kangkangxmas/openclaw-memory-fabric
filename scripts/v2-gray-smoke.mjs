#!/usr/bin/env node
/**
 * Runs the v2 gray workflow against a live sidecar:
 * health -> optional fixture save -> fixture read -> seed -> bench -> gray status.
 *
 * Usage:
 *   pnpm v2:gray-smoke -- --base-url http://127.0.0.1:7811
 *   pnpm v2:gray-smoke -- --fixture-file ./fixtures/development.json --strict
 */

import { readFile } from "node:fs/promises";

const TARGETS = {
  recallAt5: 0.85,
  injectionPrecision: 0.8,
  staleRate: 0.05,
  sourceCoverage: 0.98,
  p95LatencyMs: 300,
};

function parseArgs(argv) {
  const opts = {
    baseUrl: process.env.SIDECAR_URL ?? `http://127.0.0.1:${process.env.PORT ?? "7811"}`,
    agentId: "development",
    projectId: "openclaw-memory-fabric",
    fixtureFile: undefined,
    fixtureMode: "append",
    limit: 50,
    json: false,
    strict: false,
    requireV2Mode: false,
    defaultCases: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--":
        break;
      case "--base-url":
        opts.baseUrl = argv[++i];
        break;
      case "--agent-id":
        opts.agentId = argv[++i];
        break;
      case "--project-id":
        opts.projectId = argv[++i];
        break;
      case "--fixture-file":
        opts.fixtureFile = argv[++i];
        break;
      case "--fixture-mode":
        opts.fixtureMode = argv[++i];
        break;
      case "--limit":
        opts.limit = Number(argv[++i]);
        break;
      case "--json":
        opts.json = true;
        break;
      case "--strict":
        opts.strict = true;
        break;
      case "--require-v2-mode":
        opts.requireV2Mode = true;
        break;
      case "--default-cases":
        opts.defaultCases = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (opts.fixtureMode !== "append" && opts.fixtureMode !== "replace") {
    throw new Error("--fixture-mode must be append or replace");
  }
  if (!Number.isFinite(opts.limit) || opts.limit < 1) {
    throw new Error("--limit must be a positive number");
  }
  return opts;
}

function printHelp() {
  console.log(`OpenClaw Memory Fabric v2 gray smoke

Options:
  --base-url URL          Sidecar base URL. Default: SIDECAR_URL or http://127.0.0.1:7811
  --agent-id ID           Agent id. Default: development
  --project-id ID         Project id. Default: openclaw-memory-fabric
  --fixture-file PATH     Optional JSON fixture file: array or { "cases": [...] }
  --fixture-mode MODE     append or replace when saving fixture file. Default: append
  --limit N               Max cases to seed/run. Default: 50
  --default-cases         Ignore persisted fixtures and use built-in default bench cases
  --strict                Fail if bench/readiness targets are not met
  --require-v2-mode       Fail unless MEMORY_FABRIC_V2_MODE is v2-recall or v2-write
  --json                  Print machine-readable JSON summary
`);
}

async function request(baseUrl, method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${path} failed with ${res.status}: ${text}`);
  }
  return payload;
}

async function loadFixtureFile(path) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  const cases = Array.isArray(raw) ? raw : raw.cases;
  if (!Array.isArray(cases)) {
    throw new Error("fixture file must be an array or an object with a cases array");
  }
  return cases;
}

function pct(value) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function evaluate(summary, opts) {
  const failures = [];
  const { bench, gray } = summary;

  if (opts.requireV2Mode && !gray.readiness.modeReady) {
    failures.push(`mode is ${gray.mode}, expected v2-recall or v2-write`);
  }

  if (opts.strict) {
    if (!gray.readiness.candidateQueueHealthy) failures.push("candidate queue is not healthy");
    if (!gray.readiness.sourceCoverageReady) failures.push("source coverage readiness failed");
    if (!gray.readiness.latencyReady) failures.push("latency readiness failed");
    if (bench.recallAt5 < TARGETS.recallAt5) failures.push(`Recall@5 ${bench.recallAt5} < ${TARGETS.recallAt5}`);
    if (bench.injectionPrecision < TARGETS.injectionPrecision) {
      failures.push(`Injection Precision ${bench.injectionPrecision} < ${TARGETS.injectionPrecision}`);
    }
    if (bench.staleRate > TARGETS.staleRate) failures.push(`Stale Rate ${bench.staleRate} > ${TARGETS.staleRate}`);
    if (bench.sourceCoverage < TARGETS.sourceCoverage) {
      failures.push(`Source Coverage ${bench.sourceCoverage} < ${TARGETS.sourceCoverage}`);
    }
    if (bench.p95LatencyMs > TARGETS.p95LatencyMs) failures.push(`P95 latency ${bench.p95LatencyMs}ms > ${TARGETS.p95LatencyMs}ms`);
  }

  return failures;
}

function printSummary(summary, failures) {
  const { opts, fixtures, seed, bench, gray } = summary;
  console.log("OpenClaw Memory Fabric v2 Gray Smoke");
  console.log(`sidecar: ${opts.baseUrl}`);
  console.log(`agent/project: ${opts.agentId} / ${opts.projectId}`);
  console.log(`mode: ${gray.mode}`);
  console.log(`fixtures: ${fixtures.count} (${fixtures.source}), useFixtures=${summary.useFixtures}`);
  console.log(`seed: requested=${seed.requested}, promoted=${seed.promoted}, skipped=${seed.skippedExisting}, review=${seed.needsReview}`);
  console.log(
    `bench: cases=${bench.cases}, Recall@5=${pct(bench.recallAt5)}, Precision=${pct(bench.injectionPrecision)}, ` +
      `Stale=${pct(bench.staleRate)}, Source=${pct(bench.sourceCoverage)}, P95=${bench.p95LatencyMs}ms`
  );
  console.log(
    `readiness: mode=${gray.readiness.modeReady ? "ready" : "wait"}, queue=${gray.readiness.candidateQueueHealthy ? "ready" : "wait"}, ` +
      `source=${gray.readiness.sourceCoverageReady ? "ready" : "wait"}, latency=${gray.readiness.latencyReady ? "ready" : "wait"}`
  );

  if (failures.length > 0) {
    console.error("failures:");
    for (const failure of failures) console.error(`- ${failure}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const health = await request(opts.baseUrl, "GET", "/health");
  if (!health?.ok) throw new Error("sidecar health check returned ok=false");

  let savedFixtures;
  if (opts.fixtureFile) {
    const cases = await loadFixtureFile(opts.fixtureFile);
    savedFixtures = await request(opts.baseUrl, "POST", "/v2/bench/fixtures", {
      mode: opts.fixtureMode,
      cases,
    });
  }

  const fixtures = await request(opts.baseUrl, "GET", "/v2/bench/fixtures");
  const useFixtures = !opts.defaultCases && fixtures.count > 0;

  const seedResponse = await request(opts.baseUrl, "POST", "/v2/bench/seed", {
    agentId: opts.agentId,
    projectId: opts.projectId,
    limit: opts.limit,
    useFixtures,
  });

  const benchResponse = await request(opts.baseUrl, "POST", "/v2/bench/run", {
    agentId: opts.agentId,
    projectId: opts.projectId,
    limit: opts.limit,
    useFixtures,
    persist: useFixtures || Boolean(opts.fixtureFile),
  });

  const qs = new URLSearchParams({ agentId: opts.agentId, projectId: opts.projectId });
  const gray = await request(opts.baseUrl, "GET", `/v2/gray/status?${qs.toString()}`);

  const summary = {
    opts,
    health,
    savedFixtures,
    fixtures,
    useFixtures,
    seed: seedResponse.result,
    bench: benchResponse.report,
    gray,
  };
  const failures = evaluate(summary, opts);

  if (opts.json) {
    console.log(JSON.stringify({ ...summary, failures }, null, 2));
  } else {
    printSummary(summary, failures);
  }

  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
