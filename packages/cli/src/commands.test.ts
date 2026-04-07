import { test } from "node:test";
import assert from "node:assert/strict";
import { cmdPush, cmdPull, cmdSync, cmdStatus, cmdExport } from "./commands.js";
import type { CommandDeps } from "./commands.js";
import type {
  CausalCommitLike,
  CommitRef,
  LocalStoreLike,
  SyncStatus,
  SyncSummary,
} from "@prufs/sync";
import type { CloudSync } from "@prufs/sdk-cloudsync";

function makeCommit(id: string, branch = "main"): CausalCommitLike {
  return {
    commit_id: id,
    parent_hash: "",
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

class MemStore implements LocalStoreLike {
  commits = new Map<string, CausalCommitLike>();
  async log(branch?: string): Promise<CommitRef[]> {
    const out: CommitRef[] = [];
    for (const c of this.commits.values()) {
      if (!branch || c.branch === branch) {
        out.push({
          commit_id: c.commit_id,
          parent_hash: c.parent_hash,
          branch: c.branch ?? "main",
          timestamp: c.timestamp,
        });
      }
    }
    return out;
  }
  async get(id: string): Promise<CausalCommitLike | null> {
    return this.commits.get(id) ?? null;
  }
  async put(c: CausalCommitLike): Promise<void> {
    this.commits.set(c.commit_id, c);
  }
  async heads(): Promise<Record<string, string>> {
    return {};
  }
  async branches(): Promise<string[]> {
    return Array.from(
      new Set(Array.from(this.commits.values()).map((c) => c.branch ?? "main"))
    );
  }
}

function fakeCloud(overrides: Partial<CloudSync> = {}): CloudSync {
  return {
    push: async () => [1, 0, 0] as [number, number, number],
    pull: async () => 2,
    sync: async (): Promise<SyncSummary> => ({
      pulled: 2,
      pushed: 1,
      duplicates: 0,
      rejected: 0,
      errors: 0,
      branches: ["main"],
      duration_ms: 42,
    }),
    status: async (): Promise<SyncStatus> => ({
      local_ahead: { main: 1 },
      cloud_ahead: {},
      in_sync: [],
      diverged: [],
    }),
    ...overrides,
  } as unknown as CloudSync;
}

function makeDeps(cloud: CloudSync): { deps: CommandDeps; logs: string[] } {
  const logs: string[] = [];
  const store = new MemStore();
  const deps: CommandDeps = {
    config: {
      apiKey: "k",
      orgSlug: "o",
      baseUrl: "https://api.prufs.ai",
      storePath: "/tmp/cli-test",
    },
    store,
    cloudSyncFactory: () => cloud,
    log: (m) => logs.push(m),
  };
  return { deps, logs };
}

test("cmdPush", async (t) => {
  await t.test("reports push counts and returns 0 on success", async () => {
    const { deps, logs } = makeDeps(fakeCloud());
    const code = await cmdPush(deps);
    assert.equal(code, 0);
    assert.match(logs[0] ?? "", /1 pushed, 0 duplicates, 0 rejected/);
  });

  await t.test("returns 1 when any commit is rejected", async () => {
    const { deps } = makeDeps(
      fakeCloud({ push: async () => [0, 0, 1] as [number, number, number] })
    );
    const code = await cmdPush(deps);
    assert.equal(code, 1);
  });

  await t.test("passes branch option through", async () => {
    let seenBranch: string | undefined;
    const { deps } = makeDeps(
      fakeCloud({
        push: async (b?: string) => {
          seenBranch = b;
          return [0, 0, 0] as [number, number, number];
        },
      })
    );
    await cmdPush(deps, { branch: "feature/x" });
    assert.equal(seenBranch, "feature/x");
  });
});

test("cmdPull", async (t) => {
  await t.test("reports pulled count and returns 0", async () => {
    const { deps, logs } = makeDeps(fakeCloud());
    const code = await cmdPull(deps);
    assert.equal(code, 0);
    assert.match(logs[0] ?? "", /2 commits pulled/);
  });
});

test("cmdSync", async (t) => {
  await t.test("reports summary and returns 0", async () => {
    const { deps, logs } = makeDeps(fakeCloud());
    const code = await cmdSync(deps);
    assert.equal(code, 0);
    assert.match(logs[0] ?? "", /2 pulled, 1 pushed/);
  });

  await t.test("returns 1 when summary has rejected or errored commits", async () => {
    const { deps } = makeDeps(
      fakeCloud({
        sync: async () => ({
          pulled: 0,
          pushed: 0,
          duplicates: 0,
          rejected: 1,
          errors: 0,
          branches: ["main"],
          duration_ms: 10,
        }),
      })
    );
    const code = await cmdSync(deps);
    assert.equal(code, 1);
  });
});

test("cmdStatus", async (t) => {
  await t.test("reports local_ahead when present", async () => {
    const { deps, logs } = makeDeps(fakeCloud());
    const code = await cmdStatus(deps);
    assert.equal(code, 0);
    assert.match(logs[0] ?? "", /local ahead: main \(\+1\)/);
  });

  await t.test("reports no tracking when all empty", async () => {
    const { deps, logs } = makeDeps(
      fakeCloud({
        status: async () => ({
          local_ahead: {},
          cloud_ahead: {},
          in_sync: [],
          diverged: [],
        }),
      })
    );
    await cmdStatus(deps);
    assert.match(logs[0] ?? "", /no branches tracked/);
  });
});

test("cmdExport", async (t) => {
  await t.test("dumps commits as JSON to stdout by default", async () => {
    const { deps, logs } = makeDeps(fakeCloud());
    await deps.store.put(makeCommit("c1"));
    await deps.store.put(makeCommit("c2"));
    const code = await cmdExport(deps, { format: "json" });
    assert.equal(code, 0);
    const parsed = JSON.parse(logs[0] ?? "{}");
    assert.equal(parsed.commits.length, 2);
    assert.ok(Array.isArray(parsed.branches));
  });

  await t.test("ndjson format emits one commit per line", async () => {
    const { deps, logs } = makeDeps(fakeCloud());
    await deps.store.put(makeCommit("c1"));
    await deps.store.put(makeCommit("c2"));
    await cmdExport(deps, { format: "ndjson" });
    const lines = (logs[0] ?? "").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.doesNotThrow(() => JSON.parse(lines[0] ?? ""));
  });
});
