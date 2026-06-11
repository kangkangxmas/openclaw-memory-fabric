#!/usr/bin/env node
/**
 * Read-only canary monitor for a live v2 rollout.
 *
 * It does not write smoke memories or seed bench fixtures. It only reads health,
 * /v2/canary/status, and reports rollout checks for one agent/project.
 */

function parseArgs(argv) {
  const opts = {
    baseUrl: process.env.SIDECAR_URL ?? `http://127.0.0.1:${process.env.PORT ?? "7811"}`,
    agentId: "product",
    projectId: "Product",
    expectedMode: "v2-write",
    maxPending: 25,
    maxNeedsReview: 10,
    minCandidateSourceCoverage: 0.98,
    maxP95LatencyMs: 300,
    candidateLimit: 200,
    auditLimit: 50,
    json: false,
    strict: false,
    failOnWarn: false,
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
      case "--expected-mode":
        opts.expectedMode = argv[++i];
        break;
      case "--max-pending":
        opts.maxPending = Number(argv[++i]);
        break;
      case "--max-needs-review":
        opts.maxNeedsReview = Number(argv[++i]);
        break;
      case "--min-candidate-source-coverage":
        opts.minCandidateSourceCoverage = Number(argv[++i]);
        break;
      case "--max-p95-latency-ms":
        opts.maxP95LatencyMs = Number(argv[++i]);
        break;
      case "--candidate-limit":
        opts.candidateLimit = Number(argv[++i]);
        break;
      case "--audit-limit":
        opts.auditLimit = Number(argv[++i]);
        break;
      case "--json":
        opts.json = true;
        break;
      case "--strict":
        opts.strict = true;
        break;
      case "--fail-on-warn":
        opts.failOnWarn = true;
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

  for (const [key, value] of Object.entries({
    maxPending: opts.maxPending,
    maxNeedsReview: opts.maxNeedsReview,
    minCandidateSourceCoverage: opts.minCandidateSourceCoverage,
    maxP95LatencyMs: opts.maxP95LatencyMs,
    candidateLimit: opts.candidateLimit,
    auditLimit: opts.auditLimit,
  })) {
    if (!Number.isFinite(value)) throw new Error(`--${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)} must be numeric`);
  }

  return opts;
}

function printHelp() {
  console.log(`OpenClaw Memory Fabric v2 canary monitor

Options:
  --base-url URL                         Sidecar base URL. Default: SIDECAR_URL or http://127.0.0.1:7811
  --agent-id ID                          Agent id. Default: product
  --project-id ID                        Project id. Default: Product
  --expected-mode MODE                   Expected effective mode. Default: v2-write
  --max-pending N                        Fail threshold for pending candidates. Default: 25
  --max-needs-review N                   Fail threshold for needs_review candidates. Default: 10
  --min-candidate-source-coverage N      Required recent candidate sourceRef coverage. Default: 0.98
  --max-p95-latency-ms N                 Bench P95 threshold when a bench exists. Default: 300
  --candidate-limit N                    Candidate sample size. Default: 200
  --audit-limit N                        Recall audit sample size. Default: 50
  --strict                               Exit non-zero on failed checks
  --fail-on-warn                         Also exit non-zero on warnings
  --json                                 Print machine-readable JSON summary
`);
}

async function request(baseUrl, method, path) {
  const res = await fetch(`${baseUrl}${path}`, { method });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${path} failed with ${res.status}: ${text}`);
  }
  return payload;
}

function pct(value) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function evaluate(summary) {
  const failures = [];
  const warnings = [];
  if (!summary.health?.ok) failures.push("health check failed");

  for (const check of summary.canary.checks ?? []) {
    if (check.status === "fail") failures.push(`${check.id}: ${check.message}`);
    if (check.status === "warn") warnings.push(`${check.id}: ${check.message}`);
  }

  return { failures, warnings };
}

function printSummary(summary, evaluation) {
  const { opts, health, canary } = summary;
  const worker = canary.worker ?? {};
  const candidateStats = canary.candidateStats ?? {};
  const byStatus = candidateStats.byStatus ?? {};
  const recallAudit = canary.recallAudit ?? {};

  console.log("OpenClaw Memory Fabric v2 Canary Monitor");
  console.log(`sidecar: ${opts.baseUrl}`);
  console.log(`health: ${health?.ok ? "ok" : "failed"} (${health?.service ?? "unknown"} ${health?.version ?? ""})`);
  console.log(`agent/project: ${opts.agentId} / ${opts.projectId}`);
  console.log(`mode: ${canary.mode} (expected ${opts.expectedMode})`);
  console.log(
    `worker: running=${Boolean(worker.running)} scope=${worker.agentId ?? "n/a"}/${worker.projectId ?? "n/a"} ` +
      `errors=${worker.errorCount ?? 0} lastRun=${worker.lastRunAt ?? "n/a"}`
  );
  console.log(
    `queue: pending=${byStatus.pending ?? 0} needs_review=${byStatus.needs_review ?? 0} ` +
      `rejected=${byStatus.rejected ?? 0} promoted=${byStatus.promoted ?? 0}`
  );
  console.log(`candidate sourceRef coverage: ${pct(canary.candidateSourceCoverage)}`);
  console.log(
    `recall audit: count=${recallAudit.count ?? 0} avgCards=${(recallAudit.avgV2CardCount ?? 0).toFixed(1)} ` +
      `avgEvidence=${(recallAudit.avgV2EvidenceCount ?? 0).toFixed(1)}`
  );
  if (canary.bench) {
    console.log(`bench: source=${pct(canary.bench.sourceCoverage)} p95=${canary.bench.p95LatencyMs}ms`);
  } else {
    console.log("bench: none");
  }
  console.log(`status: ${canary.status}`);

  if (evaluation.warnings.length > 0) {
    console.warn("warnings:");
    for (const warning of evaluation.warnings) console.warn(`- ${warning}`);
  }
  if (evaluation.failures.length > 0) {
    console.error("failures:");
    for (const failure of evaluation.failures) console.error(`- ${failure}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const health = await request(opts.baseUrl, "GET", "/health");
  const qs = new URLSearchParams({
    agentId: opts.agentId,
    projectId: opts.projectId,
    expectedMode: opts.expectedMode,
    maxPending: String(opts.maxPending),
    maxNeedsReview: String(opts.maxNeedsReview),
    minCandidateSourceCoverage: String(opts.minCandidateSourceCoverage),
    maxP95LatencyMs: String(opts.maxP95LatencyMs),
    candidateLimit: String(opts.candidateLimit),
    auditLimit: String(opts.auditLimit),
  });
  const canary = await request(opts.baseUrl, "GET", `/v2/canary/status?${qs.toString()}`);
  const summary = { opts, health, canary };
  const evaluation = evaluate(summary);

  if (opts.json) {
    console.log(JSON.stringify({ ...summary, ...evaluation }, null, 2));
  } else {
    printSummary(summary, evaluation);
  }

  if (opts.strict && evaluation.failures.length > 0) process.exit(1);
  if (opts.failOnWarn && evaluation.warnings.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
