/**
 * @prufs/store - merge.ts
 *
 * Three-tier CRDT merge engine. Pure functions - no I/O, no database access.
 *
 * Tier 1 - Disjoint auto-merge
 *   Two commits touch entirely different file paths.
 *   Result: automatically merged, no conflicts.
 *
 * Tier 2 - Last-Write-Wins (LWW) auto-merge
 *   Two commits touch overlapping paths, but no path is restricted.
 *   Winner: the commit with the later timestamp for each contested path.
 *   Result: automatically merged using the winning blobs.
 *
 * Tier 3 - Human gate
 *   A contested path is touched by a restricted-sensitivity trail node
 *   (SensitivityLevel === 'restricted') in either commit.
 *   Result: merge blocked, outcome === 'pending_human'.
 *   All restricted-path conflicts surface in MergeResult.conflicts.
 *
 * Design invariant: the merge engine never writes to storage.
 * PrufsStore.merge() drives all DB writes after receiving a MergeResult.
 */

import type { CausalCommit, MergeResult, MergeConflict, MergeStrategy } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the set of paths touched by a commit */
function pathSet(commit: CausalCommit): Set<string> {
  return new Set(commit.changeset.changed.map((b) => b.path));
}

/** Returns paths present in both commits */
function overlappingPaths(a: CausalCommit, b: CausalCommit): string[] {
  const aSet = pathSet(a);
  return b.changeset.changed.map((bl) => bl.path).filter((p) => aSet.has(p));
}

/**
 * A path is restricted if any trail node in the commit has sensitivity
 * === 'restricted'. This is a conservative heuristic: if any reasoning
 * in the commit touched restricted data, the whole commit's file changes
 * are treated as potentially sensitive.
 *
 * Future: per-blob sensitivity tracking (path-to-node mapping in the trail).
 */
function isCommitRestricted(commit: CausalCommit): boolean {
  return commit.trail.nodes.some((n) => n.sensitivity === 'restricted');
}

// ---------------------------------------------------------------------------
// Main merge function
// ---------------------------------------------------------------------------

/**
 * Attempt to merge two CausalCommits using CRDT rules.
 *
 * Both commits must be on the same branch and have the same parent_hash
 * (i.e., they diverged from the same point). For cross-branch merges,
 * the caller is responsible for identifying the common ancestor.
 *
 * Returns a MergeResult describing what happened. The caller (PrufsStore)
 * decides what to write to storage based on the outcome.
 */
export function mergeCommits(
  base: CausalCommit,
  incoming: CausalCommit
): MergeResult {
  const overlap = overlappingPaths(base, incoming);

  // -------------------------------------------------------------------------
  // Tier 1: Disjoint - no overlapping paths
  // -------------------------------------------------------------------------
  if (overlap.length === 0) {
    return {
      outcome: 'merged',
      conflicts: [],
      strategy_used: 'disjoint_auto',
      detail: `Disjoint merge: ${pathSet(base).size} + ${pathSet(incoming).size} paths, no overlap`,
    };
  }

  // -------------------------------------------------------------------------
  // Tier 3 check: any overlapping path from a restricted commit?
  // -------------------------------------------------------------------------
  const baseRestricted = isCommitRestricted(base);
  const incomingRestricted = isCommitRestricted(incoming);

  if (baseRestricted || incomingRestricted) {
    const conflicts: MergeConflict[] = overlap.map((path) => ({
      path,
      strategy: 'human_gate' as MergeStrategy,
      reason: `Restricted-sensitivity trail node detected in ${
        baseRestricted && incomingRestricted
          ? 'both commits'
          : baseRestricted
          ? 'base commit'
          : 'incoming commit'
      } - human review required`,
      source_commits: [base.commit_id, incoming.commit_id],
    }));

    return {
      outcome: 'pending_human',
      conflicts,
      strategy_used: 'human_gate',
      detail: `Human gate: ${conflicts.length} restricted path(s) require review`,
    };
  }

  // -------------------------------------------------------------------------
  // Tier 2: LWW - overlapping paths, no restriction
  // Winner is the commit with the later ISO timestamp.
  // -------------------------------------------------------------------------
  const baseTime = new Date(base.timestamp).getTime();
  const incomingTime = new Date(incoming.timestamp).getTime();
  const winner = incomingTime >= baseTime ? incoming : base;
  const loser = winner === incoming ? base : incoming;

  const lwwConflicts: MergeConflict[] = overlap.map((path) => ({
    path,
    strategy: 'lww_auto' as MergeStrategy,
    reason: `LWW: ${winner.commit_id.slice(0, 12)} (${winner.timestamp}) wins over ${loser.commit_id.slice(0, 12)} (${loser.timestamp})`,
    source_commits: [base.commit_id, incoming.commit_id],
  }));

  return {
    outcome: 'merged',
    merged_commit_id: winner.commit_id,
    conflicts: lwwConflicts,
    strategy_used: 'lww_auto',
    detail: `LWW merge: ${overlap.length} overlapping path(s), winner ${winner.commit_id.slice(0, 12)}`,
  };
}

// ---------------------------------------------------------------------------
// Exported for testing
// ---------------------------------------------------------------------------
export { overlappingPaths, isCommitRestricted, pathSet };
