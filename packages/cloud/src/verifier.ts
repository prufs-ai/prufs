/**
 * @prufs/cloud - Verifier
 *
 * Stateless verification pipeline for inbound CausalCommits.
 * Every commit must pass all steps before being accepted into storage.
 *
 * Steps (fail-fast):
 *   1. Schema validation - all required fields present, correct types
 *   2. commit_id recomputation - SHA-256 of canonical commit payload
 *   3. tree_hash recomputation - SHA-256 of sorted file hashes
 *   4. graph_hash recomputation - SHA-256 of sorted nodes + edges
 *   5. Attestation fields present - agent_id, model_id, session_id, prompt_hash
 *   6. Trail structure - at least one Decision node, no orphan edges, valid types
 *   7. Parent chain check - parent exists in store (unless genesis)
 *
 * Note: Ed25519 signature verification (attestation sig + commit sig) is
 * deferred to Phase 3B when the signing key lookup is wired to the
 * registered keys in Postgres. The structural and hash checks here catch
 * any tampered or malformed commits without needing the public key.
 */

import { createHash } from 'node:crypto';
import type {
  CausalCommit,
  VerificationResult,
  VerificationStep,
  TrailNode,
  TrailEdge,
} from './commit-types.js';
import {
  GENESIS_HASH,
  VALID_NODE_TYPES,
  VALID_EDGE_TYPES,
} from './commit-types.js';

// --- Canonical JSON (sorted keys, no whitespace) ---

function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalize).join(',') + ']';
  }
  if (typeof obj === 'object') {
    const sorted = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = sorted.map(
      (k) => JSON.stringify(k) + ':' + canonicalize((obj as Record<string, unknown>)[k]),
    );
    return '{' + pairs.join(',') + '}';
  }
  return String(obj);
}

function sha256hex(data: string): string {
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

// --- Individual verification steps ---

function fail(step: VerificationStep, message: string, expected?: string, actual?: string): VerificationResult {
  return { valid: false, step, message, expected, actual };
}

function pass(): VerificationResult {
  return { valid: true };
}

/**
 * Step 1: Schema validation - check all required fields exist and have correct types.
 */
export function verifySchema(commit: any): VerificationResult {
  if (!commit || typeof commit !== 'object') {
    return fail('schema', 'Commit must be a non-null object.');
  }

  const requiredStrings = [
    'commit_id', 'parent_hash', 'timestamp',
    'commit_signature', 'signer_key_id', 'message',
  ];
  for (const field of requiredStrings) {
    if (typeof commit[field] !== 'string' || commit[field].length === 0) {
      return fail('schema', `Missing or empty required field: ${field}`);
    }
  }

  if (!commit.trail || typeof commit.trail !== 'object') {
    return fail('schema', 'Missing trail object.');
  }
  if (!Array.isArray(commit.trail.nodes)) {
    return fail('schema', 'trail.nodes must be an array.');
  }
  if (!Array.isArray(commit.trail.edges)) {
    return fail('schema', 'trail.edges must be an array.');
  }
  if (typeof commit.trail.graph_hash !== 'string') {
    return fail('schema', 'Missing trail.graph_hash.');
  }

  if (!commit.attestation || typeof commit.attestation !== 'object') {
    return fail('schema', 'Missing attestation object.');
  }

  if (!commit.changeset || typeof commit.changeset !== 'object') {
    return fail('schema', 'Missing changeset object.');
  }
  if (!Array.isArray(commit.changeset.files)) {
    return fail('schema', 'changeset.files must be an array.');
  }
  if (typeof commit.changeset.tree_hash !== 'string') {
    return fail('schema', 'Missing changeset.tree_hash.');
  }

  return pass();
}

/**
 * Step 2: Recompute commit_id as SHA-256 of canonical commit (excluding commit_id itself).
 */
export function verifyCommitId(commit: CausalCommit): VerificationResult {
  const payload = {
    parent_hash: commit.parent_hash,
    timestamp: commit.timestamp,
    trail: commit.trail,
    attestation: commit.attestation,
    changeset: commit.changeset,
    commit_signature: commit.commit_signature,
    signer_key_id: commit.signer_key_id,
    message: commit.message,
    ...(commit.branch ? { branch: commit.branch } : {}),
  };

  const expected = sha256hex(canonicalize(payload));
  if (expected !== commit.commit_id) {
    return fail('commit_id', 'commit_id does not match SHA-256 of canonical payload.',
      expected, commit.commit_id);
  }
  return pass();
}

/**
 * Step 3: Recompute tree_hash from changeset files.
 */
export function verifyTreeHash(commit: CausalCommit): VerificationResult {
  const sortedHashes = commit.changeset.files
    .map((f) => `${f.path}:${f.content_hash}`)
    .sort();
  const expected = sha256hex(canonicalize(sortedHashes));

  if (expected !== commit.changeset.tree_hash) {
    return fail('tree_hash', 'tree_hash does not match recomputed value.',
      expected, commit.changeset.tree_hash);
  }
  return pass();
}

/**
 * Step 4: Recompute graph_hash from trail nodes and edges.
 */
export function verifyGraphHash(commit: CausalCommit): VerificationResult {
  const sortedNodes = [...commit.trail.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => ({ id: n.id, type: n.type, text: n.text, timestamp: n.timestamp, sensitivity: n.sensitivity }));

  const sortedEdges = [...commit.trail.edges]
    .sort((a, b) => `${a.source}:${a.target}`.localeCompare(`${b.source}:${b.target}`));

  const expected = sha256hex(canonicalize({ nodes: sortedNodes, edges: sortedEdges }));

  if (expected !== commit.trail.graph_hash) {
    return fail('graph_hash', 'graph_hash does not match recomputed value.',
      expected, commit.trail.graph_hash);
  }
  return pass();
}

/**
 * Step 5: Attestation fields must all be present and non-empty.
 */
export function verifyAttestationFields(commit: CausalCommit): VerificationResult {
  const required = ['agent_id', 'model_id', 'session_id', 'prompt_hash'];
  for (const field of required) {
    const val = (commit.attestation as any)[field];
    if (typeof val !== 'string' || val.length === 0) {
      return fail('attestation_fields', `Missing or empty attestation field: ${field}`);
    }
  }
  return pass();
}

/**
 * Step 6: Trail structure checks.
 *   - At least one Decision node
 *   - All node types are valid
 *   - All edge types are valid
 *   - No orphan edges (source and target must reference existing node IDs)
 */
export function verifyTrailStructure(commit: CausalCommit): VerificationResult {
  const nodes = commit.trail.nodes;
  const edges = commit.trail.edges;

  // Check node types
  for (const node of nodes) {
    if (!VALID_NODE_TYPES.has(node.type)) {
      return fail('trail_structure', `Invalid node type: ${node.type}`);
    }
  }

  // At least one Decision node
  const hasDecision = nodes.some((n) => n.type === 'Decision');
  if (!hasDecision) {
    return fail('trail_structure', 'Trail must contain at least one Decision node.');
  }

  // Check edge types
  for (const edge of edges) {
    if (!VALID_EDGE_TYPES.has(edge.type)) {
      return fail('trail_structure', `Invalid edge type: ${edge.type}`);
    }
  }

  // No orphan edges
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      return fail('trail_structure', `Orphan edge: source "${edge.source}" not found in nodes.`);
    }
    if (!nodeIds.has(edge.target)) {
      return fail('trail_structure', `Orphan edge: target "${edge.target}" not found in nodes.`);
    }
  }

  return pass();
}

/**
 * Step 7: Parent chain check.
 * Genesis commits (parent_hash = GENESIS_HASH) skip this.
 * All others must have a parent that already exists in the store.
 *
 * This step requires a lookup function that checks the commits table.
 */
export async function verifyParentChain(
  commit: CausalCommit,
  parentExists: (commitId: string) => Promise<boolean>,
): Promise<VerificationResult> {
  if (commit.parent_hash === GENESIS_HASH) {
    return pass();
  }

  const exists = await parentExists(commit.parent_hash);
  if (!exists) {
    return fail('parent_chain',
      `Parent commit not found: ${commit.parent_hash}. Cannot accept orphan commits.`,
      'existing commit', 'missing');
  }
  return pass();
}

// --- Full verification pipeline ---

export interface VerifyOptions {
  /** Check if a commit_id exists in the store. Required for parent chain verification. */
  commitExists: (commitId: string) => Promise<boolean>;
}

/**
 * Run the full verification pipeline on an inbound CausalCommit.
 * Fail-fast: returns the first failure encountered.
 */
export async function verifyCommit(
  rawCommit: unknown,
  options: VerifyOptions,
): Promise<VerificationResult> {
  // Step 1: Schema
  const schemaResult = verifySchema(rawCommit);
  if (!schemaResult.valid) return schemaResult;

  const commit = rawCommit as CausalCommit;

  // Step 2: commit_id
  const idResult = verifyCommitId(commit);
  if (!idResult.valid) return idResult;

  // Step 3: tree_hash
  const treeResult = verifyTreeHash(commit);
  if (!treeResult.valid) return treeResult;

  // Step 4: graph_hash
  const graphResult = verifyGraphHash(commit);
  if (!graphResult.valid) return graphResult;

  // Step 5: attestation fields
  const attestResult = verifyAttestationFields(commit);
  if (!attestResult.valid) return attestResult;

  // Step 6: trail structure
  const trailResult = verifyTrailStructure(commit);
  if (!trailResult.valid) return trailResult;

  // Step 7: parent chain
  const parentResult = await verifyParentChain(commit, options.commitExists);
  if (!parentResult.valid) return parentResult;

  return pass();
}
