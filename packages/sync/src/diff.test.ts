/**
 * Tests for commit log diff computation.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { computeDiff, groupByBranch } from "./diff.js";
import type { CommitRef } from "./types.js";

function ref(id: string, branch: string = "main"): CommitRef {
  return {
    commit_id: id,
    parent_hash: "parent",
    branch,
    timestamp: "2026-04-07T00:00:00Z",
  };
}

describe("computeDiff", () => {
  it("reports empty diff when both logs are empty", () => {
    const result = computeDiff([], []);
    assert.deepEqual(result.toPush, []);
    assert.deepEqual(result.toPull, []);
    assert.deepEqual(result.inBoth, []);
  });

  it("reports all local commits as toPush when cloud is empty", () => {
    const local = [ref("a"), ref("b"), ref("c")];
    const result = computeDiff(local, []);
    assert.equal(result.toPush.length, 3);
    assert.equal(result.toPull.length, 0);
    assert.deepEqual(
      result.toPush.map((r) => r.commit_id),
      ["a", "b", "c"]
    );
  });

  it("reports all cloud commits as toPull when local is empty", () => {
    const cloud = [ref("x"), ref("y"), ref("z")];
    const result = computeDiff([], cloud);
    assert.equal(result.toPush.length, 0);
    assert.equal(result.toPull.length, 3);
    assert.deepEqual(
      result.toPull.map((r) => r.commit_id),
      ["x", "y", "z"]
    );
  });

  it("identifies shared commits as inBoth", () => {
    const local = [ref("a"), ref("b"), ref("c")];
    const cloud = [ref("a"), ref("b"), ref("d")];
    const result = computeDiff(local, cloud);
    assert.deepEqual(result.inBoth, ["a", "b"]);
    assert.deepEqual(
      result.toPush.map((r) => r.commit_id),
      ["c"]
    );
    assert.deepEqual(
      result.toPull.map((r) => r.commit_id),
      ["d"]
    );
  });

  it("preserves local order in toPush (parents before children)", () => {
    const local = [ref("grandparent"), ref("parent"), ref("child")];
    const result = computeDiff(local, []);
    assert.deepEqual(
      result.toPush.map((r) => r.commit_id),
      ["grandparent", "parent", "child"]
    );
  });

  it("handles divergent histories correctly", () => {
    const local = [ref("common"), ref("local-a"), ref("local-b")];
    const cloud = [ref("common"), ref("cloud-x"), ref("cloud-y")];
    const result = computeDiff(local, cloud);
    assert.deepEqual(result.inBoth, ["common"]);
    assert.equal(result.toPush.length, 2);
    assert.equal(result.toPull.length, 2);
  });
});

describe("groupByBranch", () => {
  it("returns empty map for empty input", () => {
    const result = groupByBranch([]);
    assert.equal(result.size, 0);
  });

  it("groups commits by branch preserving order", () => {
    const commits = [
      ref("a", "main"),
      ref("x", "feature"),
      ref("b", "main"),
      ref("y", "feature"),
    ];
    const result = groupByBranch(commits);
    assert.equal(result.size, 2);
    assert.deepEqual(
      result.get("main")?.map((c) => c.commit_id),
      ["a", "b"]
    );
    assert.deepEqual(
      result.get("feature")?.map((c) => c.commit_id),
      ["x", "y"]
    );
  });

  it("handles single-branch input", () => {
    const commits = [ref("a"), ref("b"), ref("c")];
    const result = groupByBranch(commits);
    assert.equal(result.size, 1);
    assert.equal(result.get("main")?.length, 3);
  });
});
