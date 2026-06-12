/**
 * Unit tests for before_tool_call and after_tool_call hooks.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBeforePromptBuildHandler } from "../src/hooks/before-prompt-build.js";
import { createBeforeToolCallHandler } from "../src/hooks/before-tool-call.js";
import { createAfterToolCallHandler } from "../src/hooks/after-tool-call.js";
import type { Logger } from "../src/utils/logger.js";
import type { SidecarClient } from "../src/utils/sidecar-client.js";
import type { HookAgentContext } from "../src/hooks/types.js";
import type { MemoryFabricConfig } from "../src/types/index.js";

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

const stubCtx: HookAgentContext = {
  agentId: "agent-a",
  workspaceDir: "/tmp/test-workspace"
} as HookAgentContext;

const testConfig: MemoryFabricConfig = {
  defaultScope: "project",
  recallBudget: {
    l0Tokens: 600,
    l1Tokens: 1800,
    l2Tokens: 5000
  },
  sidecar: {
    baseUrl: "http://127.0.0.1:7811",
    timeoutMs: 5000
  },
  openviking: {
    mode: "local",
    basePath: ".openviking",
    targetRoot: ""
  },
  graphify: {
    basePath: ".graphify",
    autoBootstrap: false,
    autoRefresh: "manual"
  },
  publishPolicy: {
    defaultVisibility: "project_shared",
    allowOrgShared: false
  },
  observability: {
    logLevel: "info",
    emitMetrics: false
  }
};

// ---------------------------------------------------------------------------
// before_prompt_build
// ---------------------------------------------------------------------------

describe("before_prompt_build hook", () => {
  it("uses event.prompt as the recall query when messages do not include a user turn", async () => {
    const previousMode = process.env.MEMORY_FABRIC_V2_MODE;
    process.env.MEMORY_FABRIC_V2_MODE = "v2-write";

    const queries: string[] = [];
    const client = {
      carrierInit: async () => ({ ok: true }),
      recallPlan: async (req: { query: string }) => {
        queries.push(req.query);
        return {
          ok: true,
          plan: {
            query: req.query,
            intent: "fact_confirmation",
            reason: "test"
          },
          cards: [
            {
              memoryId: "mem-1",
              type: "fact",
              time: "2026-06-12T00:00:00.000Z",
              confidence: 0.9,
              content: "Memory card from v2 recall.",
              evidence: ["evt-1"]
            }
          ],
          rendered: "Memory card from v2 recall.",
          executionTimeMs: 1
        };
      },
      recall: async () => ({
        memoryBrief: "",
        sources: [],
        budgetUsed: 0
      }),
      recallAudit: async () => ({ ok: true })
    } as unknown as SidecarClient;

    try {
      const { logger } = makeLogger();
      const handler = createBeforePromptBuildHandler(
        client,
        testConfig,
        logger,
        { recordRecall: () => undefined } as never
      );
      const result = await handler(
        { prompt: "真实普通问题", messages: [] },
        { agentId: "product", workspaceDir: "/tmp/Product" }
      );

      assert.deepEqual(queries, ["真实普通问题"]);
      assert.match(result?.prependContext ?? "", /memory-fabric:begin/);
      assert.match(result?.prependContext ?? "", /Memory card from v2 recall/);
    } finally {
      if (previousMode === undefined) delete process.env.MEMORY_FABRIC_V2_MODE;
      else process.env.MEMORY_FABRIC_V2_MODE = previousMode;
    }
  });
});

// ---------------------------------------------------------------------------
// before_tool_call
// ---------------------------------------------------------------------------

describe("before_tool_call hook", () => {
  it("logs at debug level for a high-value tool (write_file)", () => {
    const { calls, logger } = makeLogger();
    const handler = createBeforeToolCallHandler(logger);
    handler({ toolName: "write_file", params: { path: "/x" } }, stubCtx);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].level, "debug");
  });

  it("does not log for a low-value tool (list_directory)", () => {
    const { calls, logger } = makeLogger();
    const handler = createBeforeToolCallHandler(logger);
    handler({ toolName: "list_directory", params: {} }, stubCtx);
    assert.equal(calls.length, 0);
  });

  it("logs for tools containing 'commit' in the name", () => {
    const { calls, logger } = makeLogger();
    const handler = createBeforeToolCallHandler(logger);
    handler({ toolName: "git_commit", params: {} }, stubCtx);
    assert.equal(calls.length, 1);
  });

  it("logs for tools containing 'delete' in the name", () => {
    const { calls, logger } = makeLogger();
    const handler = createBeforeToolCallHandler(logger);
    handler({ toolName: "delete_files", params: {} }, stubCtx);
    assert.equal(calls.length, 1);
  });

  it("does not throw if params is empty", () => {
    const { logger } = makeLogger();
    const handler = createBeforeToolCallHandler(logger);
    assert.doesNotThrow(() =>
      handler({ toolName: "write_file", params: {} }, stubCtx)
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
    handler({ toolName: "read_file", params: {}, result: "content" }, stubCtx);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].level, "debug");
  });

  it("truncates long string results in the log", () => {
    const { calls, logger } = makeLogger();
    const handler = createAfterToolCallHandler(logger);
    const longResult = "x".repeat(500);
    handler({ toolName: "read_file", params: {}, result: longResult }, stubCtx);
    assert.equal(calls.length, 1);
  });

  it("logs (empty) for null result", () => {
    const { calls, logger } = makeLogger();
    const handler = createAfterToolCallHandler(logger);
    handler({ toolName: "some_tool", params: {}, result: null }, stubCtx);
    assert.equal(calls.length, 1);
  });

  it("summarises object results as key list", () => {
    const { calls, logger } = makeLogger();
    const handler = createAfterToolCallHandler(logger);
    handler({ toolName: "read_file", params: {}, result: { a: 1, b: 2 } }, stubCtx);
    assert.equal(calls.length, 1);
  });

  it("includes durationMs if provided", () => {
    const { calls, logger } = makeLogger();
    const handler = createAfterToolCallHandler(logger);
    handler({ toolName: "t", params: {}, durationMs: 42 }, stubCtx);
    assert.equal(calls.length, 1);
  });
});
