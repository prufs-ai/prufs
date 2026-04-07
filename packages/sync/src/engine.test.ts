/**
 * Tests for SyncEngine covering push, pull, sync, and status operations.
 *
 * Uses in-memory implementations of LocalStoreLike and CloudClientLike.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { SyncEngine, isCausalCommit } from "./engine.js";
import { InMemoryStore, InMemoryCloud, makeCommit } from "./test-helpers.js";
import type { SyncEventPayload } from "./types.js";

describe("SyncEngine - pull", () => {
  it("is a no-op when cloud and local are both empty", async () => {
    const store = new InMemoryStore();
    const cloud = new InMemoryCloud();
    const engine = new SyncEngine(store, cloud, { retryBaseMs: 1 });
    const pulled = await engine.pull();
    assert.equal(pulled, 0);
    assert.deepEqual(await store.log(), []);
  });

  it("pulls all cloud commits when local is empty", async () => {
    const store = new InMemoryStore();
    const cloud = new InMemoryCloud();
    cloud.seed(makeCommit("a", "genesis"));
    cloud.seed(makeCommit("b", "a"));
    cloud.seed(makeCommit("c", "b"));

    const engine = new SyncEngine(store, cloud, { retryBaseMs: 1 });
    const pulled = await engine.pull();

    assert.equal(pulled, 3);
    const log = await store.log();
    assert.deepEqual(
      log.map((r) => r.commit_id),
      ["a", "b", "c"]
    );
  });

  it("only pulls commits not already present locally", async () => {
    const store = new InMemoryStore();
    const cloud = new InMemoryCloud();
    await store.put(makeCommit("a", "genesis"));
    cloud.seed(makeCommit("a", "genesis"));
    cloud.seed(makeCommit("b", "a"));

    const engine = new SyncEngine(store, cloud, { retryBaseMs: 1 });
    const pulled = await engine.pull();

    assert.equal(pulled, 1);
    const log = await store.log();
    assert.equal(log.length, 2);
  });

  it("emits pull:start, pull:commit, and pull:complete events", async () => {
    const store = new InMemoryStore();
    const cloud = new InMemoryCloud();
    cloud.seed(makeCommit("a", "genesis"));
    cloud.seed(makeCommit("b", "a"));

    const engine = new SyncEngine(store, cloud, { retryBaseMs: 1 });
    const events: SyncEventPayload[] = [];
    engine.on("*", (e) => events.push(e));

    await engine.pull();

    const types = events.map((e) => e.type);
    assert.ok(types.includes("pull:start"));
    assert.equal(types.filter((t) => t === "pull:commit").length, 2);
    assert.ok(types.includes("pull:complete"));
  });
});

describe("SyncEngine - push", () => {
  it("is a no-op when local is empty", async () => {
    const store = new InMemoryStore();
    const cloud = new InMemoryCloud();
    const engine = new SyncEngine(store, cloud, { retryBaseMs: 1 });
    const [pushed, duplicates, rejected] = await engine.push();
    assert.equal(pushed, 0);
    assert.equal(duplicates, 0);
    assert.equal(rejected, 0);
  });

  it("pushes all local commits when cloud is empty", async () => {
    const store = new InMemoryStore();
    const cloud = new InMemoryCloud();
    await store.put(makeCommit("a", "genesis"));
    await store.put(makeCommit("b", "a"));
    await store.put(makeCommit("c", "b"));

    const engine = new SyncEngine(store, cloud, { retryBaseMs: 1 });
    const [pushed, duplicates, rejected] = await engine.push();

    assert.equal(pushed, 3);
    assert.equal(duplicates, 0);
    assert.equal(rejected, 0);
    const cloudLog = await cloud.fetchLog();
    assert.equal(cloudLog.length, 3);
  });

  it("skips commits already present in cloud", async () => {
    const store = new InMemoryStore();
    const cloud = new InMemoryCloud();
    await store.put(makeCommit("a", "genesis"));
    await store.put(makeCommit("b", "a"));
    cloud.seed(makeCommit("a", "genesis"));

    const engine = new SyncEngine(store, cloud, { retryBaseMs: 1 });
    const [pushed] = await engine.push();

    assert.equal(pushed, 1);
  });

  it("reports rejections", async () => {
    const store = new InMemoryStore();
    const cloud = new InMemoryCloud();
    await store.put(makeCommit("good", "genesis"));
    await store.put(makeCommit("bad", "good"));
    cloud.rejectCommits.add("bad");

    const engine = new SyncEngine(store, cloud, { retryBaseMs: 1 });
    const [pushed, , rejected] = await engine.push();

    assert.equal(pushed, 1);
    assert.equal(rejected, 1);
  });

  it("retries on transient failure", async () => {
    const store = new InMemoryStore();
    const cloud = new InMemoryCloud();
    await store.put(makeCommit("a", "genesis"));
    cloud.failNextN = 2;

    const engine = new SyncEngine(store, cloud, { retryBaseMs: 1, maxRetries: 3 });
    const [pushed] = await engine.push();

    assert.equal(pushed, 1);
    assert.equal(cloud.failNextN, 0);
  });

  it("batches pushes according to batchSize", async () => {
    const store = new InMemoryStore();
    const cloud = new InMemoryCloud();
    for (let i = 0; i < 60; i++) {
      await store.put(makeCommit(`c${i}`, i === 0 ? "genesis" : `c${i - 1}`));
    }

    const engine = new SyncEngine(store, cloud, { retryBaseMs: 1, batchSize: 10 });
    const [pushed] = await engine.push();

    assert.equal(pushed, 60);
  });
});

describe("SyncEngine - sync", () => {
  it("runs pull then push and returns a summary", async () => {
    const store = new InMemoryStore();
    const cloud = new InMemoryCloud();

    cloud.seed(makeCommit("cloud-a", "genesis"));
    cloud.seed(makeCommit("cloud-b", "cloud-a"));
    await store.put(makeCommit("local-x", "genesis"));
    await store.put(makeCommit("local-y", "local-x"));

    const engine = new SyncEngine(store, cloud, { retryBaseMs: 1 });
    const summary = await engine.sync();

    assert.equal(summary.pulled, 2);
    assert.equal(summary.pushed, 2);
    assert.equal(summary.rejected, 0);
    assert.ok(summary.duration_ms >= 0);
    assert.ok(summary.branches.includes("main"));
  });

  it("reaches eventual consistency after sync", async () => {
    const store = new InMemoryStore();
    const cloud = new InMemoryCloud();

    cloud.seed(makeCommit("a", "genesis"));
    await store.put(makeCommit("x", "genesis"));

    const engine = new SyncEngine(store, cloud, { retryBaseMs: 1 });
    await engine.sync();

    const localLog = await store.log();
    const cloudLog = await cloud.fetchLog();
    const localIds = new Set(localLog.map((r) => r.commit_id));
    const cloudIds = new Set(cloudLog.map((r) => r.commit_id));

    // Both sides should contain both commits
    assert.ok(localIds.has("a"));
    assert.ok(localIds.has("x"));
    assert.ok(cloudIds.has("a"));
    assert.ok(cloudIds.has("x"));
  });

  it("emits sync:start and sync:complete", async () => {
    const store = new InMemoryStore();
    const cloud = new InMemoryCloud();
    const engine = new SyncEngine(store, cloud, { retryBaseMs: 1 });

    const events: string[] = [];
    engine.on("*", (e) => events.push(e.type));
    await engine.sync();

    assert.ok(events.includes("sync:start"));
    assert.ok(events.includes("sync:complete"));
  });
});

describe("SyncEngine - status", () => {
  it("reports in_sync when local and cloud match", async () => {
    const store = new InMemoryStore();
    const cloud = new InMemoryCloud();
    await store.put(makeCommit("a", "genesis"));
    cloud.seed(makeCommit("a", "genesis"));

    const engine = new SyncEngine(store, cloud, { retryBaseMs: 1 });
    const status = await engine.status();

    assert.ok(status.in_sync.includes("main"));
    assert.equal(Object.keys(status.local_ahead).length, 0);
    assert.equal(Object.keys(status.cloud_ahead).length, 0);
  });

  it("reports local_ahead when local has unpushed commits", async () => {
    const store = new InMemoryStore();
    const cloud = new InMemoryCloud();
    await store.put(makeCommit("a", "genesis"));
    await store.put(makeCommit("b", "a"));

    const engine = new SyncEngine(store, cloud, { retryBaseMs: 1 });
    const status = await engine.status();

    assert.equal(status.local_ahead["main"], 2);
  });

  it("reports cloud_ahead when cloud has unpulled commits", async () => {
    const store = new InMemoryStore();
    const cloud = new InMemoryCloud();
    cloud.seed(makeCommit("a", "genesis"));
    cloud.seed(makeCommit("b", "a"));

    const engine = new SyncEngine(store, cloud, { retryBaseMs: 1 });
    const status = await engine.status();

    assert.equal(status.cloud_ahead["main"], 2);
  });

  it("reports diverged when both sides have unique commits", async () => {
    const store = new InMemoryStore();
    const cloud = new InMemoryCloud();
    await store.put(makeCommit("local", "genesis"));
    cloud.seed(makeCommit("remote", "genesis"));

    const engine = new SyncEngine(store, cloud, { retryBaseMs: 1 });
    const status = await engine.status();

    assert.ok(status.diverged.includes("main"));
    assert.equal(status.local_ahead["main"], 1);
    assert.equal(status.cloud_ahead["main"], 1);
  });
});

describe("isCausalCommit type guard", () => {
  it("accepts a well-formed commit", () => {
    const commit = makeCommit("a", "genesis");
    assert.equal(isCausalCommit(commit), true);
  });

  it("rejects non-objects", () => {
    assert.equal(isCausalCommit(null), false);
    assert.equal(isCausalCommit(undefined), false);
    assert.equal(isCausalCommit("string"), false);
    assert.equal(isCausalCommit(42), false);
  });

  it("rejects objects missing required fields", () => {
    assert.equal(isCausalCommit({}), false);
    assert.equal(isCausalCommit({ commit_id: "a" }), false);
    assert.equal(
      isCausalCommit({
        commit_id: "a",
        parent_hash: "p",
        timestamp: "t",
        // missing commit_signature, signer_key_id, message
      }),
      false
    );
  });
});
