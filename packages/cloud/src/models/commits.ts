/**
 * @prufs/cloud - Commit storage
 *
 * After a CausalCommit passes verification, it lands here.
 * Stores commit metadata in Postgres and updates branch heads.
 */

import { query, transaction } from '../db.js';
import type { CausalCommit } from '../commit-types.js';

export interface StoredCommit {
  commit_id: string;
  org_id: string;
  parent_hash: string;
  branch: string;
  agent_id: string | null;
  message: string;
  timestamp: string;
  verified_at: string;
  size_bytes: number | null;
  signer_key_id: string | null;
}

/**
 * Store a verified commit and update the branch head.
 * Idempotent: if commit_id already exists, returns false (skip).
 */
export async function storeCommit(
  orgId: string,
  commit: CausalCommit,
): Promise<{ stored: boolean; commit_id: string }> {
  return transaction(async (client) => {
    // Check idempotency
    const existing = await client.query(
      'SELECT commit_id FROM commits WHERE commit_id = $1',
      [commit.commit_id],
    );
    if (existing.rows.length > 0) {
      return { stored: false, commit_id: commit.commit_id };
    }

    // Compute payload size
    const sizeBytes = Buffer.byteLength(JSON.stringify(commit), 'utf-8');

    // Insert commit metadata
    await client.query(
      `INSERT INTO commits (commit_id, org_id, parent_hash, branch, agent_id, message, timestamp, size_bytes, signer_key_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        commit.commit_id,
        orgId,
        commit.parent_hash,
        commit.branch ?? 'main',
        commit.attestation.agent_id,
        commit.message,
        commit.timestamp,
        sizeBytes,
        commit.signer_key_id,
      ],
    );

    // Upsert branch head
    await client.query(
      `INSERT INTO branch_heads (org_id, branch, commit_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, branch)
       DO UPDATE SET commit_id = $3, updated_at = NOW()`,
      [orgId, commit.branch ?? 'main', commit.commit_id],
    );

    return { stored: true, commit_id: commit.commit_id };
  });
}

/**
 * Check if a commit exists for a given org.
 */
export async function commitExists(orgId: string, commitId: string): Promise<boolean> {
  const result = await query(
    'SELECT 1 FROM commits WHERE commit_id = $1 AND org_id = $2',
    [commitId, orgId],
  );
  return result.rows.length > 0;
}

/**
 * Get commit log for a branch.
 */
export async function getCommitLog(
  orgId: string,
  branch: string = 'main',
  limit: number = 50,
): Promise<StoredCommit[]> {
  const result = await query<StoredCommit>(
    `SELECT * FROM commits
     WHERE org_id = $1 AND branch = $2
     ORDER BY timestamp DESC
     LIMIT $3`,
    [orgId, branch, limit],
  );
  return result.rows;
}

/**
 * Get branch heads for an org.
 */
export async function getBranchHeads(
  orgId: string,
): Promise<Array<{ branch: string; commit_id: string; updated_at: string }>> {
  const result = await query(
    `SELECT branch, commit_id, updated_at FROM branch_heads
     WHERE org_id = $1
     ORDER BY updated_at DESC`,
    [orgId],
  );
  return result.rows;
}

/**
 * Get a single commit by ID (with org scoping).
 */
export async function getCommit(orgId: string, commitId: string): Promise<StoredCommit | null> {
  const result = await query<StoredCommit>(
    'SELECT * FROM commits WHERE commit_id = $1 AND org_id = $2',
    [commitId, orgId],
  );
  return result.rows[0] ?? null;
}
