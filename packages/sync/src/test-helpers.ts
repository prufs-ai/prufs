/**
 * Test helpers: in-memory implementations of LocalStoreLike and CloudClientLike.
 *
 * These are used exclusively by the test suite. Both implementations honor the
 * full contract of their interfaces, including idempotent put/pushCommit and
 * ordered log output.
 */

import type {
  CausalCommitLike,
  CloudClientLike,
  CommitRef,
  LocalStoreLike,
  PushResult,
} from "./types.js";

/**
 * Build a minimal well-formed CausalCommit for testing.
 */
export function makeCommit(
  commit_id: string,
  parent_hash: string,
  branch: string = "main",
  timestamp: string = new Date(2026, 3, 7).toISOString()
): CausalCommitLike {
  return {
    commit_id,
    parent_hash,
    timestamp,
    trail: { nodes: [], edges: [] },
    attestation: { agent_id: "test-agent", model_id: "test-model" },
    changeset: { files: [] },
    commit_signature: `sig-${commit_id}`,
    signer_key_id: "test-key",
    message: `Test commit ${commit_id}`,
    branch,
  };
}

/**
 * Convert a CausalCommit to a CommitRef.
 */
export function toRef(commit: CausalCommitLike): CommitRef {
  return {
    commit_id: commit.commit_id,
    parent_hash: commit.parent_hash,
    branch: commit.branch ?? "main",
    timestamp: commit.timestamp,
  };
}

/**
 * In-memory store for testing. Ordered insertion tracks log order.
 */
export class InMemoryStore implements LocalStoreLike {
  private commits: Map<string, CausalCommitLike> = new Map();
  private order: string[] = [];

  async log(branch?: string): Promise<CommitRef[]> {
    const refs: CommitRef[] = [];
    for (const id of this.order) {
      const commit = this.commits.get(id);
      if (!commit) continue;
      if (branch && commit.branch !== branch) continue;
      refs.push(toRef(commit));
    }
    return refs;
  }

  async get(commit_id: string): Promise<CausalCommitLike | null> {
    return this.commits.get(commit_id) ?? null;
  }

  async put(commit: CausalCommitLike): Promise<void> {
    if (!this.commits.has(commit.commit_id)) {
      this.order.push(commit.commit_id);
    }
    this.commits.set(commit.commit_id, commit);
  }

  async heads(): Promise<Record<string, string>> {
    const heads: Record<string, string> = {};
    for (const id of this.order) {
      const commit = this.commits.get(id);
      if (!commit) continue;
      heads[commit.branch ?? "main"] = commit.commit_id;
    }
    return heads;
  }

  async branches(): Promise<string[]> {
    const set = new Set<string>();
    for (const commit of this.commits.values()) {
      set.add(commit.branch ?? "main");
    }
    return Array.from(set);
  }
}

/**
 * In-memory cloud client for testing.
 * Supports rejection scenarios via the rejectCommits set.
 * Supports transient failure injection via the failNextN counter.
 */
export class InMemoryCloud implements CloudClientLike {
  private commits: Map<string, CausalCommitLike> = new Map();
  private order: string[] = [];
  public rejectCommits: Set<string> = new Set();
  public failNextN: number = 0;

  async pushCommit(commit: CausalCommitLike): Promise<PushResult> {
    if (this.failNextN > 0) {
      this.failNextN--;
      throw new Error("simulated transient failure");
    }
    if (this.rejectCommits.has(commit.commit_id)) {
      return { commit_id: commit.commit_id, status: "rejected", reason: "simulated rejection" };
    }
    if (this.commits.has(commit.commit_id)) {
      return { commit_id: commit.commit_id, status: "duplicate" };
    }
    this.commits.set(commit.commit_id, commit);
    this.order.push(commit.commit_id);
    return { commit_id: commit.commit_id, status: "accepted" };
  }

  async fetchLog(branch?: string): Promise<CommitRef[]> {
    const refs: CommitRef[] = [];
    for (const id of this.order) {
      const commit = this.commits.get(id);
      if (!commit) continue;
      if (branch && commit.branch !== branch) continue;
      refs.push(toRef(commit));
    }
    return refs;
  }

  async fetchCommit(commit_id: string): Promise<CausalCommitLike | null> {
    return this.commits.get(commit_id) ?? null;
  }

  async fetchBranches(): Promise<string[]> {
    const set = new Set<string>();
    for (const commit of this.commits.values()) {
      set.add(commit.branch ?? "main");
    }
    return Array.from(set);
  }

  /** Pre-populate the cloud with a commit, bypassing validation. Used for test setup. */
  seed(commit: CausalCommitLike): void {
    if (!this.commits.has(commit.commit_id)) {
      this.order.push(commit.commit_id);
    }
    this.commits.set(commit.commit_id, commit);
  }
}
