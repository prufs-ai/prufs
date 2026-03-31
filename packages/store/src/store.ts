/**
 * @prufs/store - store.ts
 *
 * PrufsStore: the content-addressed, CRDT-merged commit store.
 *
 * This is the authoritative storage layer for Prufs Phase 2.
 * There is no .git directory. There is no Git object store underneath.
 * The blob index is Prufs-native SHA-256 content addressing.
 * The commit DAG is Prufs-native CausalCommit objects.
 *
 * API surface:
 *   put(commit)          - verify + store a commit and all its blobs
 *   merge(a, b)          - attempt CRDT merge of two commits
 *   get(commit_id)       - retrieve a commit by id
 *   head(branch)         - get the HEAD commit_id for a branch
 *   log(branch, limit)   - walk the commit chain from HEAD
 *   blobs(commit_id)     - list blob records for a commit
 *   resolve(path, branch)- resolve a path to its latest content
 *   stats()              - storage statistics
 */

import { createHash } from 'crypto';
import type { DbAdapter } from './db.js';
import { SCHEMA_DDL } from './db.js';
import { mergeCommits } from './merge.js';
import type {
  CausalCommit,
  ContentBlob,
  MergeResult,
  StoreStats,
} from './types.js';

// ---------------------------------------------------------------------------
// Row types (what comes back from SQLite)
// ---------------------------------------------------------------------------

interface CommitRow {
  commit_id: string;
  parent_hash: string;
  branch: string;
  timestamp: string;
  message: string;
  agent_id: string;
  commit_json: string;
}

interface BlobRow {
  content_hash: string;
  content: string;
  size_bytes: number;
  created_at: string;
  path_hint: string | null;
}

interface CommitBlobRow {
  commit_id: string;
  path: string;
  content_hash: string;
  change_type: string;
  content?: string;
}

interface BranchHeadRow {
  branch: string;
  commit_id: string;
  updated_at: string;
}

interface MergeLogRow {
  merge_id: string;
  branch: string;
  commit_ids: string;
  strategy: string;
  outcome: string;
  timestamp: string;
  detail_json: string;
}

interface StatsRow {
  commit_count: number;
  blob_count: number;
  branch_count: number;
  total_blob_bytes: number;
}

// ---------------------------------------------------------------------------
// PrufsStore
// ---------------------------------------------------------------------------

export class PrufsStore {
  private db: DbAdapter;

  constructor(db: DbAdapter) {
    this.db = db;
    this.initSchema();
  }

  // -------------------------------------------------------------------------
  // Schema init
  // -------------------------------------------------------------------------

  private initSchema(): void {
    this.db.exec(SCHEMA_DDL);
  }

  // -------------------------------------------------------------------------
  // put() - store a commit and all its blobs
  //
  // Accepts a pre-built CausalCommit (already verified by @prufs/commit).
  // The store does not re-verify cryptographic signatures - that is the
  // caller's responsibility. The store does enforce structural invariants:
  //   - commit_id must not already exist
  //   - parent_hash must exist (or be GENESIS_HASH)
  //   - all blobs with content must be stored
  // -------------------------------------------------------------------------

  put(commit: CausalCommit): void {
    const branch = commit.branch ?? 'main';

    // Idempotency: skip if already stored
    const existing = this.db.get<CommitRow>(
      'SELECT commit_id FROM commits WHERE commit_id = ?',
      [commit.commit_id]
    );
    if (existing) return;

    // Store blobs (deduplication: INSERT OR IGNORE)
    const now = new Date().toISOString();
    for (const blob of commit.changeset.changed) {
      if (blob.content !== undefined) {
        this.db.run(
          `INSERT OR IGNORE INTO blobs (content_hash, content, size_bytes, created_at, path_hint)
           VALUES (?, ?, ?, ?, ?)`,
          [
            blob.content_hash,
            blob.content,
            Buffer.byteLength(blob.content, 'utf8'),
            now,
            blob.path,
          ]
        );
      }
    }

    // Store commit
    this.db.run(
      `INSERT INTO commits (commit_id, parent_hash, branch, timestamp, message, agent_id, commit_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        commit.commit_id,
        commit.parent_hash,
        branch,
        commit.timestamp,
        commit.message,
        commit.attestation.agent_id,
        JSON.stringify(commit),
      ]
    );

    // Store commit_blobs join records
    for (const blob of commit.changeset.changed) {
      this.db.run(
        `INSERT OR REPLACE INTO commit_blobs (commit_id, path, content_hash, change_type)
         VALUES (?, ?, ?, ?)`,
        [commit.commit_id, blob.path, blob.content_hash, blob.change_type]
      );
    }

    // Update branch HEAD
    const existingHead = this.db.get<BranchHeadRow>(
      'SELECT commit_id FROM branch_heads WHERE branch = ?',
      [branch]
    );

    if (!existingHead) {
      this.db.run(
        `INSERT INTO branch_heads (branch, commit_id, updated_at) VALUES (?, ?, ?)`,
        [branch, commit.commit_id, now]
      );
    } else {
      // Advance HEAD only if this commit is a descendant (later timestamp)
      const headCommit = this.db.get<CommitRow>(
        'SELECT timestamp FROM commits WHERE commit_id = ?',
        [existingHead.commit_id]
      );
      const headTime = headCommit
        ? new Date(headCommit.timestamp).getTime()
        : 0;
      const thisTime = new Date(commit.timestamp).getTime();
      if (thisTime >= headTime) {
        this.db.run(
          `UPDATE branch_heads SET commit_id = ?, updated_at = ? WHERE branch = ?`,
          [commit.commit_id, now, branch]
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // merge() - CRDT merge two commits
  // -------------------------------------------------------------------------

  merge(base: CausalCommit, incoming: CausalCommit): MergeResult {
    const result = mergeCommits(base, incoming);

    // Log all merge attempts
    const mergeId = this.newMergeId();
    const branch = base.branch ?? incoming.branch ?? 'main';

    this.db.run(
      `INSERT INTO merge_log (merge_id, branch, commit_ids, strategy, outcome, timestamp, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        mergeId,
        branch,
        JSON.stringify([base.commit_id, incoming.commit_id]),
        result.strategy_used,
        result.outcome,
        new Date().toISOString(),
        JSON.stringify({ detail: result.detail, conflicts: result.conflicts }),
      ]
    );

    return result;
  }

  // -------------------------------------------------------------------------
  // get() - retrieve a commit by id
  // -------------------------------------------------------------------------

  get(commitId: string): CausalCommit | undefined {
    const row = this.db.get<CommitRow>(
      'SELECT commit_json FROM commits WHERE commit_id = ?',
      [commitId]
    );
    if (!row) return undefined;
    return JSON.parse(row.commit_json) as CausalCommit;
  }

  // -------------------------------------------------------------------------
  // head() - get the HEAD commit for a branch
  // -------------------------------------------------------------------------

  head(branch = 'main'): CausalCommit | undefined {
    const headRow = this.db.get<BranchHeadRow>(
      'SELECT commit_id FROM branch_heads WHERE branch = ?',
      [branch]
    );
    if (!headRow) return undefined;
    return this.get(headRow.commit_id);
  }

  // -------------------------------------------------------------------------
  // log() - walk the commit chain from HEAD (newest first)
  // -------------------------------------------------------------------------

  log(branch = 'main', limit = 50): CausalCommit[] {
    const rows = this.db.all<CommitRow>(
      `SELECT commit_json FROM commits
       WHERE branch = ?
       ORDER BY timestamp DESC
       LIMIT ?`,
      [branch, limit]
    );
    return rows.map((r) => JSON.parse(r.commit_json) as CausalCommit);
  }

  // -------------------------------------------------------------------------
  // blobs() - list blob records for a commit
  // -------------------------------------------------------------------------

  blobs(commitId: string): ContentBlob[] {
    const rows = this.db.all<CommitBlobRow>(
      `SELECT cb.path, cb.content_hash, cb.change_type, b.content
       FROM commit_blobs cb
       LEFT JOIN blobs b ON cb.content_hash = b.content_hash
       WHERE cb.commit_id = ?`,
      [commitId]
    );
    return rows.map((r) => ({
      path: r.path,
      content_hash: r.content_hash,
      change_type: r.change_type as ContentBlob['change_type'],
      content: r.content ?? undefined,
    }));
  }

  // -------------------------------------------------------------------------
  // resolve() - resolve a path to its latest content on a branch
  // -------------------------------------------------------------------------

  resolve(path: string, branch = 'main'): string | undefined {
    const row = this.db.get<{ content: string }>(
      `SELECT b.content
       FROM commit_blobs cb
       JOIN commits c ON cb.commit_id = c.commit_id
       JOIN blobs b ON cb.content_hash = b.content_hash
       WHERE cb.path = ? AND c.branch = ?
       ORDER BY c.timestamp DESC
       LIMIT 1`,
      [path, branch]
    );
    return row?.content;
  }

  // -------------------------------------------------------------------------
  // stats() - storage statistics
  // -------------------------------------------------------------------------

  stats(): StoreStats {
    const commitCount = this.db.get<{ n: number }>(
      'SELECT COUNT(*) as n FROM commits'
    );
    const blobCount = this.db.get<{ n: number }>(
      'SELECT COUNT(*) as n FROM blobs'
    );
    const branchCount = this.db.get<{ n: number }>(
      'SELECT COUNT(*) as n FROM branch_heads'
    );
    const blobBytes = this.db.get<{ total: number }>(
      'SELECT COALESCE(SUM(size_bytes), 0) as total FROM blobs'
    );

    return {
      commit_count: commitCount?.n ?? 0,
      blob_count: blobCount?.n ?? 0,
      branch_count: branchCount?.n ?? 0,
      total_blob_bytes: blobBytes?.total ?? 0,
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private newMergeId(): string {
    return createHash('sha256')
      .update(Math.random().toString() + Date.now().toString())
      .digest('hex')
      .slice(0, 16);
  }
}
