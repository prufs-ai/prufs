/**
 * @prufs/commit - commit.test.ts
 *
 * 24 tests, 6 suites - matches Phase 1 test discipline.
 *
 * Run after build:
 *   node --test dist/commit.test.js
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCommit,
  generateKeypair,
  keypairFromHex,
  keypairToHex,
  verifyCommit,
  verifyChain,
  validateCommitInput,
  buildTrailSnapshot,
  buildFileChangeset,
  computeBlobHash,
  canonicalJson,
  sha256Hex,
  GENESIS_HASH,
} from './index.js';

import type {
  CommitInput,
  TrailNode,
  TrailEdge,
  ContentBlob,
  CausalCommit,
  SigningKeypair,
} from './index.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeNodes(): TrailNode[] {
  return [
    {
      id: 'node-1',
      type: 'Directive',
      content: 'Refactor authentication to use OAuth 2.0 PKCE flow',
      sensitivity: 'restricted',
      timestamp: '2026-03-30T10:00:00.000Z',
    },
    {
      id: 'node-2',
      type: 'Decision',
      content: 'Use PKCE over implicit flow to eliminate token exposure in URL fragments',
      sensitivity: 'restricted',
      timestamp: '2026-03-30T10:00:01.000Z',
    },
    {
      id: 'node-3',
      type: 'Constraint',
      content: 'Must remain backward compatible with existing session cookies',
      sensitivity: 'internal',
      timestamp: '2026-03-30T10:00:02.000Z',
    },
    {
      id: 'node-4',
      type: 'Implementation',
      content: 'Added pkce.ts with generateCodeChallenge() and verifyCodeVerifier()',
      sensitivity: 'internal',
      timestamp: '2026-03-30T10:00:10.000Z',
    },
  ];
}

function makeEdges(): TrailEdge[] {
  return [
    { from_id: 'node-2', to_id: 'node-1', type: 'caused_by' },
    { from_id: 'node-4', to_id: 'node-2', type: 'caused_by' },
    { from_id: 'node-4', to_id: 'node-3', type: 'constrained_by' },
  ];
}

function makeBlobs(): ContentBlob[] {
  return [
    {
      path: 'src/auth/pkce.ts',
      content_hash: computeBlobHash('export function generateCodeChallenge() {}'),
      content: 'export function generateCodeChallenge() {}',
      change_type: 'added',
    },
    {
      path: 'src/auth/session.ts',
      content_hash: computeBlobHash('// updated session handler'),
      content: '// updated session handler',
      change_type: 'modified',
    },
  ];
}

function makeCommitInput(parentHash = GENESIS_HASH): CommitInput {
  return {
    parent_hash: parentHash,
    trail: { nodes: makeNodes(), edges: makeEdges() },
    attestation: {
      agent_id: 'claude-code-prufs-hook',
      model_id: 'claude-sonnet-4-6',
      session_id: 'sess-abc123',
    },
    changeset: { changed: makeBlobs() },
    message: 'refactor: migrate auth to OAuth 2.0 PKCE',
    branch: 'main',
  };
}

// ---------------------------------------------------------------------------
// Suite 1: Hashing primitives
// ---------------------------------------------------------------------------

describe('Hashing primitives', () => {
  it('canonicalJson sorts keys deterministically', () => {
    const a = canonicalJson({ z: 1, a: 2, m: 3 });
    const b = canonicalJson({ m: 3, z: 1, a: 2 });
    assert.equal(a, b);
    assert.ok(a.indexOf('"a"') < a.indexOf('"m"'));
    assert.ok(a.indexOf('"m"') < a.indexOf('"z"'));
  });

  it('canonicalJson handles nested objects and arrays', () => {
    const result = canonicalJson({ b: [3, 1, 2], a: { z: 'x', a: 'y' } });
    assert.ok(result.includes('"a":{"a":"y","z":"x"}'));
    assert.ok(result.includes('"b":[3,1,2]'));
  });

  it('sha256Hex produces 64-char hex string', () => {
    const hash = sha256Hex('hello prufs');
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]+$/);
  });

  it('sha256Hex is deterministic', () => {
    assert.equal(sha256Hex('test'), sha256Hex('test'));
    assert.notEqual(sha256Hex('test'), sha256Hex('Test'));
  });
});

// ---------------------------------------------------------------------------
// Suite 2: TrailSnapshot and FileChangeset builders
// ---------------------------------------------------------------------------

describe('Snapshot builders', () => {
  it('buildTrailSnapshot computes graph_hash and sorts nodes by id', () => {
    const nodes = makeNodes().reverse();
    const edges = makeEdges();
    const snapshot = buildTrailSnapshot(nodes, edges);
    assert.equal(snapshot.graph_hash.length, 64);
    assert.equal(snapshot.nodes[0].id, 'node-1');
    assert.equal(snapshot.nodes[3].id, 'node-4');
  });

  it('buildTrailSnapshot is deterministic regardless of input order', () => {
    const s1 = buildTrailSnapshot(makeNodes(), makeEdges());
    const s2 = buildTrailSnapshot(makeNodes().reverse(), makeEdges().reverse());
    assert.equal(s1.graph_hash, s2.graph_hash);
  });

  it('buildFileChangeset computes tree_hash and sorts blobs by path', () => {
    const blobs = makeBlobs().reverse();
    const cs = buildFileChangeset(blobs);
    assert.equal(cs.tree_hash.length, 64);
    assert.equal(cs.changed[0].path, 'src/auth/pkce.ts');
  });

  it('computeBlobHash matches sha256Hex of content', () => {
    const content = 'export const x = 1;';
    assert.equal(computeBlobHash(content), sha256Hex(content));
  });
});

// ---------------------------------------------------------------------------
// Suite 3: CommitInput validation
// ---------------------------------------------------------------------------

describe('CommitInput validation', () => {
  it('accepts valid input with no errors', () => {
    const errors = validateCommitInput(makeCommitInput());
    assert.equal(errors.length, 0);
  });

  it('rejects input with no Decision node', () => {
    const input = makeCommitInput();
    input.trail.nodes = input.trail.nodes.filter((n) => n.type !== 'Decision');
    const errors = validateCommitInput(input);
    assert.ok(errors.some((e) => e.includes('Decision')));
  });

  it('rejects input with empty changeset', () => {
    const input = makeCommitInput();
    input.changeset.changed = [];
    const errors = validateCommitInput(input);
    assert.ok(errors.some((e) => e.includes('changeset')));
  });

  it('rejects input missing agent_id', () => {
    const input = makeCommitInput();
    (input.attestation as any).agent_id = '';
    const errors = validateCommitInput(input);
    assert.ok(errors.some((e) => e.includes('agent_id')));
  });
});

// ---------------------------------------------------------------------------
// Suite 4: buildCommit - structure and fields
// ---------------------------------------------------------------------------

describe('buildCommit structure', () => {
  let keypair: SigningKeypair;
  let commit: CausalCommit;

  before(async () => {
    keypair = await generateKeypair();
    commit = await buildCommit(makeCommitInput(), keypair);
  });

  it('produces a 64-char commit_id', () => {
    assert.equal(commit.commit_id.length, 64);
    assert.match(commit.commit_id, /^[0-9a-f]+$/);
  });

  it('sets parent_hash to GENESIS_HASH for first commit', () => {
    assert.equal(commit.parent_hash, GENESIS_HASH);
  });

  it('embeds graph_hash in trail', () => {
    assert.equal(commit.trail.graph_hash.length, 64);
  });

  it('embeds tree_hash in changeset', () => {
    assert.equal(commit.changeset.tree_hash.length, 64);
  });

  it('populates attestation fields', () => {
    assert.equal(commit.attestation.agent_id, 'claude-code-prufs-hook');
    assert.equal(commit.attestation.model_id, 'claude-sonnet-4-6');
    assert.equal(commit.attestation.session_id, 'sess-abc123');
    assert.equal(commit.attestation.signer_key_id, keypair.key_id);
  });

  it('uses provided message', () => {
    assert.equal(commit.message, 'refactor: migrate auth to OAuth 2.0 PKCE');
  });

  it('rejects CommitInput with no Decision node at build time', async () => {
    const input = makeCommitInput();
    input.trail.nodes = input.trail.nodes.filter((n) => n.type !== 'Decision');
    await assert.rejects(
      () => buildCommit(input, keypair),
      /Decision node/
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 5: Cryptographic verification
// ---------------------------------------------------------------------------

describe('Cryptographic verification', () => {
  let keypair: SigningKeypair;
  let commit: CausalCommit;

  before(async () => {
    keypair = await generateKeypair();
    commit = await buildCommit(makeCommitInput(), keypair);
  });

  it('verifies a freshly built commit as valid', async () => {
    const pubKeyHex = keypairToHex(keypairFromHex(keypairToHex(keypair)));
    const result = await verifyCommit(
      commit,
      require('@noble/hashes/utils').bytesToHex(keypair.publicKey)
    );
    assert.ok(result.valid, `Expected valid, got errors: ${result.errors.join(', ')}`);
    assert.ok(result.checks.graph_hash_valid);
    assert.ok(result.checks.tree_hash_valid);
    assert.ok(result.checks.has_decision_node);
    assert.ok(result.checks.commit_sig_valid);
    assert.ok(result.checks.attestation_sig_valid);
  });

  it('detects tampered trail node content', async () => {
    const tampered = JSON.parse(JSON.stringify(commit)) as CausalCommit;
    tampered.trail.nodes[0].content = 'TAMPERED';
    const { bytesToHex } = require('@noble/hashes/utils');
    const result = await verifyCommit(tampered, bytesToHex(keypair.publicKey));
    assert.ok(!result.valid);
    assert.ok(!result.checks.graph_hash_valid);
  });

  it('detects tampered file content via tree_hash', async () => {
    const tampered = JSON.parse(JSON.stringify(commit)) as CausalCommit;
    tampered.changeset.changed[0].content_hash = sha256Hex('injected content');
    const { bytesToHex } = require('@noble/hashes/utils');
    const result = await verifyCommit(tampered, bytesToHex(keypair.publicKey));
    assert.ok(!result.valid);
    assert.ok(!result.checks.tree_hash_valid);
  });

  it('detects commit signed with wrong key', async () => {
    const wrongKeypair = await generateKeypair();
    const { bytesToHex } = require('@noble/hashes/utils');
    const result = await verifyCommit(commit, bytesToHex(wrongKeypair.publicKey));
    assert.ok(!result.valid);
  });
});

// ---------------------------------------------------------------------------
// Suite 6: Chain integrity
// ---------------------------------------------------------------------------

describe('Chain integrity', () => {
  it('verifies a two-commit chain', async () => {
    const keypair = await generateKeypair();
    const commit1 = await buildCommit(makeCommitInput(), keypair);
    const commit2 = await buildCommit(makeCommitInput(commit1.commit_id), keypair);

    assert.equal(commit2.parent_hash, commit1.commit_id);

    const { bytesToHex } = require('@noble/hashes/utils');
    const result = await verifyChain([commit1, commit2], bytesToHex(keypair.publicKey));
    assert.ok(result.valid, `Chain errors: ${result.errors.join(', ')}`);
  });

  it('detects a broken chain link', async () => {
    const keypair = await generateKeypair();
    const commit1 = await buildCommit(makeCommitInput(), keypair);
    const commit2 = await buildCommit(makeCommitInput(commit1.commit_id), keypair);

    const tampered = JSON.parse(JSON.stringify(commit2)) as CausalCommit;
    tampered.parent_hash = 'deadbeef'.repeat(8);

    const { bytesToHex } = require('@noble/hashes/utils');
    const result = await verifyChain([commit1, tampered], bytesToHex(keypair.publicKey));
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes('parent_hash')));
  });

  it('rejects a chain where first commit has non-genesis parent', async () => {
    const keypair = await generateKeypair();
    const orphan = await buildCommit(makeCommitInput('a'.repeat(64)), keypair);

    const { bytesToHex } = require('@noble/hashes/utils');
    const result = await verifyChain([orphan], bytesToHex(keypair.publicKey));
    assert.ok(!result.valid);
    assert.ok(result.errors.some((e) => e.includes('GENESIS_HASH')));
  });
});
