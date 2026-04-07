import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudSync } from "./cloudsync.js";
import type {
  CausalCommitLike,
  LocalStoreLike,
  CloudClientLike,
  CommitRef,
  PushResult,
} from "@prufs/sync";

function makeCommit(
  id: string,
  parent = "",
  branch = "main"
): CausalCommitLike {
  return {
    commit_id: id,
    parent_hash: parent,
    timestamp: new Date().toISOString(),
    trail: {},
    attestation: {},
    changeset: {},
    commit_signature: `sig-${id}`,
    signer_key_id: "test-key",
    message: `commit ${id}`,
    branch,
  };
}

function toRef(c: CausalCommitLike): CommitRef {
  return {
    commit_id: c.commit_id,
    parent_hash: c.parent_hash,
    branch: c.branch ?? "main",
    timestamp: c.timestamp,
  };
}

class MemStore implements LocalStoreLike {
  commits = new Map<string, CausalCommitLike>();
  async log(branch?: string): Promise<CommitRef[]> {
    const out: CommitRef[] = [];
    for (const c of this.commits.values()) {
      if (!branch || c.branch === branch) out.push(toRef(c));
    }
    return out;
  }
  async get(id: string): Promise<CausalCommitLike | null> {
    return this.commits.get(id) ?? null;
  }
  async put(commit: CausalCommitLike): Promise<void> {
    this.commits.set(commit.commit_id, commit);
  }
  async heads(): Promise<Record<string, string>> {
    const h: Record<string, string> = {};
    for (const c of this.commits.values()) h[c.branch ?? "main"] = c.commit_id;
    return h;
  }
  async branches(): Promise<string[]> {
    return Array.from(
      new Set(Array.from(this.commits.values()).map((c) => c.branch ?? "main"))
    );
  }
}

class MemCloud implements CloudClientLike {
  commits = new Map<string, CausalCommitLike>();
  async pushCommit(commit: CausalCommitLike): Promise<PushResult> {
    if (this.commits.has(commit.commit_id)) {
      return { commit_id: commit.commit_id, status: "duplicate" };
    }
    this.commits.set(commit.commit_id, commit);
    return { commit_id: commit.commit_id, status: "accepted" };
  }
  async fetchLog(branch?: string): Promise<CommitRef[]> {
    const out: CommitRef[] = [];
    for (const c of this.commits.values()) {
      if (!branch || c.branch === branch) out.push(toRef(c));
    }
    return out;
  }
  async fetchCommit(id: string): Promise<CausalCommitLike | null> {
    return this.commits.get(id) ?? null;
  }
  async fetchBranches(): Promise<string[]> {
    return Array.from(
      new Set(Array.from(this.commits.values()).map((c) => c.branch ?? "main"))
    );
  }
}

test("CloudSync - constructor validation", async (t) => {
  await t.test("throws when config is missing", () => {
    assert.throws(
      () => new CloudSync(undefined as never),
      /config is required/
    );
  });

  await t.test("throws when localStore is missing", () => {
    assert.throws(
      () =>
        new CloudSync({
          apiKey: "k",
          orgSlug: "o",
        } as never),
      /localStore is required/
    );
  });

  await t.test("throws when apiKey is missing and no cloudClient provided", () => {
    assert.throws(
      () =>
        new CloudSync({
          orgSlug: "o",
          localStore: new MemStore(),
        } as never),
      /apiKey is required/
    );
  });

  await t.test("throws when orgSlug is missing and no cloudClient provided", () => {
    assert.throws(
      () =>
        new CloudSync({
          apiKey: "k",
          localStore: new MemStore(),
        } as never),
      /orgSlug is required/
    );
  });

  await t.test("accepts a pre-built cloudClient without apiKey or orgSlug", () => {
    const cs = new CloudSync({
      localStore: new MemStore(),
      cloudClient: new MemCloud(),
    });
    assert.ok(cs instanceof CloudSync);
  });

  await t.test("accepts HTTP client configuration", () => {
    const cs = new CloudSync({
      apiKey: "prfs_test",
      orgSlug: "cognitionhive",
      localStore: new MemStore(),
    });
    assert.ok(cs instanceof CloudSync);
  });
});

test("CloudSync - push", async (t) => {
  await t.test("pushes local commits to cloud", async () => {
    const local = new MemStore();
    const cloud = new MemCloud();
    await local.put(makeCommit("c1"));
    await local.put(makeCommit("c2", "c1"));

    const cs = new CloudSync({ localStore: local, cloudClient: cloud });
    const [pushed, dup, rej] = await cs.push();
    assert.equal(pushed, 2);
    assert.equal(dup, 0);
    assert.equal(rej, 0);
    assert.equal(cloud.commits.size, 2);
  });

  await t.test("is idempotent on a second push", async () => {
    const local = new MemStore();
    const cloud = new MemCloud();
    await local.put(makeCommit("c1"));

    const cs = new CloudSync({ localStore: local, cloudClient: cloud });
    await cs.push();
    const [pushed2] = await cs.push();
    assert.equal(pushed2, 0);
  });
});

test("CloudSync - pull", async (t) => {
  await t.test("pulls cloud commits to local", async () => {
    const local = new MemStore();
    const cloud = new MemCloud();
    await cloud.pushCommit(makeCommit("c1"));
    await cloud.pushCommit(makeCommit("c2", "c1"));

    const cs = new CloudSync({ localStore: local, cloudClient: cloud });
    const pulled = await cs.pull();
    assert.equal(pulled, 2);
    assert.equal(local.commits.size, 2);
  });
});

test("CloudSync - sync", async (t) => {
  await t.test("performs full bidirectional sync", async () => {
    const local = new MemStore();
    const cloud = new MemCloud();
    await local.put(makeCommit("local1"));
    await cloud.pushCommit(makeCommit("cloud1"));

    const cs = new CloudSync({ localStore: local, cloudClient: cloud });
    const summary = await cs.sync();
    assert.equal(summary.pulled, 1);
    assert.equal(summary.pushed, 1);
    assert.equal(local.commits.size, 2);
    assert.equal(cloud.commits.size, 2);
  });
});

test("CloudSync - status", async (t) => {
  await t.test("reports in_sync when both sides match", async () => {
    const local = new MemStore();
    const cloud = new MemCloud();
    const c = makeCommit("c1");
    await local.put(c);
    await cloud.pushCommit(c);

    const cs = new CloudSync({ localStore: local, cloudClient: cloud });
    const st = await cs.status();
    assert.ok(st.in_sync.includes("main"));
  });

  await t.test("reports local_ahead when local has unpushed commits", async () => {
    const local = new MemStore();
    const cloud = new MemCloud();
    await local.put(makeCommit("c1"));

    const cs = new CloudSync({ localStore: local, cloudClient: cloud });
    const st = await cs.status();
    assert.ok(st.local_ahead.main && st.local_ahead.main > 0);
  });
});

test("CloudSync - events", async (t) => {
  await t.test("forwards engine events through on/off", async () => {
    const local = new MemStore();
    const cloud = new MemCloud();
    await local.put(makeCommit("c1"));

    const cs = new CloudSync({ localStore: local, cloudClient: cloud });

    const received: string[] = [];
    const listener = (p: { type: string }) => received.push(p.type);
    cs.on("*", listener);
    await cs.push();
    cs.off("*", listener);

    assert.ok(received.includes("push:start"));
    assert.ok(received.includes("push:complete"));
  });
});

test("CloudSync - raw accessors", async (t) => {
  await t.test("exposes rawEngine and rawClient for advanced callers", () => {
    const cloud = new MemCloud();
    const cs = new CloudSync({
      localStore: new MemStore(),
      cloudClient: cloud,
    });
    assert.ok(cs.rawEngine);
    assert.equal(cs.rawClient, cloud);
  });
});
