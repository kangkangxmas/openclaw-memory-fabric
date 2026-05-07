import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ScoringService } from "../src/services/scoring-service.js";

describe("ScoringService.score()", () => {
  it("returns heuristic score when no LLM", async () => {
    const svc = new ScoringService();
    const result = await svc.score({
      success: true,
      toolCount: 3,
      turnCount: 6
    });

    assert.ok(result.selfScore >= 0 && result.selfScore <= 100);
    assert.ok(result.scoreRationale.includes("Heuristic"));
  });

  it("returns lower score for failed sessions", async () => {
    const svc = new ScoringService();
    const success = await svc.score({
      success: true,
      toolCount: 3,
      turnCount: 6
    });
    const failure = await svc.score({
      success: false,
      toolCount: 3,
      turnCount: 6
    });

    assert.ok(failure.selfScore < success.selfScore);
  });

  it("penalizes excessive tool usage", async () => {
    const svc = new ScoringService();
    const normal = await svc.score({
      success: true,
      toolCount: 3,
      turnCount: 10
    });
    const excessive = await svc.score({
      success: true,
      toolCount: 9,
      turnCount: 10
    });

    assert.ok(excessive.selfScore <= normal.selfScore);
  });
});

describe("ScoringService.generateReport()", () => {
  it("aggregates by taskType", () => {
    const svc = new ScoringService();
    const entries = [
      { taskType: "development", selfScore: 80, success: true, timestamp: 1 },
      { taskType: "development", selfScore: 90, success: true, timestamp: 2 },
      { taskType: "ops", selfScore: 70, success: false, timestamp: 3 }
    ];

    const reports = svc.generateReport(entries);
    assert.equal(reports.length, 2);

    const dev = reports.find((r) => r.taskType === "development");
    assert.ok(dev);
    assert.equal(dev!.totalEntries, 2);
    assert.equal(dev!.avgScore, 85);
  });

  it("detects upward trend", () => {
    const svc = new ScoringService();
    const entries = [
      { taskType: "dev", selfScore: 50, success: false, timestamp: 1 },
      { taskType: "dev", selfScore: 50, success: false, timestamp: 2 },
      { taskType: "dev", selfScore: 90, success: true, timestamp: 3 },
      { taskType: "dev", selfScore: 95, success: true, timestamp: 4 }
    ];

    const reports = svc.generateReport(entries);
    assert.equal(reports[0].trend, "up");
  });
});
