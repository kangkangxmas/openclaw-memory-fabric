#!/usr/bin/env node
/**
 * Builds source-backed fixture cases from promoted candidates, seeds them, then
 * runs the acceptance fixture bench. This is the pre-rollout loop for expanding
 * v2-write beyond the canary agent.
 */

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
    scopes: [
      { agentId: "product", projectId: "Product" },
      { agentId: "development", projectId: "Development" },
      { agentId: "main", projectId: "main" },
    ],
    maxCases: 40,
    perScope: 20,
    fixtureMode: "replace",
    candidateLimit: 1000,
    caseTimeoutMs: 5000,
    totalTimeoutMs: 60000,
    strict: false,
    json: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--":
        break;
      case "--base-url":
        opts.baseUrl = argv[++i];
        break;
      case "--scope":
        opts.scopes.push(parseScope(argv[++i]));
        break;
      case "--replace-scopes":
        opts.scopes = String(argv[++i]).split(",").map(parseScope);
        break;
      case "--max-cases":
        opts.maxCases = Number(argv[++i]);
        break;
      case "--per-scope":
        opts.perScope = Number(argv[++i]);
        break;
      case "--fixture-mode":
        opts.fixtureMode = argv[++i];
        break;
      case "--candidate-limit":
        opts.candidateLimit = Number(argv[++i]);
        break;
      case "--case-timeout-ms":
        opts.caseTimeoutMs = Number(argv[++i]);
        break;
      case "--total-timeout-ms":
        opts.totalTimeoutMs = Number(argv[++i]);
        break;
      case "--strict":
        opts.strict = true;
        break;
      case "--json":
        opts.json = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
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

  if (opts.fixtureMode !== "replace" && opts.fixtureMode !== "append") throw new Error("--fixture-mode must be replace or append");
  for (const key of ["maxCases", "perScope", "candidateLimit", "caseTimeoutMs", "totalTimeoutMs"]) {
    if (!Number.isFinite(opts[key]) || opts[key] < 1) throw new Error(`--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)} must be positive`);
  }
  return opts;
}

function parseScope(value) {
  const [agentId, projectId] = String(value).includes("::") ? String(value).split("::", 2) : String(value).split("/", 2);
  if (!agentId) throw new Error(`Invalid scope: ${value}`);
  return { agentId, projectId: projectId || undefined };
}

function printHelp() {
  console.log(`OpenClaw Memory Fabric v2 acceptance loop

Options:
  --base-url URL          Sidecar base URL. Default: SIDECAR_URL or http://127.0.0.1:7811
  --scope A/P             Add a scope. Repeatable. Defaults include product/Product, development/Development, and main/main
  --replace-scopes LIST   Replace default scopes with comma-separated A/P or A::P entries
  --max-cases N           Max generated fixture cases. Default: 40
  --per-scope N           Max fixture cases per scope. Default: 20
  --fixture-mode MODE     replace or append. Default: replace
  --candidate-limit N     Candidate sample size per scope. Default: 1000
  --case-timeout-ms N     Per-case bench timeout. Default: 5000
  --total-timeout-ms N    Total bench timeout. Default: 60000
  --dry-run               Only print generated cases; do not save/seed/run
  --strict                Exit non-zero if acceptance targets fail
  --json                  Print machine-readable JSON summary
`);
}

async function request(opts, method, path, body) {
  const res = await fetch(`${opts.baseUrl}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} failed with ${res.status}: ${text}`);
  return payload;
}

function isSensitive(content) {
  const value = String(content);
  const patterns = [
    /DB_PASS|DB_PASSWORD|PASSWORD|PASSWD|SECRET|TOKEN|密钥|口令|密码|access[_-]?key|api[_-]?key/i,
    /\b(?:mysql|postgres(?:ql)?|mongodb|redis):\/\/[^/\s:@]+:[^@\s]+@/i,
    /\b(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}\/[\w.-]+[,，]\s*[\w.-]+\/\S+/i,
    /\b(?:user|username|db_user|账号|用户名)\s*[:=]\s*\S+.*(?:pass|password|db_pass|密码|口令)\s*[:=]\s*\S+/i,
    /(?:数据库连接信息|database connection|db connection)/i,
  ];
  return patterns.some((pattern) => pattern.test(value));
}

function tokens(content) {
  const result = [];
  for (const chunk of content.match(/[\p{L}\p{N}_-]+/gu) ?? []) {
    if (/[\p{Script=Han}]/u.test(chunk)) {
      if (chunk.length >= 2) result.push(chunk.slice(0, Math.min(6, chunk.length)));
      continue;
    }
    if (chunk.length >= 3) result.push(chunk);
  }
  return [...new Set(result)]
    .filter((item) => !/^(the|and|for|with|this|that|true|false|null|undefined)$/i.test(item))
    .slice(0, 4);
}

function candidateScore(candidate) {
  const q = candidate.quality ?? {};
  const typeWeight = { decision: 4, fact: 3, pattern: 2, lesson: 2, episode: 2, unresolved: 1, entity: 0.5 }[candidate.type] ?? 1;
  return typeWeight + (candidate.sourceRefs?.length ?? 0) * 2 + (q.specificity ?? 0) + (q.actionability ?? 0);
}

function candidateToCase(candidate, index) {
  const expectedTerms = tokens(candidate.content);
  if (expectedTerms.length < 3) return null;
  const compact = candidate.content.replace(/\s+/g, " ").trim();
  const query = compact.length <= 120 ? `确认这条真实记忆：${compact}` : `确认这条真实记忆：${compact.slice(0, 117)}...`;
  return {
    id: `real-${candidate.agentId}-${candidate.projectId ?? "private"}-${candidate.type}-${String(index + 1).padStart(2, "0")}`,
    query,
    expectedTerms,
    agentId: candidate.agentId,
    projectId: candidate.projectId,
  };
}

async function collectCases(opts) {
  const cases = [];
  const seen = new Set();
  for (const scope of opts.scopes) {
    const qs = new URLSearchParams({
      agentId: scope.agentId,
      status: "promoted",
      limit: String(opts.candidateLimit),
    });
    if (scope.projectId) qs.set("projectId", scope.projectId);
    const response = await request(opts, "GET", `/v2/memories/candidates?${qs.toString()}`);
    const candidates = [...(response.candidates ?? [])]
      .filter((candidate) => (candidate.sourceRefs?.length ?? 0) > 0)
      .filter((candidate) => !candidate.tags?.some((tag) => String(tag).startsWith("bench_fixture")))
      .filter((candidate) => candidate.content.length >= 8)
      .filter((candidate) => !isSensitive(candidate.content))
      .sort((a, b) => candidateScore(b) - candidateScore(a))
      .slice(0, opts.perScope);

    for (const candidate of candidates) {
      const item = candidateToCase(candidate, cases.length);
      if (!item) continue;
      const key = `${item.agentId}/${item.projectId ?? ""}/${item.query}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cases.push(item);
      if (cases.length >= opts.maxCases) break;
    }
    if (cases.length >= opts.maxCases) break;
  }
  return cases;
}

function evaluate(bench, cases) {
  const failures = [];
  if (cases.length < 30) failures.push(`fixture case count ${cases.length} < 30`);
  if (bench.status !== "complete") failures.push(`bench status is ${bench.status}`);
  if (bench.recallAt5 < TARGETS.recallAt5) failures.push(`Recall@5 ${bench.recallAt5} < ${TARGETS.recallAt5}`);
  if (bench.injectionPrecision < TARGETS.injectionPrecision) {
    failures.push(`Injection Precision ${bench.injectionPrecision} < ${TARGETS.injectionPrecision}`);
  }
  if (bench.staleRate > TARGETS.staleRate) failures.push(`Stale Rate ${bench.staleRate} > ${TARGETS.staleRate}`);
  if (bench.sourceCoverage < TARGETS.sourceCoverage) failures.push(`Source Coverage ${bench.sourceCoverage} < ${TARGETS.sourceCoverage}`);
  if (bench.p95LatencyMs > TARGETS.p95LatencyMs) failures.push(`P95 latency ${bench.p95LatencyMs}ms > ${TARGETS.p95LatencyMs}ms`);
  return failures;
}

function pct(value) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function printSummary(summary) {
  const { opts, cases, savedFixtures, seed, bench, failures } = summary;
  console.log("OpenClaw Memory Fabric v2 Acceptance Loop");
  console.log(`sidecar: ${opts.baseUrl}`);
  console.log(`scopes: ${opts.scopes.map((scope) => `${scope.agentId}/${scope.projectId ?? ""}`).join(", ")}`);
  console.log(`fixtures: generated=${cases.length} saved=${savedFixtures?.count ?? 0}`);
  if (seed) {
    console.log(`seed: requested=${seed.requested} created=${seed.createdCandidates} promoted=${seed.promoted} skipped=${seed.skippedExisting}`);
  }
  if (bench) {
    console.log(
      `bench: status=${bench.status} cases=${bench.cases} Recall@5=${pct(bench.recallAt5)} Precision=${pct(bench.injectionPrecision)} ` +
        `Source=${pct(bench.sourceCoverage)} Stale=${pct(bench.staleRate)} P95=${bench.p95LatencyMs}ms`
    );
  }
  if (failures.length > 0) {
    console.error("failures:");
    for (const failure of failures) console.error(`- ${failure}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const health = await request(opts, "GET", "/health");
  if (!health?.ok) throw new Error("sidecar health check returned ok=false");

  const cases = await collectCases(opts);
  if (opts.dryRun) {
    const summary = { opts, cases, failures: [] };
    if (opts.json) console.log(JSON.stringify(summary, null, 2));
    else printSummary(summary);
    return;
  }

  const savedFixtures = await request(opts, "POST", "/v2/bench/fixtures", { mode: opts.fixtureMode, cases });
  const seedResponse = await request(opts, "POST", "/v2/bench/seed", { useFixtures: true, limit: opts.maxCases });
  const benchResponse = await request(opts, "POST", "/v2/bench/run", {
    useFixtures: true,
    persist: true,
    limit: opts.maxCases,
    caseTimeoutMs: opts.caseTimeoutMs,
    totalTimeoutMs: opts.totalTimeoutMs,
  });
  const failures = evaluate(benchResponse.report, cases);
  const summary = {
    opts,
    cases,
    savedFixtures,
    seed: seedResponse.result,
    bench: benchResponse.report,
    failures,
  };

  if (opts.json) console.log(JSON.stringify(summary, null, 2));
  else printSummary(summary);
  if (opts.strict && failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
