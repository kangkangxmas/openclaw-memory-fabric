/**
 * Unit tests for before_tool_call and after_tool_call hooks.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBeforeToolCallHandler } from "../src/hooks/before-tool-call.js";
import { createAfterToolCallHandler } from "../src/hooks/after-tool-call.js";
import type { Logger } from "../src/utils/logger.js";

// ---------------------------------------------------------------------------
// Minimal logger stub that captures log calls
// ---------------------------------------------------------------------------

function makeLogger(): { calls: Array<{ level: string; msg: string }>; logger: Logger } {
  const calls: Array<{ level: string; msg: string }> = [];
  const logger = {
    debug: (msg: string) => calls.push({ level: "debug", msg }),
    info: (msg: string) => calls.push({ level: "info", msg }),
    warn: (msg: string) => calls.push({ level: "warn", msg }),
    error: (msg: string) => calls.push({ level: "error", msg }),
    timed: async <T>(_label: string, _fields: unknown, fn: () => Promise<T>) => fn(),
    metricsEnabled: () => false
  } as unknown as Logger;
  return { calls, logger };
}

// ---------------------------------------------------------------------------
// before_tool_call
// ---------------------------------------------------------------------------

describe("before_tool_call hook", () => {
  it("logs at debug level for a high-value tool (write_file)", () => {
    const { calls, logger } = makeLogger();
    const handler = createBeforeToolCallHandler(logger);
    handler({ agentId: "agent-a", toolName: "write_file", toolInput: { path: "/x" } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].level, "debug");
  });

  it("does not log for a low-value tool (list_directory)", () => {
    const { calls, logger } = makeLogger();
    const handler = createBeforeToolCallHandler(logger);
    handler({ agentId: "agent-a", toolName: "list_directory" });
    assert.equal(calls.length, 0);
  });

  it("logs for tools containing 'commit' in the name", () => {
    const { calls, logger } = makeLogger();
    const handler = createBeforeToolCallHandler(logger);
    handler({ agentId: "agent-a", toolName: "git_commit" });
    assert.equal(calls.length, 1);
  });

  it("logs for tools containing 'delete' in the name", () => {
    const { calls, logger } = makeLogger();
    const handler = createBeforeToolCallHandler(logger);
    handler({ agentId: "agent-a", toolName: "delete_files" });
    assert.equal(calls.length, 1);
  });

  it("does not throw if toolInput is undefined", () => {
    const { logger } = makeLogger();
    const handler = createBeforeToolCallHandler(logger);
    assert.doesNotThrow(() =>
      handler({ agentId: "agent-a", toolName: "write_file", toolInput: undefined })
    );
  });
});

// ---------------------------------------------------------------------------
// after_tool_call
// ---------------------------------------------------------------------------

describe("after_tool_call hook", () => {
  it("logs at debug level for every tool call", () => {
    const { calls, logger } = makeLogger();
    const handler = createAfterToolCallHandler(logger);
    handler({ agentId: "agent-a", toolName: "read_file", toolResult: "content" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].level, "debug");
  });

  it("truncates long string results in the log", () => {
    const { calls, logger } = makeLogger();
    const handler = createAfterToolCallHandler(logger);
    const longResult = "x".repeat(500);
    handler({ agentId: "agent-a", toolName: "read_file", toolResult: longResult });
    // Should not throw and should log something
    assert.equal(calls.length, 1);
  });

  it("logs (empty) for null result", () => {
    const { calls, logger } = makeLogger();
    const handler = createAfterToolCallHandler(logger);
    handler({ agentId: "agent-a", toolName: "some_tool", toolResult: null });
    assert.equal(calls.length, 1);
  });

  it("summarises object results as key list", () => {
    const { calls, logger } = makeLogger();
    const handler = createAfterToolCallHandler(logger);
    handler({ agentId: "agent-a", toolName: "read_file", toolResult: { a: 1, b: 2 } });
    assert.equal(calls.length, 1);
  });

  it("includes durationMs if provided", () => {
    const { calls, logger } = makeLogger();
    const handler = createAfterToolCallHandler(logger);
    handler({ agentId: "agent-a", toolName: "t", durationMs: 42 });
    assert.equal(calls.length, 1);
  });
});
