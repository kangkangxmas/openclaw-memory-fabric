import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DistillService } from "../src/services/distill-service.js";

const svc = new DistillService();

function msg(role: string, content: string) {
  return { role, content };
}

describe("DistillService.distill()", () => {
  it("returns empty arrays for an empty messages array", () => {
    const out = svc.distill({ messages: [] });
    assert.deepEqual(out.facts, []);
    assert.deepEqual(out.decisions, []);
    assert.deepEqual(out.entities, []);
    assert.deepEqual(out.patterns, []);
    assert.deepEqual(out.unresolved, []);
    assert.deepEqual(out.publishCandidates, []);
  });

  it("ignores user messages — only processes assistant role", () => {
    const out = svc.distill({
      messages: [
        msg("user", "We decided to use Redis for caching."),
        msg("assistant", "Acknowledged.")
      ]
    });
    // "Acknowledged." is too short (<15 chars) to pattern-match, so decisions should be empty
    assert.deepEqual(out.decisions, []);
  });

  it("extracts decisions from assistant messages", () => {
    const out = svc.distill({
      messages: [
        msg("assistant", "After analysis, we decided to use JSONL format for persistent storage.")
      ]
    });
    assert.ok(out.decisions.length >= 1);
    assert.ok(out.decisions[0].toLowerCase().includes("jsonl"));
  });

  it("extracts entities (CamelCase service names)", () => {
    const out = svc.distill({
      messages: [
        msg(
          "assistant",
          "The CarrierRepository and DistillService are used to manage memory storage."
        )
      ]
    });
    assert.ok(out.entities.includes("CarrierRepository"));
    assert.ok(out.entities.includes("DistillService"));
  });

  it("filters generic entities and noisy quoted fragments", () => {
    const out = svc.distill({
      messages: [
        msg(
          "assistant",
          'User and Agent reviewed the result. 「你应该在这些时机执行蒸馏」 and 「AI 员工」 are instructions, while "NodeNext" is the real config token. No memories found.'
        )
      ]
    });
    assert.ok(!out.entities.includes("User"));
    assert.ok(!out.entities.includes("Agent"));
    assert.ok(!out.entities.includes("你应该在这些时机执行蒸馏"));
    assert.ok(!out.entities.includes("AI 员工"));
    assert.ok(!out.entities.includes("No memories found"));
    assert.ok(out.entities.includes("NodeNext"));
  });

  it("filters low-signal decision fragments while keeping substantive decisions", () => {
    const out = svc.distill({
      messages: [
        msg(
          "assistant",
          "Decision: scope 和 depth：. After analysis, we decided to use JSONL format for persistent storage across the sidecar and plugin."
        )
      ]
    });
    assert.ok(!out.decisions.includes("scope 和 depth："));
    assert.ok(out.decisions.some((decision) => decision.toLowerCase().includes("jsonl")));
  });

  it("filters truncated markdown and token-only decisions", () => {
    const out = svc.distill({
      messages: [
        msg(
          "assistant",
          '选择 `minimax/MiniMax-M2`。** 既然重启 Gateway 后我当前这个会话就断了，不如：。已决定保留现有 Gateway 配置，并只修正 launchd 环境变量注入。'
        )
      ]
    });
    assert.ok(!out.decisions.includes("minimax/MiniMax-M2"));
    assert.ok(!out.decisions.some((decision) => decision.includes("不如")));
    assert.ok(out.decisions.some((decision) => decision.includes("launchd")));
  });

  it("extracts unresolved items", () => {
    const out = svc.distill({
      messages: [
        msg("assistant", "待确认：是否需要将 GraphifyService 替换为外部搜索引擎还是保留本地实现。")
      ]
    });
    assert.ok(out.unresolved.length >= 1);
  });

  it("deduplicates repeated entities", () => {
    const repeated = "The CarrierRepository is responsible. CarrierRepository handles all merges.";
    const out = svc.distill({
      messages: [msg("assistant", repeated)]
    });
    const count = out.entities.filter((e) => e === "CarrierRepository").length;
    assert.equal(count, 1);
  });

  it("caps decisions at 10", () => {
    const lines = Array.from(
      { length: 20 },
      (_, i) => `We decided to adopt approach-${i} for module-${i} integration.`
    ).join(" ");
    const out = svc.distill({ messages: [msg("assistant", lines)] });
    assert.ok(out.decisions.length <= 10);
  });

  it("caps entities at 20", () => {
    const names = Array.from({ length: 30 }, (_, i) => `SomeService${i}`).join(" and ");
    const out = svc.distill({ messages: [msg("assistant", names)] });
    assert.ok(out.entities.length <= 20);
  });

  it("publishCandidates contains decisions and unresolved (up to 4)", () => {
    const out = svc.distill({
      messages: [
        msg(
          "assistant",
          "We decided to switch to NodeNext moduleResolution for all packages.\n待确认：Is the sidecar port 7811 final?"
        )
      ]
    });
    assert.ok(out.publishCandidates.length >= 1);
    assert.ok(out.publishCandidates.length <= 4);
  });
});
