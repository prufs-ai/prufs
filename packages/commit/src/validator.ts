/**
 * @prufs/commit - validator.ts
 *
 * Two validation surfaces:
 *
 *   validateCommitInput()  - pre-build, structural checks on CommitInput
 *   verifyCommit()         - post-build, cryptographic verification of a
 *                            CausalCommit received from any source
 *
 * The three invariants that make Prufs different from Git:
 *   1. graph_hash must match the actual trail nodes + edges
 *   2. The trail must contain at least one Decision node
 *   3. commit_signature must verify against the public key
 */

import * as ed from '@noble/ed25519';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import { sha512 } from '@noble/hashes/sha512';
import type { CausalCommit, CommitInput, CommitVerification } from './types.js';
import {
  computeGraphHash,
  computeTreeHash,
  attestationPreimage,
  commitSignaturePreimage,
  computeCommitId,
} from './hashing.js';
import { GENESIS_HASH } from './types.js';

ed.etc.sha512Sync = (... m: Parameters<typeof sha512>) => sha512(...m);

// ---------------------------------------------------------------------------
// Pre-build input validation
// ---------------------------------------------------------------------------

export function validateCommitInput(input: CommitInput): string[] {
  const errors: string[] = [];

  if (!input.parent_hash) {
    errors.push('parent_hash is required (use GENESIS_HASH for first commit)');
  }

  if (!input.trail.nodes || input.trail.nodes.length === 0) {
    errors.push('trail must contain at least one node');
  } else {
    const hasDecision = input.trail.nodes.some((n) => n.type === 'Decision');
    if (!hasDecision) {
      errors.push(
        'trail must contain at least one Decision node - no trail, no commit'
      );
    }
  }

  if (!input.changeset.changed || input.changeset.changed.length === 0) {
    errors.push('changeset must contain at least one file change');
  }

  for (const blob of input.changeset.changed ?? []) {
    if (!blob.path) errors.push('each ContentBlob must have a path');
    if (!blob.content_hash) errors.push(`blob ${blob.path}: content_hash required`);
    if (!blob.change_type) errors.push(`blob ${blob.path}: change_type required`);
  }

  if (!input.attestation.agent_id) errors.push('attestation.agent_id is required');
  if (!input.attestation.model_id) errors.push('attestation.model_id is required');
  if (!input.attestation.session_id) errors.push('attestation.session_id is required');

  for (const node of input.trail.nodes ?? []) {
    if (!node.id) errors.push('each TrailNode must have an id');
    if (!node.type) errors.push(`node ${node.id}: type is required`);
    if (!node.content) errors.push(`node ${node.id}: content is required`);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Post-build cryptographic verification
// ---------------------------------------------------------------------------

export async function verifyCommit(
  commit: CausalCommit,
  publicKeyHex: string
): Promise<CommitVerification> {
  const errors: string[] = [];
  const checks: CommitVerification['checks'] = {
    graph_hash_valid: false,
    tree_hash_valid: false,
    attestation_sig_valid: false,
    commit_sig_valid: false,
    has_decision_node: false,
    parent_hash_present: false,
  };

  // 1. parent_hash present
  checks.parent_hash_present =
    !!commit.parent_hash &&
    (commit.parent_hash === GENESIS_HASH || commit.parent_hash.length === 64);
  if (!checks.parent_hash_present) {
    errors.push('parent_hash is missing or malformed');
  }

  // 2. graph_hash integrity
  const recomputedGraphHash = computeGraphHash(
    commit.trail.nodes,
    commit.trail.edges
  );
  checks.graph_hash_valid = recomputedGraphHash === commit.trail.graph_hash;
  if (!checks.graph_hash_valid) {
    errors.push(
      `graph_hash mismatch: expected ${recomputedGraphHash}, got ${commit.trail.graph_hash}`
    );
  }

  // 3. tree_hash integrity
  const recomputedTreeHash = computeTreeHash(commit.changeset.changed);
  checks.tree_hash_valid = recomputedTreeHash === commit.changeset.tree_hash;
  if (!checks.tree_hash_valid) {
    errors.push(
      `tree_hash mismatch: expected ${recomputedTreeHash}, got ${commit.changeset.tree_hash}`
    );
  }

  // 4. Decision node present
  checks.has_decision_node = commit.trail.nodes.some((n) => n.type === 'Decision');
  if (!checks.has_decision_node) {
    errors.push('trail contains no Decision node - commit is unjustified');
  }

  // 5. Attestation signature
  try {
    const attPreimage = attestationPreimage(
      commit.attestation.agent_id,
      commit.attestation.model_id,
      commit.attestation.session_id,
      commit.attestation.prompt_hash
    );
    checks.attestation_sig_valid = await ed.verifyAsync(
      hexToBytes(commit.attestation.signature),
      hexToBytes(attPreimage),
      hexToBytes(publicKeyHex)
    );
    if (!checks.attestation_sig_valid) {
      errors.push('attestation signature invalid');
    }
  } catch (e) {
    checks.attestation_sig_valid = false;
    errors.push(`attestation signature error: ${(e as Error).message}`);
  }

  // 6. Commit signature (binds what to why)
  try {
    const commitPreimage = commitSignaturePreimage(
      commit.changeset.tree_hash,
      commit.trail.graph_hash,
      commit.parent_hash,
      commit.attestation.agent_id,
      commit.timestamp
    );
    checks.commit_sig_valid = await ed.verifyAsync(
      hexToBytes(commit.commit_signature),
      hexToBytes(commitPreimage),
      hexToBytes(publicKeyHex)
    );
    if (!checks.commit_sig_valid) {
      errors.push('commit signature invalid - content may have been tampered with');
    }
  } catch (e) {
    checks.commit_sig_valid = false;
    errors.push(`commit signature error: ${(e as Error).message}`);
  }

  return {
    valid: errors.length === 0,
    commit_id: commit.commit_id,
    checks,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Verify a chain of commits (oldest first)
// ---------------------------------------------------------------------------

export async function verifyChain(
  commits: CausalCommit[],
  publicKeyHex: string
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const result = await verifyCommit(commit, publicKeyHex);
    if (!result.valid) {
      errors.push(`Commit ${commit.commit_id.slice(0, 12)}: ${result.errors.join('; ')}`);
    }

    if (i > 0) {
      const expected = commits[i - 1].commit_id;
      if (commit.parent_hash !== expected) {
        errors.push(
          `Commit ${commit.commit_id.slice(0, 12)}: parent_hash ${commit.parent_hash.slice(0, 12)} does not match prior commit ${expected.slice(0, 12)}`
        );
      }
    } else {
      if (commit.parent_hash !== GENESIS_HASH) {
        errors.push(
          `First commit ${commit.commit_id.slice(0, 12)}: parent_hash should be GENESIS_HASH`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
