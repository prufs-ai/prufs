/**
 * @prufs/review - chain.ts
 *
 * ChainVerifier: verifies the integrity of the Prufs commit chain.
 *
 * What it checks per commit:
 *   1. parent_hash linkage   - commit.parent_hash === prior commit's commit_id
 *   2. graph_hash integrity  - SHA-256(canonical(nodes+edges)) matches stored graph_hash
 *   3. tree_hash integrity   - SHA-256(canonical(changed[])) matches stored tree_hash
 *   4. commit_id integrity   - SHA-256(canonical(commit minus commit_id)) matches commit_id
 *
 * Checks 2-4 are pure hash recomputation - they catch any post-store mutation
 * of the commit object (editing the JSON in SQLite directly, for example).
 *
 * Cryptographic signature verification (Ed25519) is intentionally NOT
 * performed here because it requires the signer's public key, which the
 * review layer does not hold. Full signature verification is done by
 * @prufs/commit's verifyCommit() and should be run separately.
 *
 * The ChainVerifier is designed to be called on a schedule (e.g. nightly)
 * as a background integrity sweep, not on every commit write.
 *
 * StoreAdapter interface is duck-typed to avoid a hard dep on @prufs/store.
 */

import { createHash } from 'node:crypto';
import type {
  CausalCommit,
  ChainVerificationReport,
  ChainLinkResult,
  ChainCheckStatus,
  TrailNode,
  TrailEdge,
  ContentBlob,
} from './types.js';

// ---------------------------------------------------------------------------
// Store adapter (duck-typed)
// ---------------------------------------------------------------------------

export interface ChainStoreAdapter {
  log(branch?: string, limit?: number): CausalCommit[];
  head(branch?: string): CausalCommit | undefined;
}

// ---------------------------------------------------------------------------
// Hash recomputation helpers (mirrors @prufs/commit hashing.ts)
// We re-implement rather than import to keep this package self-contained.
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const sorted = Object.keys(obj)
    .sort()
    .map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k]))
    .join(',');
  return '{' + sorted + '}';
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function recomputeGraphHash(nodes: TrailNode[], edges: TrailEdge[]): string {
  const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = [...edges].sort((a, b) => {
    const f = a.from_id.localeCompare(b.from_id);
    return f !== 0 ? f : a.to_id.localeCompare(b.to_id);
  });
  return sha256Hex(canonicalJson({ nodes: sortedNodes, edges: sortedEdges }));
}

function recomputeTreeHash(blobs: ContentBlob[]): string {
  const sortedBlobs = [...blobs].sort((a, b) => a.path.localeCompare(b.path));
  return sha256Hex(canonicalJson({ changed: sortedBlobs }));
}

function recomputeCommitId(commit: CausalCommit): string {
  const { commit_id, ...rest } = commit;
  void commit_id; // excluded from hash
  return sha256Hex(canonicalJson(rest));
}

// ---------------------------------------------------------------------------
// Per-commit link verification
// ---------------------------------------------------------------------------

function verifyLink(
  commit: CausalCommit,
  expectedParentHash: string | null
): ChainLinkResult {
  const errors: string[] = [];

  // 1. Parent hash linkage
  if (expectedParentHash !== null && commit.parent_hash !== expectedParentHash) {
    errors.push(
      `parent_hash mismatch: expected ${expectedParentHash.slice(0, 12)}, ` +
      `got ${commit.parent_hash.slice(0, 12)}`
    );
  }

  // 2. graph_hash integrity
  const recomputedGraph = recomputeGraphHash(
    commit.trail.nodes,
    commit.trail.edges
  );
  if (recomputedGraph !== commit.trail.graph_hash) {
    errors.push(
      `graph_hash tampered: stored ${commit.trail.graph_hash.slice(0, 12)}, ` +
      `recomputed ${recomputedGraph.slice(0, 12)}`
    );
  }

  // 3. tree_hash integrity
  const recomputedTree = recomputeTreeHash(commit.changeset.changed);
  if (recomputedTree !== commit.changeset.tree_hash) {
    errors.push(
      `tree_hash tampered: stored ${commit.changeset.tree_hash.slice(0, 12)}, ` +
      `recomputed ${recomputedTree.slice(0, 12)}`
    );
  }

  // 4. commit_id integrity
  const recomputedId = recomputeCommitId(commit);
  if (recomputedId !== commit.commit_id) {
    errors.push(
      `commit_id tampered: stored ${commit.commit_id.slice(0, 12)}, ` +
      `recomputed ${recomputedId.slice(0, 12)}`
    );
  }

  // Classify status
  let status: ChainCheckStatus = 'ok';
  if (errors.length > 0) {
    // Distinguish chain breaks (parent linkage) from content tampering
    const hasLinkBreak = errors.some((e) => e.startsWith('parent_hash'));
    const hasTampering = errors.some(
      (e) => e.includes('tampered') || e.includes('mismatch') && !e.startsWith('parent_hash')
    );
    if (hasTampering) {
      status = 'tampered';
    } else if (hasLinkBreak) {
      status = 'broken';
    }
  }

  return {
    commit_id: commit.commit_id,
    parent_hash: commit.parent_hash,
    timestamp: commit.timestamp,
    status,
    errors,
  };
}

// ---------------------------------------------------------------------------
// ChainVerifier
// ---------------------------------------------------------------------------

export class ChainVerifier {
  private store: ChainStoreAdapter;

  constructor(store: ChainStoreAdapter) {
    this.store = store;
  }

  /**
   * verify() - sweep the full commit log for a branch.
   *
   * Commits are retrieved oldest-first and verified in chain order.
   * limit controls how many commits to inspect in one sweep.
   * For branches with very long histories, callers should paginate.
   */
  verify(branch = 'main', limit = 1000): ChainVerificationReport {
    const swept_at = new Date().toISOString();

    // Retrieve log (newest first from store), then reverse to oldest-first
    const commits = [...this.store.log(branch, limit)].reverse();

    if (commits.length === 0) {
      return {
        branch,
        swept_at,
        commits_checked: 0,
        chain_intact: true,
        links: [],
        tampered_commits: [],
        broken_links: [],
        summary: `Branch '${branch}' has no commits.`,
      };
    }

    const links: ChainLinkResult[] = [];
    const tampered: string[] = [];
    const broken: string[] = [];

    for (let i = 0; i < commits.length; i++) {
      const commit = commits[i];
      // For the first commit, we do not enforce a specific parent_hash value -
      // we only verify internal hash integrity. The GENESIS_HASH check is
      // handled by @prufs/commit's verifyChain().
      const expectedParent = i === 0 ? null : commits[i - 1].commit_id;

      const link = verifyLink(commit, expectedParent);
      links.push(link);

      if (link.status === 'tampered') tampered.push(commit.commit_id);
      if (link.status === 'broken') broken.push(commit.commit_id);
    }

    const chain_intact = tampered.length === 0 && broken.length === 0;

    let summary: string;
    if (chain_intact) {
      summary =
        `Branch '${branch}': ${commits.length} commit(s) verified, chain intact.`;
    } else {
      const parts: string[] = [];
      if (tampered.length > 0) {
        parts.push(`${tampered.length} tampered commit(s): ${tampered.map((id) => id.slice(0, 12)).join(', ')}`);
      }
      if (broken.length > 0) {
        parts.push(`${broken.length} broken link(s): ${broken.map((id) => id.slice(0, 12)).join(', ')}`);
      }
      summary = `Branch '${branch}': INTEGRITY VIOLATION - ${parts.join('; ')}`;
    }

    return {
      branch,
      swept_at,
      commits_checked: commits.length,
      chain_intact,
      links,
      tampered_commits: tampered,
      broken_links: broken,
      summary,
    };
  }
}
