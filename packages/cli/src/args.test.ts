import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, getString, getBool } from "./args.js";

test("parseArgs", async (t) => {
  await t.test("parses a bare command", () => {
    const r = parseArgs(["push"]);
    assert.equal(r.command, "push");
    assert.deepEqual(r.flags, {});
    assert.deepEqual(r.positional, []);
  });

  await t.test("parses long flags with space-separated values", () => {
    const r = parseArgs(["push", "--branch", "main"]);
    assert.equal(r.command, "push");
    assert.equal(r.flags.branch, "main");
  });

  await t.test("parses long flags with equals values", () => {
    const r = parseArgs(["push", "--branch=feature/x"]);
    assert.equal(r.flags.branch, "feature/x");
  });

  await t.test("parses boolean flags with no value", () => {
    const r = parseArgs(["status", "--verbose"]);
    assert.equal(r.flags.verbose, true);
  });

  await t.test("does not swallow the next flag as a value", () => {
    const r = parseArgs(["sync", "--verbose", "--branch", "main"]);
    assert.equal(r.flags.verbose, true);
    assert.equal(r.flags.branch, "main");
  });

  await t.test("collects positional arguments", () => {
    const r = parseArgs(["export", "mybranch"]);
    assert.deepEqual(r.positional, ["mybranch"]);
  });

  await t.test("handles empty argv", () => {
    const r = parseArgs([]);
    assert.equal(r.command, "");
  });
});

test("getString", async (t) => {
  await t.test("returns string values", () => {
    assert.equal(getString({ a: "hello" }, "a"), "hello");
  });
  await t.test("returns undefined for boolean values", () => {
    assert.equal(getString({ a: true }, "a"), undefined);
  });
  await t.test("returns undefined for missing keys", () => {
    assert.equal(getString({}, "a"), undefined);
  });
});

test("getBool", async (t) => {
  await t.test("returns true for true values", () => {
    assert.equal(getBool({ a: true }, "a"), true);
  });
  await t.test("returns true for 'true' string values", () => {
    assert.equal(getBool({ a: "true" }, "a"), true);
  });
  await t.test("returns false for other strings", () => {
    assert.equal(getBool({ a: "no" }, "a"), false);
  });
  await t.test("returns false for missing keys", () => {
    assert.equal(getBool({}, "a"), false);
  });
});
