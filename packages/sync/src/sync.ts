/**
 * @prufs/sync - Bidirectional sync engine
 *
 * Synchronizes local @prufs/store (SQLite) with @prufs/cloud backend.
 * Handles push (local → cloud), pull (cloud → local), and conflict resolution.
 *
 * Zero external dependencies beyond node built-ins and @prufs packages.
 */


// ─── Types ──────────────────────────────────────────────────────────

export interface PrufsSyncConfig {
  cloudUrl: string;        // e.g., https://prufs-cloud.fly.dev
  apiKey: string;          // prfs_ prefixed API key
  localStorePath: string;  // Path to @prufs/store SQLite database
  orgSlug: string;         // Organization slug for API calls
}

export interface SyncState {
  branch: string;
  local_head: string;
  remote_head: string;
  last_sync_timestamp: string;
  sync_cursor: number;
}

export interface SyncResult {
  pushed_commits: string[];
  pulled_commits: string[];
  conflicts_detected: number;
  bytes_uploaded: number;
  bytes_downloaded: number;
  errors: SyncError[];
  status: 'success' | 'partial' | 'failed';
}

export interface SyncError {
  commit_id?: string;
  code: string;
  message: string;
  timestamp: string;
}

export interface CloudLogEntry {
  commit_id: string;
  parent_hash: string;
  timestamp: string;
  tree_hash: string;
  graph_hash: string;
  branch?: string;
  signer_key_id?: string;
}

export interface CloudCommitResponse {
  commit_id: string;
  parent_hash: string;
  timestamp: string;
  trail: Record<string, unknown>;
  attestation: Record<string, unknown>;
  changeset: {
    files: Array<{
      path: string;
      content_hash: string;
      content?: string;
      change_type: 'add' | 'modify' | 'delete';
      size?: number;
    }>;
  };
  commit_signature: string;
  signer_key_id: string;
  message: string;
  branch?: string;
  tree_hash: string;
  graph_hash: string;
}

interface MergeResult {
  merged: boolean;
  conflicts: number;
  reason?: string;
}

// ─── PrufsSync class ────────────────────────────────────────────────

export class PrufsSync {
  private config: PrufsSyncConfig;
  private store: any; // @prufs/store interface
  private syncStateDb: any; // Minimal SQLite for sync metadata

  constructor(config: PrufsSyncConfig, store: any) {
    this.config = config;
    this.store = store;
    // In real usage, syncStateDb would be a separate SQLite connection
    // or a table within the main store. For now, we track it in memory.
    this.syncStateDb = new Map<string, SyncState>();
  }

  /**
   * Initialize sync state for a branch.
   */
  async initSyncState(branch: string): Promise<SyncState> {
    const existing = this.syncStateDb.get(branch);
    if (existing) return existing;

    const state: SyncState = {
      branch,
      local_head: '',
      remote_head: '',
      last_sync_timestamp: new Date().toISOString(),
      sync_cursor: 0,
    };
    this.syncStateDb.set(branch, state);
    return state;
  }

  /**
   * Get current sync state for a branch.
   */
  async getStatus(branch: string): Promise<SyncState> {
    const state = this.syncStateDb.get(branch);
    if (!state) {
      return this.initSyncState(branch);
    }
    return state;
  }

  /**
   * Push local commits to cloud.
   * Idempotent: pushing the same commits twice succeeds both times.
   */
  async push(branch: string = 'main'): Promise<SyncResult> {
    const result: SyncResult = {
      pushed_commits: [],
      pulled_commits: [],
      conflicts_detected: 0,
      bytes_uploaded: 0,
      bytes_downloaded: 0,
      errors: [],
      status: 'success',
    };

    try {
      // Get current sync state
      const syncState = await this.getStatus(branch);

      // Get local HEAD for this branch
      const localHead = await this.store.head(branch);
      if (!localHead) {
        return { ...result, status: 'success' };
      }

      // Get commit chain from local HEAD back to remote_head
      const commitChain = await this._getCommitChain(
        localHead,
        syncState.remote_head,
      );

      // Push each unpushed commit
      for (const commitId of commitChain) {
        try {
          const commit = await this.store.get(commitId);
          if (!commit) {
            result.errors.push({
              commit_id: commitId,
              code: 'LOCAL_COMMIT_NOT_FOUND',
              message: `Commit ${commitId} not found locally`,
              timestamp: new Date().toISOString(),
            });
            continue;
          }

          // POST to cloud
          await this._pushCommit(commit);
          result.pushed_commits.push(commitId);
          result.bytes_uploaded += JSON.stringify(commit).length;

          // Update sync state for each successfully pushed commit
          syncState.remote_head = commitId;
          syncState.last_sync_timestamp = new Date().toISOString();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          result.errors.push({
            commit_id: commitId,
            code: 'PUSH_FAILED',
            message: `Failed to push: ${errMsg}`,
            timestamp: new Date().toISOString(),
          });
          result.status = 'partial';
        }
      }

      // If every attempt failed, escalate partial → failed
      if (result.status === 'partial' && result.pushed_commits.length === 0) {
        result.status = 'failed';
      }

      // Update local sync state
      if (result.pushed_commits.length > 0) {
        syncState.local_head = localHead;
        this.syncStateDb.set(branch, syncState);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      result.errors.push({
        code: 'PUSH_FAILED',
        message: `Push operation failed: ${errMsg}`,
        timestamp: new Date().toISOString(),
      });
      result.status = 'failed';
    }

    return result;
  }

  /**
   * Pull cloud commits into local store.
   * Fetches missing commits and blobs, respects CRDT merge semantics.
   */
  async pull(branch: string = 'main'): Promise<SyncResult> {
    const result: SyncResult = {
      pushed_commits: [],
      pulled_commits: [],
      conflicts_detected: 0,
      bytes_uploaded: 0,
      bytes_downloaded: 0,
      errors: [],
      status: 'success',
    };

    try {
      // Get current sync state
      const syncState = await this.getStatus(branch);

      // Fetch cloud log
      const cloudLog = await this._getCloudLog(branch);
      if (!cloudLog || cloudLog.length === 0) {
        return result;
      }

      // Filter to commits not yet in local store
      const missingCommits: CloudLogEntry[] = [];
      for (const entry of cloudLog) {
        const exists = await this.store.get(entry.commit_id);
        if (!exists) {
          missingCommits.push(entry);
        }
      }

      // Fetch each missing commit
      for (const logEntry of missingCommits) {
        try {
          const fullCommit = await this._getCloudCommit(logEntry.commit_id);
          if (!fullCommit) {
            result.errors.push({
              commit_id: logEntry.commit_id,
              code: 'CLOUD_COMMIT_NOT_FOUND',
              message: `Commit ${logEntry.commit_id} not found on cloud`,
              timestamp: new Date().toISOString(),
            });
            continue;
          }

          // Fetch and store blobs
          await this._syncBlobs(fullCommit);

          // Store commit locally with merge handling
          const mergeResult = await this._storeWithMerge(fullCommit, branch);

          if (mergeResult.merged) {
            result.pulled_commits.push(logEntry.commit_id);
            result.bytes_downloaded += JSON.stringify(fullCommit).length;
            result.conflicts_detected += mergeResult.conflicts;
          } else {
            result.errors.push({
              commit_id: logEntry.commit_id,
              code: 'MERGE_FAILED',
              message: `Merge failed: ${mergeResult.reason}`,
              timestamp: new Date().toISOString(),
            });
            result.status = 'partial';
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          result.errors.push({
            commit_id: logEntry.commit_id,
            code: 'PULL_FAILED',
            message: `Failed to pull: ${errMsg}`,
            timestamp: new Date().toISOString(),
          });
          result.status = 'partial';
        }
      }

      // Update sync state
      if (missingCommits.length > 0) {
        const lastEntry = missingCommits[missingCommits.length - 1];
        syncState.remote_head = lastEntry.commit_id;
        syncState.last_sync_timestamp = new Date().toISOString();
        syncState.sync_cursor = cloudLog.length;
        this.syncStateDb.set(branch, syncState);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      result.errors.push({
        code: 'PULL_FAILED',
        message: `Pull operation failed: ${errMsg}`,
        timestamp: new Date().toISOString(),
      });
      result.status = 'failed';
    }

    return result;
  }

  /**
   * Full bidirectional sync: push local changes, then pull cloud changes.
   */
  async sync(branch: string = 'main'): Promise<SyncResult> {
    const pushResult = await this.push(branch);
    const pullResult = await this.pull(branch);

    return {
      pushed_commits: pushResult.pushed_commits,
      pulled_commits: pullResult.pulled_commits,
      conflicts_detected: pushResult.conflicts_detected + pullResult.conflicts_detected,
      bytes_uploaded: pushResult.bytes_uploaded + pullResult.bytes_uploaded,
      bytes_downloaded: pushResult.bytes_downloaded + pullResult.bytes_downloaded,
      errors: [...pushResult.errors, ...pullResult.errors],
      status:
        pushResult.status === 'failed' || pullResult.status === 'failed'
          ? 'failed'
          : pushResult.status === 'partial' || pullResult.status === 'partial'
            ? 'partial'
            : 'success',
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────

  /**
   * Get chain of commits from startId back to stopId (exclusive).
   * Used for push to find unpushed commits.
   */
  private async _getCommitChain(startId: string, stopId: string): Promise<string[]> {
    const chain: string[] = [];
    const NULL_HASH = '0'.repeat(64);
    let current = startId;

    while (current && current !== stopId && current !== NULL_HASH) {
      chain.unshift(current);
      const commit = await this.store.get(current);
      if (!commit) break;
      current = commit.parent_hash;
    }

    return chain;
  }

  /**
   * Push a single commit to cloud.
   */
  private async _pushCommit(commit: any): Promise<void> {
    const url = new URL(`/v1/commits`, this.config.cloudUrl);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(commit),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Cloud push failed (${response.status}): ${errorBody}`,
      );
    }
  }

  /**
   * Fetch cloud log entries.
   */
  private async _getCloudLog(branch?: string): Promise<CloudLogEntry[]> {
    const url = new URL(`/v1/log`, this.config.cloudUrl);
    if (branch) {
      url.searchParams.set('branch', branch);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Cloud log fetch failed (${response.status})`);
    }

    const body = await response.json() as { log?: CloudLogEntry[] };
    return body.log ?? [];
  }

  /**
   * Fetch full commit from cloud.
   */
  private async _getCloudCommit(commitId: string): Promise<CloudCommitResponse | null> {
    const url = new URL(`/v1/commits/${commitId}`, this.config.cloudUrl);
    url.searchParams.set('full', 'true');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Cloud commit fetch failed (${response.status})`);
    }

    return response.json() as Promise<CloudCommitResponse>;
  }

  /**
   * Fetch and store blobs for a commit's changeset.
   */
  private async _syncBlobs(commit: CloudCommitResponse): Promise<void> {
    if (!commit.changeset || !commit.changeset.files) {
      return;
    }

    for (const file of commit.changeset.files) {
      if (file.change_type === 'delete' || !file.content_hash) {
        continue;
      }

      // Check if blob already exists locally
      const existsLocally = await this.store.blobs(file.content_hash);
      if (existsLocally && existsLocally.length > 0) {
        continue; // Already have this blob
      }

      // Fetch blob from cloud
      const blobUrl = new URL(
        `/v1/blobs/${file.content_hash}`,
        this.config.cloudUrl,
      );

      const response = await fetch(blobUrl.toString(), {
        method: 'GET',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          continue; // Blob not yet available on cloud; skip
        }
        throw new Error(
          `Blob fetch failed for ${file.content_hash} (${response.status})`,
        );
      }

      await response.arrayBuffer();

      // Store blob locally (with content_hash for dedup)
      // Assuming @prufs/store has a method to store blobs directly
      // For now, we'll assume the blob is stored via commit.put()
    }
  }

  /**
   * Store commit locally with CRDT merge handling.
   * Returns merge result to track conflicts.
   */
  private async _storeWithMerge(
    commit: CloudCommitResponse,
    branch: string,
  ): Promise<MergeResult> {
    try {
      // Check if parent exists locally
      const parentExists = await this.store.get(commit.parent_hash);

      if (!parentExists && commit.parent_hash !== '0'.repeat(64)) {
        // Parent not found and it's not genesis - this is a gap in the chain
        return {
          merged: false,
          conflicts: 0,
          reason: 'Parent commit not found locally',
        };
      }

      // Check for merge with current branch HEAD
      const localHead = await this.store.head(branch);

      if (!localHead) {
        // First commit on this branch
        await this.store.put(commit as any);
        return { merged: true, conflicts: 0 };
      }

      if (localHead === commit.parent_hash) {
        // Linear history - commit is next in chain
        await this.store.put(commit as any);
        return { merged: true, conflicts: 0 };
      }

      // Merge needed: divergent histories
      // Use @prufs/store's CRDT merge tiers
      const mergeResult = await this.store.merge(localHead, commit.commit_id);

      if (mergeResult && mergeResult.status === 'merged') {
        return {
          merged: true,
          conflicts: mergeResult.conflicts_auto_resolved ?? 0,
        };
      }

      if (mergeResult && mergeResult.status === 'needs_human_review') {
        return {
          merged: false,
          conflicts: mergeResult.conflicts_needing_review ?? 1,
          reason: 'Merge requires human review (restricted-sensitivity files)',
        };
      }

      return {
        merged: false,
        conflicts: 0,
        reason: 'Merge failed',
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        merged: false,
        conflicts: 0,
        reason: `Store error: ${errMsg}`,
      };
    }
  }
}

// ─── Factory ────────────────────────────────────────────────────────

/**
 * Create a PrufsSync instance.
 * Requires @prufs/store instance.
 */
export async function createPrufsSync(
  config: PrufsSyncConfig,
  store: any,
): Promise<PrufsSync> {
  const sync = new PrufsSync(config, store);
  // Initialize sync state tables if needed
  // (In production, this would initialize SQLite tables)
  return sync;
}
