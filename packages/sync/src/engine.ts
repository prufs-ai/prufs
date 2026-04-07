/**
 * SyncEngine - bidirectional synchronization between @prufs/store and @prufs/cloud.
 *
 * Responsibilities:
 * - Pull: fetch commits from the cloud that are not present locally
 * - Push: send commits to the cloud that are not present remotely
 * - Sync: pull then push (reaching eventual consistency)
 * - Status: report what a sync would do, without making changes
 *
 * The engine is CRDT-friendly: all sync operations are safe to run concurrently
 * from multiple clients because commits are content-addressed and POST /v1/commits
 * is idempotent on the server side (duplicate commit_ids return "duplicate" status).
 *
 * Merge conflict resolution is delegated to @prufs/store's existing three-tier merge:
 * - Disjoint changes: auto-merge
 * - Overlapping non-restricted: last-write-wins
 * - Overlapping restricted: human gate (emitted as merge:conflict event)
 */

import type {
  CausalCommitLike,
  CloudClientLike,
  LocalStoreLike,
  SyncEngineOptions,
  SyncStatus,
  SyncSummary,
} from "./types.js";
import { computeDiff } from "./diff.js";
import { withRetry } from "./backoff.js";
import { SyncEmitter } from "./emitter.js";

const DEFAULT_OPTIONS: Required<Omit<SyncEngineOptions, "logger">> = {
  batchSize: 25,
  maxRetries: 3,
  retryBaseMs: 200,
};

export class SyncEngine extends SyncEmitter {
  private readonly store: LocalStoreLike;
  private readonly cloud: CloudClientLike;
  private readonly options: Required<Omit<SyncEngineOptions, "logger">> & {
    logger?: (message: string) => void;
  };

  constructor(
    store: LocalStoreLike,
    cloud: CloudClientLike,
    options: SyncEngineOptions = {}
  ) {
    super();
    this.store = store;
    this.cloud = cloud;
    this.options = {
      batchSize: options.batchSize ?? DEFAULT_OPTIONS.batchSize,
      maxRetries: options.maxRetries ?? DEFAULT_OPTIONS.maxRetries,
      retryBaseMs: options.retryBaseMs ?? DEFAULT_OPTIONS.retryBaseMs,
      logger: options.logger,
    };
  }

  private log(message: string): void {
    if (this.options.logger) {
      this.options.logger(message);
    }
  }

  /**
   * Pull cloud commits that are not present locally.
   * Returns the number of commits pulled.
   */
  async pull(branch?: string): Promise<number> {
    this.emit({ type: "pull:start", branch });
    this.log(`[sync] pull start${branch ? ` branch=${branch}` : ""}`);

    const [localLog, cloudLog] = await Promise.all([
      this.store.log(branch),
      this.cloud.fetchLog(branch),
    ]);

    const diff = computeDiff(localLog, cloudLog);
    let pulled = 0;

    for (const commitRef of diff.toPull) {
      const full = await withRetry(
        () => this.cloud.fetchCommit(commitRef.commit_id),
        { baseMs: this.options.retryBaseMs, maxRetries: this.options.maxRetries }
      );
      if (full) {
        await this.store.put(full);
        pulled++;
        this.emit({ type: "pull:commit", commit_id: commitRef.commit_id, branch: commitRef.branch });
      }
    }

    this.emit({ type: "pull:complete", branch, count: pulled });
    this.log(`[sync] pull complete: ${pulled} commits pulled`);
    return pulled;
  }

  /**
   * Push local commits that are not present in the cloud.
   * Returns a tuple of [pushed, duplicates, rejected].
   */
  async push(branch?: string): Promise<[number, number, number]> {
    this.emit({ type: "push:start", branch });
    this.log(`[sync] push start${branch ? ` branch=${branch}` : ""}`);

    const [localLog, cloudLog] = await Promise.all([
      this.store.log(branch),
      this.cloud.fetchLog(branch),
    ]);

    const diff = computeDiff(localLog, cloudLog);
    let pushed = 0;
    let duplicates = 0;
    let rejected = 0;

    // Batch commits for efficient push.
    const batches = this.chunk(diff.toPush, this.options.batchSize);

    for (const batch of batches) {
      for (const ref of batch) {
        const full = await this.store.get(ref.commit_id);
        if (!full) {
          this.log(`[sync] push skip: commit ${ref.commit_id} not found in local store`);
          continue;
        }
        const result = await withRetry(
          () => this.cloud.pushCommit(full),
          { baseMs: this.options.retryBaseMs, maxRetries: this.options.maxRetries }
        );
        switch (result.status) {
          case "accepted":
            pushed++;
            this.emit({ type: "push:commit", commit_id: result.commit_id, branch: ref.branch });
            break;
          case "duplicate":
            duplicates++;
            this.emit({
              type: "push:commit",
              commit_id: result.commit_id,
              branch: ref.branch,
              message: "duplicate",
            });
            break;
          case "rejected":
            rejected++;
            this.emit({
              type: "sync:error",
              commit_id: result.commit_id,
              branch: ref.branch,
              message: result.reason,
            });
            break;
        }
      }
    }

    this.emit({ type: "push:complete", branch, count: pushed });
    this.log(`[sync] push complete: ${pushed} pushed, ${duplicates} duplicates, ${rejected} rejected`);
    return [pushed, duplicates, rejected];
  }

  /**
   * Full bidirectional sync: pull then push.
   * Returns a summary of actions taken across all branches.
   */
  async sync(branch?: string): Promise<SyncSummary> {
    const startTime = Date.now();
    this.emit({ type: "sync:start", branch });

    let pulled = 0;
    let pushed = 0;
    let duplicates = 0;
    let rejected = 0;
    let errors = 0;
    const branchesTouched: Set<string> = new Set();

    try {
      pulled = await this.pull(branch);
      const [p, d, r] = await this.push(branch);
      pushed = p;
      duplicates = d;
      rejected = r;

      const localBranches = await this.store.branches();
      for (const b of localBranches) {
        branchesTouched.add(b);
      }
    } catch (err) {
      errors++;
      this.emit({
        type: "sync:error",
        branch,
        error: err instanceof Error ? err : new Error(String(err)),
      });
      throw err;
    }

    const summary: SyncSummary = {
      pulled,
      pushed,
      duplicates,
      rejected,
      errors,
      branches: Array.from(branchesTouched),
      duration_ms: Date.now() - startTime,
    };

    this.emit({ type: "sync:complete", branch, count: pulled + pushed });
    return summary;
  }

  /**
   * Dry-run: report what sync() would do without making any changes.
   */
  async status(): Promise<SyncStatus> {
    const localBranches = await this.store.branches();
    const cloudBranches = await this.cloud.fetchBranches();
    const allBranches = new Set([...localBranches, ...cloudBranches]);

    const local_ahead: Record<string, number> = {};
    const cloud_ahead: Record<string, number> = {};
    const in_sync: string[] = [];
    const diverged: string[] = [];

    for (const branch of allBranches) {
      const [localLog, cloudLog] = await Promise.all([
        this.store.log(branch),
        this.cloud.fetchLog(branch),
      ]);
      const diff = computeDiff(localLog, cloudLog);

      if (diff.toPush.length === 0 && diff.toPull.length === 0) {
        in_sync.push(branch);
      } else if (diff.toPush.length > 0 && diff.toPull.length === 0) {
        local_ahead[branch] = diff.toPush.length;
      } else if (diff.toPull.length > 0 && diff.toPush.length === 0) {
        cloud_ahead[branch] = diff.toPull.length;
      } else {
        diverged.push(branch);
        local_ahead[branch] = diff.toPush.length;
        cloud_ahead[branch] = diff.toPull.length;
      }
    }

    return { local_ahead, cloud_ahead, in_sync, diverged };
  }

  private chunk<T>(array: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }
    return result;
  }
}

/**
 * Type guard: check whether a value looks like a CausalCommit.
 */
export function isCausalCommit(value: unknown): value is CausalCommitLike {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.commit_id === "string" &&
    typeof obj.parent_hash === "string" &&
    typeof obj.timestamp === "string" &&
    typeof obj.commit_signature === "string" &&
    typeof obj.signer_key_id === "string" &&
    typeof obj.message === "string"
  );
}
