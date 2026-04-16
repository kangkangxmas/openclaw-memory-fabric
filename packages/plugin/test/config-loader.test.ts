import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, ConfigValidationError } from "../src/config/loader.js";

describe("loadConfig", () => {
  it("returns fully-merged default config when called with no args", () => {
    const cfg = loadConfig();
    assert.equal(cfg.defaultScope, "project");
    assert.ok(cfg.sidecar.baseUrl.startsWith("http"));
    assert.ok(cfg.sidecar.timeoutMs >= 1000);
    assert.equal(cfg.openviking.mode, "local");
    assert.ok(typeof cfg.graphify.autoBootstrap === "boolean");
    assert.equal(cfg.observability.logLevel, "info");
  });

  it("merges partial user overrides into defaults", () => {
    const cfg = loadConfig({
      defaultScope: "shared",
      sidecar: { baseUrl: "http://custom:9999" } as never
    });
    assert.equal(cfg.defaultScope, "shared");
    assert.equal(cfg.sidecar.baseUrl, "http://custom:9999");
    // timeoutMs from default preserved
    assert.ok(cfg.sidecar.timeoutMs >= 1000);
  });

  it("merges nested objects shallowly (sidecar, observability, etc.)", () => {
    const cfg = loadConfig({ observability: { logLevel: "debug" } as never });
    assert.equal(cfg.observability.logLevel, "debug");
    assert.equal(typeof cfg.observability.emitMetrics, "boolean");
  });

  it("throws ConfigValidationError for an invalid defaultScope", () => {
    assert.throws(
      () => loadConfig({ defaultScope: "universe" as never }),
      (err) => {
        assert.ok(err instanceof ConfigValidationError);
        assert.ok(err.validationErrors.length > 0);
        return true;
      }
    );
  });

  it("throws ConfigValidationError when sidecar.timeoutMs is below minimum", () => {
    assert.throws(
      () => loadConfig({ sidecar: { timeoutMs: 10 } as never }),
      (err) => {
        assert.ok(err instanceof ConfigValidationError);
        return true;
      }
    );
  });

  it("ConfigValidationError has a descriptive message and name", () => {
    try {
      loadConfig({ defaultScope: "bad" as never });
      assert.fail("expected throw");
    } catch (err) {
      assert.ok(err instanceof ConfigValidationError);
      assert.equal(err.name, "ConfigValidationError");
      assert.ok(err.message.includes("validation failed"));
    }
  });
});
