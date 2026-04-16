/**
 * Unit tests for utils/path-guard.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateId, validatePath } from "../src/utils/path-guard.js";

// ---------------------------------------------------------------------------
// validateId
// ---------------------------------------------------------------------------

describe("validateId", () => {
  it("accepts a valid lowercase-kebab id", () => {
    assert.doesNotThrow(() => validateId("my-agent-01", "agentId"));
  });

  it("accepts a simple alphanumeric id", () => {
    assert.doesNotThrow(() => validateId("agentABC123", "agentId"));
  });

  it("throws on empty string", () => {
    assert.throws(() => validateId("", "agentId"), /must not be empty/);
  });

  it("throws on whitespace-only string", () => {
    assert.throws(() => validateId("   ", "agentId"), /must not be empty/);
  });

  it("throws when id contains forward slash", () => {
    assert.throws(() => validateId("agent/evil", "agentId"), /illegal characters/);
  });

  it("throws when id contains backslash", () => {
    assert.throws(() => validateId("agent\\evil", "agentId"), /illegal characters/);
  });

  it("throws when id contains ..", () => {
    assert.throws(() => validateId("../escape", "agentId"), /illegal characters/);
  });

  it("error message includes the label", () => {
    try {
      validateId("", "projectId");
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("projectId"));
    }
  });
});

// ---------------------------------------------------------------------------
// validatePath
// ---------------------------------------------------------------------------

describe("validatePath", () => {
  it("accepts an input that stays within the allowed root", () => {
    const result = validatePath("subdir/file.txt", "/allowed/root");
    assert.ok(result.startsWith("/allowed/root/"));
  });

  it("accepts the root itself (empty segment)", () => {
    assert.doesNotThrow(() => validatePath(".", "/allowed/root"));
  });

  it("throws when .. traversal escapes the root", () => {
    assert.throws(
      () => validatePath("../../etc/passwd", "/allowed/root"),
      /Path traversal detected/
    );
  });

  it("thrown error message includes the offending input path", () => {
    try {
      validatePath("../outside", "/some/root");
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("../outside"));
    }
  });
});
