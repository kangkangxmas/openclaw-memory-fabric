import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { describe, it, expect, beforeEach, afterEach } from "./test-helpers.js";
import type { SidecarConfig } from "../src/config/index.js";
import type { RetrievalPlanner } from "../src/services/retrieval-planner.js";
import { MemoryBenchAlreadyRunningError, MemoryBenchRunner } from "../src/services/memory-bench-runner.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("MemoryBenchRunner", () => {
  let tmpRoot: string;
  let cfg: SidecarConfig["openviking"];

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "memory-bench-runner-"));
    cfg = {
      mode: "local",
      basePath: join(tmpRoot, "openviking"),
      targetRoot: "viking://org/test",
    };
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("persists complete reports but keeps partial reports from replacing latest", async () => {
    const planner = {
      async recall(input: { query: string }) {
        if (input.query === "slow") await wait(200);
        return {
          plan: {},
          entries: [],
          cards: [
            {
              id: `card-${input.query}`,
              memoryId: `mem-${input.query}`,
              title: input.query,
              content: `${input.query} alpha evidence`,
              confidence: 0.9,
              evidence: ["evt-alpha"],
            },
          ],
          rendered: "",
          executionTimeMs: 1,
        };
      },
    } as unknown as RetrievalPlanner;
    const runner = new MemoryBenchRunner(planner, cfg);

    const complete = await runner.run({
      cases: [{ id: "complete", query: "complete", expectedTerms: ["alpha"] }],
      caseTimeoutMs: 100,
      totalTimeoutMs: 1000,
    });
    expect(complete.status).toBe("complete");
    expect((await runner.latest())?.cases).toBe(1);

    const partial = await runner.run({
      cases: [
        { id: "timeout", query: "slow", expectedTerms: ["alpha"] },
        { id: "after-timeout", query: "after-timeout", expectedTerms: ["alpha"] },
      ],
      caseTimeoutMs: 5,
      totalTimeoutMs: 1000,
    });
    expect(partial.status).toBe("partial");
    expect(partial.timedOutCases).toBe(1);
    expect(partial.completedCases).toBe(2);

    const latest = await runner.latest();
    expect(latest?.status).toBe("complete");
    expect(latest?.cases).toBe(1);
    expect(latest?.results[0].id).toBe("complete");

    const diagnostic = await runner.run({ limit: 1 });
    expect(diagnostic.status).toBe("complete");
    expect((await runner.latest())?.results[0].id).toBe("complete");
  });

  it("exposes running status and rejects overlapping runs", async () => {
    const planner = {
      async recall() {
        await wait(200);
        return {
          plan: {},
          entries: [],
          cards: [],
          rendered: "",
          executionTimeMs: 50,
        };
      },
    } as unknown as RetrievalPlanner;
    const runner = new MemoryBenchRunner(planner, cfg);
    const running = runner.run({
      cases: [{ id: "slow", query: "slow", expectedTerms: ["missing"] }],
      caseTimeoutMs: 500,
      totalTimeoutMs: 1000,
    });
    await wait(0);

    const status = await runner.status();
    expect(status.state).toBe("running");
    expect(status.activeRun?.casesTotal).toBe(1);

    let overlapError: unknown;
    try {
      await runner.run({
        cases: [{ id: "second", query: "second", expectedTerms: ["missing"] }],
      });
    } catch (error) {
      overlapError = error;
    }
    expect(overlapError).toBeInstanceOf(MemoryBenchAlreadyRunningError);

    await running;
    expect((await runner.status()).state).toBe("idle");
  });
});
