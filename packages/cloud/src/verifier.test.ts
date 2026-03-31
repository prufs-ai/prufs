/**
 * @prufs/cloud - Verifier tests
 *
 * Tests all 7 verification steps. Pure-function tests - no database required.
 * Uses a helper to build valid commits, then selectively breaks each field.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  verifySchema,
  verifyCommitId,
  verifyTreeHash,
  verifyGraphHash,
  verifyAttestationFields,
  verifyTrailStructure,
  verifyParentChain,
  verifyCommit,
} from './verifier.js';
import { GENESIS_HASH } from './commit-types.js';
import type { CausalCommit, TrailNode, TrailEdge } from './commit-types.js';

// --- Helpers ---

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

/**
 * Build a structurally and cryptographically valid CausalCommit.
 * All hashes are correctly computed.
 */
function buildValidCommit(overrides?: Partial<CausalCommit>): CausalCommit {
  const nodes: TrailNode[] = [
    { id: 'n1', type: 'Directive', text: 'User asked for auth module', timestamp: '2026-03-31T20:00:00Z', sensitivity: 'public' },
    { id: 'n2', type: 'Decision', text: 'Use Ed25519 for signing', timestamp: '2026-03-31T20:00:01Z', sensitivity: 'internal' },
    { id: 'n3', type: 'Implementation', text: 'Implemented key generation', timestamp: '2026-03-31T20:00:02Z', sensitivity: 'public' },
  ];

  const edges: TrailEdge[] = [
    { source: 'n1', target: 'n2', type: 'caused_by' },
    { source: 'n2', target: 'n3', type: 'caused_by' },
  ];

  // Compute graph_hash
  const sortedNodes = [...nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => ({ id: n.id, type: n.type, text: n.text, timestamp: n.timestamp, sensitivity: n.sensitivity }));
  const sortedEdges = [...edges]
    .sort((a, b) => `${a.source}:${a.target}`.localeCompare(`${b.source}:${b.target}`));
  const graph_hash = sha256hex(canonicalize({ nodes: sortedNodes, edges: sortedEdges }));

  const files = [
    { path: 'src/auth.ts', change_type: 'add' as const, content_hash: sha256hex('file content A') },
    { path: 'src/keys.ts', change_type: 'add' as const, content_hash: sha256hex('file content B') },
  ];

  // Compute tree_hash
  const sortedHashes = files.map((f) => `${f.path}:${f.content_hash}`).sort();
  const tree_hash = sha256hex(canonicalize(sortedHashes));

  const trail = { nodes, edges, graph_hash };
  const changeset = { files, tree_hash };
  const attestation = {
    agent_id: 'claude-opus-4-6',
    model_id: 'claude-opus-4-6-20250514',
    session_id: 'sess_abc123',
    prompt_hash: sha256hex('build auth module'),
    signature: 'ed25519sig_placeholder',
    signer_key_id: 'key-001',
  };

  // Build payload for commit_id computation
  const payload = {
    parent_hash: GENESIS_HASH,
    timestamp: '2026-03-31T20:00:00Z',
    trail,
    attestation,
    changeset,
    commit_signature: 'commitsig_placeholder',
    signer_key_id: 'key-001',
    message: 'feat: add auth module',
  };

  const commit_id = sha256hex(canonicalize(payload));

  return {
    commit_id,
    parent_hash: GENESIS_HASH,
    timestamp: '2026-03-31T20:00:00Z',
    trail,
    attestation,
    changeset,
    commit_signature: 'commitsig_placeholder',
    signer_key_id: 'key-001',
    message: 'feat: add auth module',
    ...overrides,
  };
}

// --- Tests ---

describe('Verifier - Step 1: Schema validation', () => {
  it('accepts a valid commit', () => {
    const commit = buildValidCommit();
    const result = verifySchema(commit);
    assert.ok(result.valid);
  });

  it('rejects null', () => {
    const result = verifySchema(null);
    assert.ok(!result.valid);
    assert.equal(result.step, 'schema');
  });

  it('rejects missing commit_id', () => {
    const commit = buildValidCommit();
    (commit as any).commit_id = '';
    const result = verifySchema(commit);
    assert.ok(!result.valid);
    assert.match(result.message!, /commit_id/);
  });

  it('rejects missing trail', () => {
    const commit = buildValidCommit();
    (commit as any).trail = null;
    const result = verifySchema(commit);
    assert.ok(!result.valid);
    assert.match(result.message!, /trail/);
  });

  it('rejects missing changeset.files array', () => {
    const commit = buildValidCommit();
    (commit as any).changeset.files = 'not-an-array';
    const result = verifySchema(commit);
    assert.ok(!result.valid);
  });

  it('rejects missing attestation', () => {
    const commit = buildValidCommit();
    (commit as any).attestation = null;
    const result = verifySchema(commit);
    assert.ok(!result.valid);
  });
});

describe('Verifier - Step 2: commit_id verification', () => {
  it('passes for correctly computed commit_id', () => {
    const commit = buildValidCommit();
    const result = verifyCommitId(commit);
    assert.ok(result.valid);
  });

  it('fails for tampered commit_id', () => {
    const commit = buildValidCommit();
    commit.commit_id = 'deadbeef'.repeat(8);
    const result = verifyCommitId(commit);
    assert.ok(!result.valid);
    assert.equal(result.step, 'commit_id');
  });
});

describe('Verifier - Step 3: tree_hash verification', () => {
  it('passes for correctly computed tree_hash', () => {
    const commit = buildValidCommit();
    const result = verifyTreeHash(commit);
    assert.ok(result.valid);
  });

  it('fails when tree_hash is tampered', () => {
    const commit = buildValidCommit();
    commit.changeset.tree_hash = 'badhash'.repeat(9).slice(0, 64);
    // Also need to recompute commit_id with the bad tree_hash to isolate this test
    const result = verifyTreeHash(commit);
    assert.ok(!result.valid);
    assert.equal(result.step, 'tree_hash');
  });
});

describe('Verifier - Step 4: graph_hash verification', () => {
  it('passes for correctly computed graph_hash', () => {
    const commit = buildValidCommit();
    const result = verifyGraphHash(commit);
    assert.ok(result.valid);
  });

  it('fails when graph_hash is tampered', () => {
    const commit = buildValidCommit();
    commit.trail.graph_hash = 'badhash'.repeat(9).slice(0, 64);
    const result = verifyGraphHash(commit);
    assert.ok(!result.valid);
    assert.equal(result.step, 'graph_hash');
  });
});

describe('Verifier - Step 5: Attestation fields', () => {
  it('passes with all fields present', () => {
    const commit = buildValidCommit();
    const result = verifyAttestationFields(commit);
    assert.ok(result.valid);
  });

  it('fails with missing agent_id', () => {
    const commit = buildValidCommit();
    (commit.attestation as any).agent_id = '';
    const result = verifyAttestationFields(commit);
    assert.ok(!result.valid);
    assert.match(result.message!, /agent_id/);
  });

  it('fails with missing model_id', () => {
    const commit = buildValidCommit();
    (commit.attestation as any).model_id = '';
    const result = verifyAttestationFields(commit);
    assert.ok(!result.valid);
    assert.match(result.message!, /model_id/);
  });

  it('fails with missing session_id', () => {
    const commit = buildValidCommit();
    (commit.attestation as any).session_id = '';
    const result = verifyAttestationFields(commit);
    assert.ok(!result.valid);
  });

  it('fails with missing prompt_hash', () => {
    const commit = buildValidCommit();
    (commit.attestation as any).prompt_hash = '';
    const result = verifyAttestationFields(commit);
    assert.ok(!result.valid);
  });
});

describe('Verifier - Step 6: Trail structure', () => {
  it('passes with valid structure', () => {
    const commit = buildValidCommit();
    const result = verifyTrailStructure(commit);
    assert.ok(result.valid);
  });

  it('fails with no Decision node', () => {
    const commit = buildValidCommit();
    // Replace Decision with Directive
    commit.trail.nodes = commit.trail.nodes.map((n) =>
      n.type === 'Decision' ? { ...n, type: 'Directive' as const } : n,
    );
    const result = verifyTrailStructure(commit);
    assert.ok(!result.valid);
    assert.match(result.message!, /Decision/);
  });

  it('fails with invalid node type', () => {
    const commit = buildValidCommit();
    (commit.trail.nodes[0] as any).type = 'InvalidType';
    const result = verifyTrailStructure(commit);
    assert.ok(!result.valid);
    assert.match(result.message!, /Invalid node type/);
  });

  it('fails with invalid edge type', () => {
    const commit = buildValidCommit();
    (commit.trail.edges[0] as any).type = 'invalid_edge';
    const result = verifyTrailStructure(commit);
    assert.ok(!result.valid);
    assert.match(result.message!, /Invalid edge type/);
  });

  it('fails with orphan edge source', () => {
    const commit = buildValidCommit();
    commit.trail.edges.push({ source: 'nonexistent', target: 'n1', type: 'caused_by' });
    const result = verifyTrailStructure(commit);
    assert.ok(!result.valid);
    assert.match(result.message!, /Orphan edge/);
  });

  it('fails with orphan edge target', () => {
    const commit = buildValidCommit();
    commit.trail.edges.push({ source: 'n1', target: 'ghost', type: 'caused_by' });
    const result = verifyTrailStructure(commit);
    assert.ok(!result.valid);
    assert.match(result.message!, /Orphan edge/);
  });
});

describe('Verifier - Step 7: Parent chain', () => {
  it('passes for genesis commit', async () => {
    const commit = buildValidCommit();
    const result = await verifyParentChain(commit, async () => false);
    assert.ok(result.valid);
  });

  it('passes when parent exists', async () => {
    const commit = buildValidCommit();
    commit.parent_hash = 'abc123'.repeat(10).slice(0, 64);
    const result = await verifyParentChain(commit, async (id) => id === commit.parent_hash);
    assert.ok(result.valid);
  });

  it('fails when parent does not exist', async () => {
    const commit = buildValidCommit();
    commit.parent_hash = 'missing'.repeat(9).slice(0, 64);
    const result = await verifyParentChain(commit, async () => false);
    assert.ok(!result.valid);
    assert.equal(result.step, 'parent_chain');
  });
});

describe('Verifier - Full pipeline', () => {
  it('accepts a fully valid genesis commit', async () => {
    const commit = buildValidCommit();
    const result = await verifyCommit(commit, {
      commitExists: async () => false,
    });
    assert.ok(result.valid, `Expected valid but got: ${result.message}`);
  });

  it('rejects a commit with tampered message', async () => {
    const commit = buildValidCommit();
    commit.message = 'tampered message';
    // commit_id was computed with original message, so step 2 should catch it
    const result = await verifyCommit(commit, {
      commitExists: async () => false,
    });
    assert.ok(!result.valid);
    assert.equal(result.step, 'commit_id');
  });

  it('rejects null input at schema step', async () => {
    const result = await verifyCommit(null, {
      commitExists: async () => false,
    });
    assert.ok(!result.valid);
    assert.equal(result.step, 'schema');
  });
});
