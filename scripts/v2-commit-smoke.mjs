#!/usr/bin/env node
/**
 * Runs a commit-path preflight against a live sidecar:
 * health -> gray status -> /commit -> v2 candidate/sourceRefs -> consolidation -> v2 recall -> legacy recall.
 *
 * Usage:
 *   pnpm v2:commit-smoke -- --base-url http://127.0.0.1:7811 --strict
 *   pnpm v2:commit-smoke -- --require-v2-write --json
 */

const TARGET_TIMEOUT_MS = 5_000;

function parseArgs(argv) {
  const opts = {
    baseUrl: process.env.SIDECAR_URL ?? `http://127.0.0.1:${process.env.PORT ?? "7811"}`,
    agentId: "development",
    projectId: "openclaw-memory-fabric",
    timeoutMs: TARGET_TIMEOUT_MS,
    strict: false,
    requireV2Write: false,
    json: false,
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
      case "--timeout-ms":
        opts.timeoutMs = Number(argv[++i]);
        break;
      case "--strict":
        opts.strict = true;
        break;
      case "--require-v2-write":
        opts.requireV2Write = true;
        break;
      case "--json":
        opts.json = true;
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

  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs < 500) {
    throw new Error("--timeout-ms must be a number >= 500");
  }
  return opts;
}

function printHelp() {
  console.log(`OpenClaw Memory Fabric v2 commit smoke

Options:
  --base-url URL          Sidecar base URL. Default: SIDECAR_URL or http://127.0.0.1:7811
  --agent-id ID           Agent id. Default: development
  --project-id ID         Project id. Default: openclaw-memory-fabric
  --timeout-ms N          Poll timeout for async shadow writes. Default: 5000
  --strict                Fail unless v2 and legacy commit paths are both validated
  --require-v2-write      Fail unless MEMORY_FABRIC_V2_MODE is v2-write
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

async function waitForCandidates(opts, runId) {
  const deadline = Date.now() + opts.timeoutMs;
  let latest = [];
  const qs = new URLSearchParams({
    agentId: opts.agentId,
    projectId: opts.projectId,
    limit: "500",
  });

  while (Date.now() < deadline) {
    const response = await request(opts.baseUrl, "GET", `/v2/memories/candidates?${qs.toString()}`);
    latest = response.candidates ?? [];
    const related = latest.filter((candidate) => String(candidate.content ?? "").includes(runId));
    if (related.length > 0) return { latest, related };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return {
    latest,
    related: latest.filter((candidate) => String(candidate.content ?? "").includes(runId)),
  };
}

function evaluate(summary) {
  const failures = [];
  const mode = summary.mode;
  const expectV2 = mode !== "off";

  if (!summary.health?.ok) failures.push("health check failed");
  if (!summary.commit?.ok) failures.push("/commit did not return ok=true");
  if (summary.opts.requireV2Write && mode !== "v2-write") failures.push(`mode is ${mode}, expected v2-write`);

  if (summary.opts.strict) {
    if (!summary.legacyRecallContainsRunId) failures.push("legacy /recall did not return committed content");

    if (expectV2) {
      if (!["queued", "written"].includes(summary.commit.v2?.status)) {
        failures.push(`commit v2 status is ${summary.commit.v2?.status ?? "missing"}`);
      }
      if (summary.relatedCandidates.length < 2) failures.push(`related v2 candidates ${summary.relatedCandidates.length} < 2`);
      if (!summary.candidateSourceRefsOk) failures.push("one or more related v2 candidates have no sourceRefs");
      if (!summary.v2RecallContainsRunId) failures.push("v2 recall cards did not return committed content");
    }

    if (mode === "v2-write") {
      if (summary.commit.v2?.status !== "written") failures.push(`v2-write status is ${summary.commit.v2?.status}`);
      if ((summary.commit.v2?.candidateCount ?? 0) < 2) failures.push("v2-write candidateCount is below expected");
      if (summary.commit.v2?.legacyStatus !== "written") failures.push(`legacy fallback status is ${summary.commit.v2?.legacyStatus}`);
    }
  }

  return failures;
}

function printSummary(summary, failures) {
  console.log("OpenClaw Memory Fabric v2 Commit Smoke");
  console.log(`sidecar: ${summary.opts.baseUrl}`);
  console.log(`agent/project: ${summary.opts.agentId} / ${summary.opts.projectId}`);
  console.log(`mode: ${summary.mode}`);
  console.log(`runId: ${summary.runId}`);
  console.log(
    `commit: ok=${summary.commit?.ok} committed=${summary.commit?.committed} ` +
      `v2=${summary.commit?.v2?.status ?? "missing"} legacy=${summary.commit?.v2?.legacyStatus ?? "n/a"}`
  );
  console.log(
    `v2 candidates: related=${summary.relatedCandidates.length} sourceRefs=${summary.candidateSourceRefsOk ? "ok" : "missing"}`
  );
  console.log(
    `recall: v2=${summary.v2RecallContainsRunId ? "hit" : "miss"} legacy=${summary.legacyRecallContainsRunId ? "hit" : "miss"}`
  );
  if (summary.consolidation?.result) {
    const result = summary.consolidation.result;
    console.log(`consolidation: processed=${result.processed} promoted=${result.promoted} review=${result.needsReview}`);
  }

  if (failures.length > 0) {
    console.error("failures:");
    for (const failure of failures) console.error(`- ${failure}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const runId = `commit-smoke-${Date.now().toString(36)}`;
  const fact = `${runId} fact validates v2 commit sourceRefs`;
  const decision = `${runId} decision validates v2-write fallback`;

  const health = await request(opts.baseUrl, "GET", "/health");
  const grayQs = new URLSearchParams({ agentId: opts.agentId, projectId: opts.projectId });
  const grayBefore = await request(opts.baseUrl, "GET", `/v2/gray/status?${grayQs.toString()}`);
  const commit = await request(opts.baseUrl, "POST", "/commit", {
    agentId: opts.agentId,
    projectId: opts.projectId,
    facts: [fact],
    decisions: [decision],
    sessionSummary: `${runId} preflight commit`,
  });

  const mode = commit.v2?.mode ?? grayBefore.mode ?? "unknown";
  const expectV2 = mode !== "off";
  const candidatePoll = expectV2 ? await waitForCandidates(opts, runId) : { latest: [], related: [] };
  const candidateSourceRefsOk =
    candidatePoll.related.length > 0 && candidatePoll.related.every((candidate) => (candidate.sourceRefs ?? []).length > 0);

  const consolidation = expectV2
    ? await request(opts.baseUrl, "POST", "/v2/consolidation/run", {
        agentId: opts.agentId,
        projectId: opts.projectId,
        limit: 20,
      })
    : undefined;

  const v2Recall = expectV2
    ? await request(opts.baseUrl, "POST", "/v2/recall/plan", {
        agentId: opts.agentId,
        projectId: opts.projectId,
        query: runId,
        limit: 5,
      })
    : undefined;

  const legacyRecall = await request(opts.baseUrl, "POST", "/recall", {
    agentId: opts.agentId,
    projectId: opts.projectId,
    scope: "project",
    depth: "l1",
    query: runId,
  });

  const summary = {
    opts,
    runId,
    health,
    grayBefore,
    mode,
    commit,
    relatedCandidates: candidatePoll.related,
    candidateSourceRefsOk,
    consolidation,
    v2Recall,
    legacyRecall,
    v2RecallContainsRunId: expectV2 ? JSON.stringify(v2Recall).includes(runId) : false,
    legacyRecallContainsRunId: JSON.stringify(legacyRecall).includes(runId),
  };
  const failures = evaluate(summary);

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
