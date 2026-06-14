import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { SidecarConfig } from "../config/index.js";
import { appendJsonl, ensureFileDir } from "../utils/jsonl.js";
import { resolveV2BaseDir } from "../utils/v2-paths.js";
import type { RetrievalPlanner } from "./retrieval-planner.js";

export interface MemoryBenchCase {
  id: string;
  query: string;
  expectedTerms: string[];
  agentId?: string;
  projectId?: string;
}

export interface MemoryBenchRunOptions {
  cases?: MemoryBenchCase[];
  agentId?: string;
  projectId?: string;
  limit?: number;
  useFixtures?: boolean;
  caseTimeoutMs?: number;
  totalTimeoutMs?: number;
  persist?: boolean;
}

export interface MemoryBenchFixtureSet {
  source: "persisted" | "empty";
  cases: MemoryBenchCase[];
  count: number;
}

export interface MemoryBenchFixtureWriteOptions {
  cases: MemoryBenchCase[];
  mode?: "replace" | "append";
}

export interface MemoryBenchReport {
  generatedAt: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: "complete" | "partial" | "failed";
  cases: number;
  completedCases: number;
  timedOutCases: number;
  errorCount: number;
  recallAt5: number;
  injectionPrecision: number;
  staleRate: number;
  sourceCoverage: number;
  avgCardChars: number;
  p95LatencyMs: number;
  errors: Array<{
    id: string;
    message: string;
  }>;
  results: Array<{
    id: string;
    hit: boolean;
    cardCount: number;
    latencyMs: number;
    status: "pass" | "miss" | "timeout" | "error";
    error?: string;
  }>;
}

export interface MemoryBenchActiveRun {
  runId: string;
  state: "running";
  startedAt: string;
  casesTotal: number;
  casesCompleted: number;
  caseTimeoutMs: number;
  totalTimeoutMs: number;
  lastCaseId?: string;
}

export interface MemoryBenchReportSummary {
  generatedAt: string;
  status: MemoryBenchReport["status"];
  cases: number;
  completedCases: number;
  recallAt5: number;
  injectionPrecision: number;
  sourceCoverage: number;
  p95LatencyMs: number;
}

export interface MemoryBenchStatus {
  state: "idle" | "running";
  activeRun?: MemoryBenchActiveRun;
  latestReport: MemoryBenchReportSummary | null;
}

export class MemoryBenchAlreadyRunningError extends Error {
  constructor(readonly activeRun: MemoryBenchActiveRun) {
    super("Memory Bench is already running");
    this.name = "MemoryBenchAlreadyRunningError";
  }
}

export const DEFAULT_MEMORY_BENCH_CASES: MemoryBenchCase[] = [
  {
    id: "decision-hy-memory-route",
    query: "为什么 Memory Fabric v2 不直接接入 Hy-Memory",
    expectedTerms: ["Hy-Memory", "自研", "运行时依赖"],
  },
  {
    id: "rule-source-refs",
    query: "稳定记忆写入需要什么证据",
    expectedTerms: ["source", "evidence", "证据"],
  },
  {
    id: "task-continuation",
    query: "继续上次 Memory Fabric v2 改造任务",
    expectedTerms: ["v2", "下一步", "任务"],
  },
  {
    id: "baseline-sidecar-test-runner",
    query: "sidecar 测试基线为什么要从 bun:test 统一到 node:test",
    expectedTerms: ["node:test", "bun:test", "测试"],
  },
  {
    id: "baseline-openviking-mode",
    query: "测试配置里的 openviking.mode 应该是什么",
    expectedTerms: ["openviking", "mode", "local"],
  },
  {
    id: "source-required-gate",
    query: "没有 sourceRefs 的候选记忆应该进入哪里",
    expectedTerms: ["sourceRefs", "pending", "review"],
  },
  {
    id: "l0-event-ledger",
    query: "L0 事件账本需要记录哪些字段",
    expectedTerms: ["event_id", "content_hash", "source_uri"],
  },
  {
    id: "candidate-pending-queue",
    query: "System 1 写入为什么先进入 pending queue",
    expectedTerms: ["pending", "候选", "低置信"],
  },
  {
    id: "consolidation-supersedes",
    query: "旧事实被新事实覆盖时如何处理 supersedes 和 validUntil",
    expectedTerms: ["supersedes", "validUntil", "覆盖"],
  },
  {
    id: "quality-score",
    query: "稳定记忆质量评分包含哪些维度",
    expectedTerms: ["specificity", "actionability", "sourceCoverage"],
  },
  {
    id: "profile-write-gate",
    query: "L3 profile 和 L5 intent 写入需要什么条件",
    expectedTerms: ["用户指令", "高质量证据", "profile"],
  },
  {
    id: "retrieval-fact-lookup",
    query: "确认当前项目的配置路径和命令应该走什么检索意图",
    expectedTerms: ["fact", "lookup", "配置"],
  },
  {
    id: "retrieval-decision-history",
    query: "为什么选择 shadow 双写再切主",
    expectedTerms: ["decision", "shadow", "回滚"],
  },
  {
    id: "retrieval-task-continuation",
    query: "继续上次任务时应该优先注入哪些记忆层",
    expectedTerms: ["episode", "todo", "decision"],
  },
  {
    id: "retrieval-rule-execution",
    query: "执行项目规则和红线时应该检索哪些记忆",
    expectedTerms: ["intent", "preference", "lesson"],
  },
  {
    id: "retrieval-entity-relation",
    query: "查询实体关系时 Graphify 应该提供什么",
    expectedTerms: ["entity", "Graphify", "关系"],
  },
  {
    id: "hybrid-rrf-ranking",
    query: "Hybrid RRF 融合哪些检索信号",
    expectedTerms: ["关键词", "向量", "Graphify"],
  },
  {
    id: "memory-card-size",
    query: "Memory Card 的大小和内容要求是什么",
    expectedTerms: ["80", "160", "证据"],
  },
  {
    id: "before-prompt-cards-only",
    query: "before_prompt_build 为什么只注入 memory cards",
    expectedTerms: ["before_prompt_build", "memory cards", "Carrier"],
  },
  {
    id: "carrier-projection-role",
    query: "Carrier 在 v2 中是什么角色",
    expectedTerms: ["Markdown", "投影", "事实源"],
  },
  {
    id: "carrier-self-model-ownership",
    query: "self-model.md 只应该接收哪些内容",
    expectedTerms: ["L3", "L5", "高置信"],
  },
  {
    id: "carrier-decision-log-ownership",
    query: "decision-log.md 应该接收哪类记忆",
    expectedTerms: ["decision", "L1", "投影"],
  },
  {
    id: "carrier-execution-journal-ownership",
    query: "execution-journal.md 应该接收哪类记忆",
    expectedTerms: ["episode", "L2", "journal"],
  },
  {
    id: "carrier-entities-glossary-ownership",
    query: "entities-glossary.md 应该接收哪类记忆",
    expectedTerms: ["entity", "Graphify", "glossary"],
  },
  {
    id: "carrier-drift-audit",
    query: "如何发现结构化记忆和 Carrier 投影漂移",
    expectedTerms: ["drift", "Carrier", "projection"],
  },
  {
    id: "graphify-relationship-types",
    query: "Graphify v2 关系图支持哪些关系",
    expectedTerms: ["DECIDES", "SUPERSEDES", "VALIDATES"],
  },
  {
    id: "inspector-source-trace",
    query: "Inspector Source Trace 应该展示什么",
    expectedTerms: ["Source Trace", "sourceRefs", "event"],
  },
  {
    id: "inspector-conflict-center",
    query: "Inspector Conflict Center 用来处理什么",
    expectedTerms: ["Conflict", "supersedes", "冲突"],
  },
  {
    id: "gray-development-agent",
    query: "v2 灰度应该先作用于哪个 Agent",
    expectedTerms: ["development", "shadow", "v2-write"],
  },
  {
    id: "legacy-recall-fallback",
    query: "切主前哪些旧链路必须保留回退",
    expectedTerms: ["/recall", "/commit", "Carrier"],
  },
  {
    id: "bench-acceptance-recall",
    query: "Memory Bench Recall@5 目标是多少",
    expectedTerms: ["Recall@5", "0.85", "Bench"],
  },
  {
    id: "bench-acceptance-latency",
    query: "实时检索 P95 latency 目标是多少",
    expectedTerms: ["P95", "300ms", "latency"],
  },
];

const DEFAULT_CASE_TIMEOUT_MS = 5_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 100;
const MAX_CASE_TIMEOUT_MS = 60_000;
const MAX_TOTAL_TIMEOUT_MS = 300_000;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export class MemoryBenchRunner {
  private readonly latestPath?: string;
  private readonly historyPath?: string;
  private readonly fixturesPath?: string;
  private activeRun?: MemoryBenchActiveRun;

  constructor(
    private readonly planner: RetrievalPlanner,
    cfg?: SidecarConfig["openviking"]
  ) {
    if (cfg) {
      const root = join(resolveV2BaseDir(cfg), "bench");
      this.latestPath = join(root, "latest-report.json");
      this.historyPath = join(root, "reports.jsonl");
      this.fixturesPath = join(root, "fixtures.json");
    }
  }

  async run(input: MemoryBenchCase[] | MemoryBenchRunOptions = DEFAULT_MEMORY_BENCH_CASES): Promise<MemoryBenchReport> {
    if (this.activeRun) throw new MemoryBenchAlreadyRunningError(this.activeRun);

    const cases = await this.resolveCases(input);
    const controls = resolveRunControls(input);
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const deadlineMs = startedMs + controls.totalTimeoutMs;
    const activeRun: MemoryBenchActiveRun = {
      runId: `bench_${startedMs}_${Math.random().toString(36).slice(2, 8)}`,
      state: "running",
      startedAt,
      casesTotal: cases.length,
      casesCompleted: 0,
      caseTimeoutMs: controls.caseTimeoutMs,
      totalTimeoutMs: controls.totalTimeoutMs,
    };
    this.activeRun = activeRun;

    const results: MemoryBenchReport["results"] = [];
    const errors: MemoryBenchReport["errors"] = [];
    let hits = 0;
    let usefulCards = 0;
    let totalCards = 0;
    let staleCards = 0;
    let cardsWithSources = 0;
    let totalCardChars = 0;
    let timedOutCases = 0;
    const latencies: number[] = [];

    try {
      for (const benchCase of cases) {
        if (Date.now() >= deadlineMs) {
          errors.push({ id: benchCase.id, message: `bench run exceeded total timeout ${controls.totalTimeoutMs}ms` });
          break;
        }

        activeRun.lastCaseId = benchCase.id;
        const remainingMs = Math.max(MIN_TIMEOUT_MS, deadlineMs - Date.now());
        const caseTimeoutMs = Math.min(controls.caseTimeoutMs, remainingMs);
        const outcome = await this.runCase(benchCase, caseTimeoutMs);
        activeRun.casesCompleted++;
        results.push(outcome.result);
        latencies.push(outcome.result.latencyMs);

        if (outcome.result.status === "timeout") timedOutCases++;
        if (outcome.result.error) errors.push({ id: benchCase.id, message: outcome.result.error });
        if (!outcome.recall) continue;

        if (outcome.result.hit) hits++;
        for (const card of outcome.recall.cards) {
          totalCards++;
          totalCardChars += card.content.length;
          if (benchCase.expectedTerms.some((term) => card.content.toLowerCase().includes(term.toLowerCase()))) {
            usefulCards++;
          }
          if (card.conflict) staleCards++;
          if (card.evidence.length > 0) cardsWithSources++;
        }
      }
    } finally {
      if (this.activeRun?.runId === activeRun.runId) this.activeRun = undefined;
    }

    const completedAt = new Date().toISOString();
    const status = results.length === cases.length && errors.length === 0 ? "complete" : results.length > 0 ? "partial" : "failed";
    const report: MemoryBenchReport = {
      generatedAt: completedAt,
      startedAt,
      completedAt,
      durationMs: Date.now() - startedMs,
      status,
      cases: cases.length,
      completedCases: results.length,
      timedOutCases,
      errorCount: errors.length,
      recallAt5: cases.length > 0 ? hits / cases.length : 0,
      injectionPrecision: totalCards > 0 ? usefulCards / totalCards : 0,
      staleRate: totalCards > 0 ? staleCards / totalCards : 0,
      sourceCoverage: totalCards > 0 ? cardsWithSources / totalCards : 0,
      avgCardChars: totalCards > 0 ? totalCardChars / totalCards : 0,
      p95LatencyMs: percentile(latencies, 0.95),
      errors,
      results,
    };
    if (report.status === "complete" && report.cases > 0 && shouldPersistReport(input)) await this.persist(report);
    return report;
  }

  async latest(): Promise<MemoryBenchReport | null> {
    if (!this.latestPath || !existsSync(this.latestPath)) return null;
    return JSON.parse(await readFile(this.latestPath, "utf8")) as MemoryBenchReport;
  }

  async status(): Promise<MemoryBenchStatus> {
    return {
      state: this.activeRun ? "running" : "idle",
      activeRun: this.activeRun,
      latestReport: summarizeReport(await this.latest()),
    };
  }

  async fixtures(): Promise<MemoryBenchFixtureSet> {
    const cases = await this.loadPersistedFixtures();
    return { source: cases.length > 0 ? "persisted" : "empty", cases, count: cases.length };
  }

  async saveFixtures(opts: MemoryBenchFixtureWriteOptions): Promise<MemoryBenchFixtureSet> {
    if (!this.fixturesPath) {
      return { source: "empty", cases: [], count: 0 };
    }
    const incoming = opts.cases.map((item) => normalizeCase(item)).filter((item) => item.id && item.query);
    const existing = opts.mode === "append" ? await this.loadPersistedFixtures() : [];
    const byId = new Map<string, MemoryBenchCase>();
    for (const item of existing) byId.set(item.id, item);
    for (const item of incoming) byId.set(item.id, item);
    const cases = [...byId.values()];
    await ensureFileDir(this.fixturesPath);
    await writeFile(this.fixturesPath, JSON.stringify({ version: 1, cases }, null, 2), "utf8");
    return { source: "persisted", cases, count: cases.length };
  }

  private async persist(report: MemoryBenchReport): Promise<void> {
    if (!this.latestPath || !this.historyPath) return;
    await ensureFileDir(this.latestPath);
    await writeFile(this.latestPath, JSON.stringify(report, null, 2), "utf8");
    await appendJsonl(this.historyPath, report);
  }

  private async runCase(benchCase: MemoryBenchCase, timeoutMs: number): Promise<{
    result: MemoryBenchReport["results"][number];
    recall?: Awaited<ReturnType<RetrievalPlanner["recall"]>>;
  }> {
    const started = Date.now();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeout = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const recallPromise = this.planner
      .recall({
        query: benchCase.query,
        agentId: benchCase.agentId,
        projectId: benchCase.projectId,
        limit: 5,
      })
      .then((recall) => ({ recall }))
      .catch((error: unknown) => ({ error }));

    const outcome = await Promise.race([recallPromise, timeoutPromise]);
    if (timeout) clearTimeout(timeout);
    const latencyMs = Date.now() - started;

    if (outcome === "timeout") {
      return {
        result: {
          id: benchCase.id,
          hit: false,
          cardCount: 0,
          latencyMs,
          status: "timeout",
          error: `case timed out after ${timeoutMs}ms`,
        },
      };
    }

    if ("error" in outcome) {
      const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      return {
        result: {
          id: benchCase.id,
          hit: false,
          cardCount: 0,
          latencyMs,
          status: "error",
          error: message,
        },
      };
    }

    const haystack = outcome.recall.cards.map((card) => card.content).join("\n").toLowerCase();
    const hit = benchCase.expectedTerms.some((term) => haystack.includes(term.toLowerCase()));
    return {
      recall: outcome.recall,
      result: {
        id: benchCase.id,
        hit,
        cardCount: outcome.recall.cards.length,
        latencyMs,
        status: hit ? "pass" : "miss",
      },
    };
  }

  private async resolveCases(input: MemoryBenchCase[] | MemoryBenchRunOptions): Promise<MemoryBenchCase[]> {
    if (Array.isArray(input)) {
      return applyRunScope(input, {});
    }
    const base = input.cases ?? (input.useFixtures ? await this.loadPersistedFixtures() : DEFAULT_MEMORY_BENCH_CASES);
    return applyRunScope(base, input);
  }

  private async loadPersistedFixtures(): Promise<MemoryBenchCase[]> {
    if (!this.fixturesPath || !existsSync(this.fixturesPath)) return [];
    const raw = JSON.parse(await readFile(this.fixturesPath, "utf8")) as { cases?: MemoryBenchCase[] } | MemoryBenchCase[];
    const cases = Array.isArray(raw) ? raw : raw.cases ?? [];
    return cases.map((item) => normalizeCase(item)).filter((item) => item.id && item.query);
  }
}

function clampTimeout(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(MIN_TIMEOUT_MS, Math.min(Math.floor(value!), max));
}

function resolveRunControls(input: MemoryBenchCase[] | MemoryBenchRunOptions): { caseTimeoutMs: number; totalTimeoutMs: number } {
  if (Array.isArray(input)) {
    return { caseTimeoutMs: DEFAULT_CASE_TIMEOUT_MS, totalTimeoutMs: DEFAULT_TOTAL_TIMEOUT_MS };
  }
  return {
    caseTimeoutMs: clampTimeout(input.caseTimeoutMs, DEFAULT_CASE_TIMEOUT_MS, MAX_CASE_TIMEOUT_MS),
    totalTimeoutMs: clampTimeout(input.totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS, MAX_TOTAL_TIMEOUT_MS),
  };
}

function shouldPersistReport(input: MemoryBenchCase[] | MemoryBenchRunOptions): boolean {
  if (Array.isArray(input)) return true;
  if (input.persist !== undefined) return input.persist;
  return Boolean(input.useFixtures || input.cases?.length);
}

function summarizeReport(report: MemoryBenchReport | null): MemoryBenchReportSummary | null {
  if (!report) return null;
  return {
    generatedAt: report.generatedAt,
    status: report.status ?? "complete",
    cases: report.cases,
    completedCases: report.completedCases ?? report.cases,
    recallAt5: report.recallAt5,
    injectionPrecision: report.injectionPrecision,
    sourceCoverage: report.sourceCoverage,
    p95LatencyMs: report.p95LatencyMs,
  };
}

function normalizeCase(item: MemoryBenchCase): MemoryBenchCase {
  return {
    id: item.id,
    query: item.query,
    expectedTerms: Array.isArray(item.expectedTerms) ? item.expectedTerms.filter(Boolean) : [],
    agentId: item.agentId,
    projectId: item.projectId,
  };
}

function applyRunScope(cases: MemoryBenchCase[], opts: Pick<MemoryBenchRunOptions, "agentId" | "projectId" | "limit">): MemoryBenchCase[] {
  const limit = Math.max(0, Math.min(opts.limit ?? cases.length, 500));
  return cases.slice(0, limit).map((item) => ({
    ...normalizeCase(item),
    agentId: opts.agentId ?? item.agentId,
    projectId: opts.projectId ?? item.projectId,
  }));
}
