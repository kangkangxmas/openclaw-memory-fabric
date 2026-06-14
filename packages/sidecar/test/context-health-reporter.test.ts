import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "./test-helpers.js";
import { ContextHealthReporter } from "../src/services/context-health-reporter.js";

describe("ContextHealthReporter", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `context-health-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reports compaction log signals and oversized active files", async () => {
    await mkdir(join(tmpDir, "logs"), { recursive: true });
    await mkdir(join(tmpDir, "agents", "product"), { recursive: true });
    await mkdir(join(tmpDir, "archives", "old"), { recursive: true });
    await writeFile(
      join(tmpDir, "logs", "gateway.log"),
      [
        "context overflow before compaction",
        "timeout during compaction",
        "already_compacted_recently",
        "Freshness: stale | Core entities: stale should not be detailed",
        "graphify:brief:stale-skipped",
      ].join("\n")
    );
    await writeFile(join(tmpDir, "agents", "product", "session.jsonl"), "x".repeat(12));
    await writeFile(join(tmpDir, "agents", "product", "session.trajectory.jsonl"), "y".repeat(14));
    await writeFile(join(tmpDir, "archives", "old", "archived.trajectory.jsonl"), "z".repeat(20));

    const reporter = new ContextHealthReporter({
      openclawRoot: tmpDir,
      activeTranscriptMaxBytes: 10,
      trajectoryArchiveBytes: 10,
      logPathGroups: [[join(tmpDir, "logs", "gateway.log")]],
    });
    const report = await reporter.report();

    expect(report.files.sessionCount).toBe(1);
    expect(report.files.activeTranscriptWarnings).toHaveLength(1);
    expect(report.files.trajectoryArchiveCandidates).toHaveLength(1);
    expect(report.compaction.overflowCount).toBe(1);
    expect(report.compaction.timeoutCount).toBe(1);
    expect(report.compaction.alreadyCompactedRecentlyCount).toBe(1);
    expect(report.compaction.staleBriefDetailedInjectionCount).toBe(1);
    expect(report.compaction.staleBriefSkippedCount).toBe(1);
    expect(report.warnings.length).toBeGreaterThanOrEqual(4);
  });

  it("ignores stale legacy gateway logs when no current log source exists", async () => {
    await mkdir(join(tmpDir, "logs"), { recursive: true });
    const oldLog = join(tmpDir, "logs", "gateway.log");
    await writeFile(oldLog, "Freshness: stale | Core entities: stale should not be detailed");
    const oldDate = new Date("2026-01-01T00:00:00Z");
    await utimes(oldLog, oldDate, oldDate);

    const reporter = new ContextHealthReporter({
      openclawRoot: tmpDir,
      logPathGroups: [[oldLog]],
      logMaxAgeMs: 60_000,
      now: () => new Date("2026-01-02T00:00:00Z"),
    });
    const report = await reporter.report();

    expect(report.compaction.staleBriefDetailedInjectionCount).toBe(0);
    expect(report.warnings).not.toContain("1 stale Graphify detailed injection matches found");
  });

  it("prefers the first recent gateway log group and avoids duplicate counts", async () => {
    const primary = join(tmpDir, "primary.log");
    const secondary = join(tmpDir, "secondary.log");
    await writeFile(primary, "timeout during compaction");
    await writeFile(secondary, "timeout during compaction");

    const reporter = new ContextHealthReporter({
      openclawRoot: tmpDir,
      logPathGroups: [[primary], [secondary]],
      now: () => new Date(),
    });
    const report = await reporter.report();

    expect(report.compaction.timeoutCount).toBe(1);
  });

  it("skips archived files for active warning thresholds", async () => {
    await mkdir(join(tmpDir, "session-backups", "old"), { recursive: true });
    await writeFile(join(tmpDir, "session-backups", "old", "large.jsonl"), "x".repeat(50));
    const reporter = new ContextHealthReporter({
      openclawRoot: tmpDir,
      activeTranscriptMaxBytes: 10,
      trajectoryArchiveBytes: 10,
      logPathGroups: [[]],
    });
    const report = await reporter.report();
    expect(report.files.sessionCount).toBe(1);
    expect(report.files.maxTranscriptBytes).toBe(0);
    expect(report.files.activeTranscriptWarnings).toHaveLength(0);
  });
});
