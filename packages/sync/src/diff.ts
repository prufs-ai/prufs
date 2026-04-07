/**
 * Commit log diff computation.
 *
 * Given a local log and a cloud log, determine which commits are:
 * - local-only (need to be pushed)
 * - cloud-only (need to be pulled)
 * - in both (no action needed)
 *
 * This operates on commit IDs, which are content-addressed SHA-256 hashes,
 * so equality implies identity.
 */

import type { CommitRef } from "./types.js";

export interface DiffResult {
  /** Commits present locally but not in the cloud. Ordered oldest first for push. */
  toPush: CommitRef[];
  /** Commits present in the cloud but not locally. Ordered oldest first for pull. */
  toPull: CommitRef[];
  /** Commits present in both (by commit_id). */
  inBoth: string[];
}

/**
 * Compute the diff between two commit logs.
 * Both inputs should be ordered oldest-first.
 * Preserves order so that parent commits are always processed before children.
 */
export function computeDiff(local: CommitRef[], cloud: CommitRef[]): DiffResult {
  const localIds = new Set(local.map((c) => c.commit_id));
  const cloudIds = new Set(cloud.map((c) => c.commit_id));

  const toPush: CommitRef[] = [];
  const toPull: CommitRef[] = [];
  const inBoth: string[] = [];

  for (const commit of local) {
    if (cloudIds.has(commit.commit_id)) {
      inBoth.push(commit.commit_id);
    } else {
      toPush.push(commit);
    }
  }

  for (const commit of cloud) {
    if (!localIds.has(commit.commit_id)) {
      toPull.push(commit);
    }
  }

  return { toPush, toPull, inBoth };
}

/**
 * Group commits by branch, preserving within-branch order.
 * Used when the sync engine needs to iterate per-branch for head reconciliation.
 */
export function groupByBranch(commits: CommitRef[]): Map<string, CommitRef[]> {
  const map = new Map<string, CommitRef[]>();
  for (const commit of commits) {
    const existing = map.get(commit.branch);
    if (existing) {
      existing.push(commit);
    } else {
      map.set(commit.branch, [commit]);
    }
  }
  return map;
}
