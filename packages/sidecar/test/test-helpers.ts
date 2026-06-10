import assert from "node:assert/strict";
import {
  after as nodeAfter,
  afterEach as nodeAfterEach,
  before as nodeBefore,
  beforeEach as nodeBeforeEach,
  describe as nodeDescribe,
  it as nodeIt,
} from "node:test";

type Expectation = {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeDefined(): void;
  toBeUndefined(): void;
  toBeNull(): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
  toContain(expected: unknown): void;
  toHaveLength(expected: number): void;
  toHaveProperty(expected: string): void;
  toBeInstanceOf(expected: Function): void;
  toMatch(expected: RegExp): void;
  toThrow(expected?: string | RegExp): void;
  not: Expectation;
};

function hasLength(value: unknown): value is { length: number } {
  return typeof value === "object" && value !== null && "length" in value;
}

function contains(received: unknown, expected: unknown): boolean {
  if (typeof received === "string") return received.includes(String(expected));
  if (Array.isArray(received)) return received.includes(expected);
  return false;
}

function buildExpectation(received: unknown, negated = false): Expectation {
  const check = (ok: boolean, message: string): void => {
    if (negated) assert.ok(!ok, `not.${message}`);
    else assert.ok(ok, message);
  };

  const api: Omit<Expectation, "not"> = {
    toBe(expected: unknown) {
      check(Object.is(received, expected), `expected ${String(received)} to be ${String(expected)}`);
    },
    toEqual(expected: unknown) {
      if (negated) assert.notDeepEqual(received, expected);
      else assert.deepEqual(received, expected);
    },
    toBeDefined() {
      check(received !== undefined, "expected value to be defined");
    },
    toBeUndefined() {
      check(received === undefined, "expected value to be undefined");
    },
    toBeNull() {
      check(received === null, "expected value to be null");
    },
    toBeGreaterThan(expected: number) {
      check(Number(received) > expected, `expected ${String(received)} to be > ${expected}`);
    },
    toBeGreaterThanOrEqual(expected: number) {
      check(Number(received) >= expected, `expected ${String(received)} to be >= ${expected}`);
    },
    toBeLessThan(expected: number) {
      check(Number(received) < expected, `expected ${String(received)} to be < ${expected}`);
    },
    toBeLessThanOrEqual(expected: number) {
      check(Number(received) <= expected, `expected ${String(received)} to be <= ${expected}`);
    },
    toContain(expected: unknown) {
      check(contains(received, expected), `expected value to contain ${String(expected)}`);
    },
    toHaveLength(expected: number) {
      check(hasLength(received) && received.length === expected, `expected length to be ${expected}`);
    },
    toHaveProperty(expected: string) {
      check(
        typeof received === "object" && received !== null && expected in received,
        `expected object to have property ${expected}`
      );
    },
    toBeInstanceOf(expected: Function) {
      check(received instanceof expected, "expected value to be instance of constructor");
    },
    toMatch(expected: RegExp) {
      check(typeof received === "string" && expected.test(received), `expected value to match ${expected}`);
    },
    toThrow(expected?: string | RegExp) {
      assert.equal(typeof received, "function", "toThrow expects a function");
      let thrown: unknown;
      try {
        (received as () => unknown)();
      } catch (err) {
        thrown = err;
      }

      const didThrow = thrown !== undefined;
      if (!expected) {
        check(didThrow, "expected function to throw");
        return;
      }

      const message = thrown instanceof Error ? thrown.message : String(thrown);
      const matched = typeof expected === "string" ? message.includes(expected) : expected.test(message);
      check(didThrow && matched, `expected thrown error to match ${String(expected)}`);
    },
  };

  return {
    ...api,
    get not() {
      return buildExpectation(received, !negated);
    },
  };
}

function expect(received: unknown): Expectation {
  return buildExpectation(received);
}

type TestFn = () => void | Promise<void>;

function describe(name: string, fn: TestFn): void {
  void nodeDescribe(name, { concurrency: false }, fn);
}

function it(name: string, fn: TestFn): void {
  void nodeIt(name, { concurrency: false }, fn);
}

export {
  nodeAfter as after,
  nodeAfter as afterAll,
  nodeAfterEach as afterEach,
  nodeBefore as before,
  nodeBefore as beforeAll,
  nodeBeforeEach as beforeEach,
  describe,
  expect,
  it,
};
