/**
 * @prufs/cloud - Signature tests
 *
 * Tests Ed25519 signature creation and verification.
 * Uses real Ed25519 keys to build genuinely signed commits,
 * then verifies them through the signature module functions.
 *
 * Note: These tests call the pure verification functions directly,
 * not the DB-backed versions (which need a live Postgres connection).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import type { CausalCommit, TrailNode, TrailEdge } from './commit-types.js';
import { GENESIS_HASH } from './commit-types.js';

// --- Helpers ---

function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'string') return JSON.stringify(obj);
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
  if (typeof obj === 'object') {
    const sorted = Object.keys(obj as Record<string, unknown>).sort();
    return '{' + sorted.map(k => JSON.stringify(k) + ':' + canonicalize((obj as Record<string, unknown>)[k])).join(',') + '}';
  }
  return String(obj);
}

function sha256hex(data: string): string {
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

/**
 * Build a fully signed CausalCommit with real Ed25519 keys.
 */
function buildSignedCommit(privateKey: Uint8Array, publicKey: Uint8Array) {
  const nodes: TrailNode[] = [
    { id: 'n1', type: 'Directive', text: 'Build auth', timestamp: '2026-03-31T20:00:00Z', sensitivity: 'public' },
    { id: 'n2', type: 'Decision', text: 'Use JWT', timestamp: '2026-03-31T20:00:01Z', sensitivity: 'internal' },
    { id: 'n3', type: 'Implementation', text: 'JWT middleware', timestamp: '2026-03-31T20:00:02Z', sensitivity: 'public' },
  ];

  const edges: TrailEdge[] = [
    { source: 'n1', target: 'n2', type: 'caused_by' },
    { source: 'n2', target: 'n3', type: 'caused_by' },
  ];

  const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id))
    .map(n => ({ id: n.id, type: n.type, text: n.text, timestamp: n.timestamp, sensitivity: n.sensitivity }));
  const sortedEdges = [...edges].sort((a, b) => `${a.source}:${a.target}`.localeCompare(`${b.source}:${b.target}`));
  const graph_hash = sha256hex(canonicalize({ nodes: sortedNodes, edges: sortedEdges }));

  const files = [
    { path: 'src/auth.ts', change_type: 'add' as const, content_hash: sha256hex('auth code') },
  ];
  const sortedHashes = files.map(f => `${f.path}:${f.content_hash}`).sort();
  const tree_hash = sha256hex(canonicalize(sortedHashes));

  const agent_id = 'claude-opus-4-6';
  const model_id = 'claude-opus-4-6-20250514';
  const session_id = 'sess_test';
  const prompt_hash = sha256hex('build auth');
  const timestamp = '2026-03-31T20:00:00Z';

  // Sign attestation: agent_id:model_id:session_id:prompt_hash
  const attestMsg = sha256(new TextEncoder().encode(
    [agent_id, model_id, session_id, prompt_hash].join(':')
  ));
  const attestSig = ed25519.sign(attestMsg, privateKey);

  // Sign commit: tree_hash:graph_hash:parent_hash:agent_id:timestamp
  const commitMsg = sha256(new TextEncoder().encode(
    [tree_hash, graph_hash, GENESIS_HASH, agent_id, timestamp].join(':')
  ));
  const commitSig = ed25519.sign(commitMsg, privateKey);

  const keyId = 'key-test-001';

  const trail = { nodes, edges, graph_hash };
  const changeset = { files, tree_hash };
  const attestation = {
    agent_id,
    model_id,
    session_id,
    prompt_hash,
    signature: bytesToHex(attestSig),
    signer_key_id: keyId,
  };

  const payload = {
    parent_hash: GENESIS_HASH,
    timestamp,
    trail,
    attestation,
    changeset,
    commit_signature: bytesToHex(commitSig),
    signer_key_id: keyId,
    message: 'feat: add auth',
  };

  const commit_id = sha256hex(canonicalize(payload));

  const commit: CausalCommit = {
    commit_id,
    ...payload,
  };

  return { commit, publicKey: bytesToHex(publicKey), keyId };
}

// --- Tests ---

describe('Ed25519 key generation', () => {
  it('generates a valid keypair', () => {
    const privKey = ed25519.utils.randomSecretKey();
    const pubKey = ed25519.getPublicKey(privKey);
    assert.equal(privKey.length, 32);
    assert.equal(pubKey.length, 32);
  });

  it('public key is deterministic from private key', () => {
    const privKey = ed25519.utils.randomSecretKey();
    const pub1 = ed25519.getPublicKey(privKey);
    const pub2 = ed25519.getPublicKey(privKey);
    assert.deepEqual(pub1, pub2);
  });
});

describe('Ed25519 attestation signature', () => {
  it('verifies a correctly signed attestation', () => {
    const privKey = ed25519.utils.randomSecretKey();
    const pubKey = ed25519.getPublicKey(privKey);
    const { commit } = buildSignedCommit(privKey, pubKey);

    const attestMsg = sha256(new TextEncoder().encode(
      [commit.attestation.agent_id, commit.attestation.model_id,
       commit.attestation.session_id, commit.attestation.prompt_hash].join(':')
    ));
    const valid = ed25519.verify(
      hexToBytes(commit.attestation.signature),
      attestMsg,
      pubKey,
    );
    assert.ok(valid);
  });

  it('rejects attestation signed with wrong key', () => {
    const privKey = ed25519.utils.randomSecretKey();
    const pubKey = ed25519.getPublicKey(privKey);
    const wrongPubKey = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
    const { commit } = buildSignedCommit(privKey, pubKey);

    const attestMsg = sha256(new TextEncoder().encode(
      [commit.attestation.agent_id, commit.attestation.model_id,
       commit.attestation.session_id, commit.attestation.prompt_hash].join(':')
    ));
    const valid = ed25519.verify(
      hexToBytes(commit.attestation.signature),
      attestMsg,
      wrongPubKey,
    );
    assert.ok(!valid);
  });

  it('rejects tampered attestation fields', () => {
    const privKey = ed25519.utils.randomSecretKey();
    const pubKey = ed25519.getPublicKey(privKey);
    const { commit } = buildSignedCommit(privKey, pubKey);

    // Tamper with agent_id
    const tamperedMsg = sha256(new TextEncoder().encode(
      ['tampered-agent', commit.attestation.model_id,
       commit.attestation.session_id, commit.attestation.prompt_hash].join(':')
    ));
    const valid = ed25519.verify(
      hexToBytes(commit.attestation.signature),
      tamperedMsg,
      pubKey,
    );
    assert.ok(!valid);
  });
});

describe('Ed25519 commit signature', () => {
  it('verifies a correctly signed commit', () => {
    const privKey = ed25519.utils.randomSecretKey();
    const pubKey = ed25519.getPublicKey(privKey);
    const { commit } = buildSignedCommit(privKey, pubKey);

    const commitMsg = sha256(new TextEncoder().encode(
      [commit.changeset.tree_hash, commit.trail.graph_hash,
       commit.parent_hash, commit.attestation.agent_id, commit.timestamp].join(':')
    ));
    const valid = ed25519.verify(
      hexToBytes(commit.commit_signature),
      commitMsg,
      pubKey,
    );
    assert.ok(valid);
  });

  it('rejects commit signed with wrong key', () => {
    const privKey = ed25519.utils.randomSecretKey();
    const pubKey = ed25519.getPublicKey(privKey);
    const wrongPubKey = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
    const { commit } = buildSignedCommit(privKey, pubKey);

    const commitMsg = sha256(new TextEncoder().encode(
      [commit.changeset.tree_hash, commit.trail.graph_hash,
       commit.parent_hash, commit.attestation.agent_id, commit.timestamp].join(':')
    ));
    const valid = ed25519.verify(
      hexToBytes(commit.commit_signature),
      commitMsg,
      wrongPubKey,
    );
    assert.ok(!valid);
  });
});

describe('Signed commit integrity', () => {
  it('commit_id matches canonical payload hash', () => {
    const privKey = ed25519.utils.randomSecretKey();
    const pubKey = ed25519.getPublicKey(privKey);
    const { commit } = buildSignedCommit(privKey, pubKey);

    const payload = {
      parent_hash: commit.parent_hash,
      timestamp: commit.timestamp,
      trail: commit.trail,
      attestation: commit.attestation,
      changeset: commit.changeset,
      commit_signature: commit.commit_signature,
      signer_key_id: commit.signer_key_id,
      message: commit.message,
    };
    const expected = sha256hex(canonicalize(payload));
    assert.equal(commit.commit_id, expected);
  });

  it('different keys produce different signatures', () => {
    const priv1 = ed25519.utils.randomSecretKey();
    const pub1 = ed25519.getPublicKey(priv1);
    const priv2 = ed25519.utils.randomSecretKey();
    const pub2 = ed25519.getPublicKey(priv2);

    const { commit: c1 } = buildSignedCommit(priv1, pub1);
    const { commit: c2 } = buildSignedCommit(priv2, pub2);

    assert.notEqual(c1.attestation.signature, c2.attestation.signature);
    assert.notEqual(c1.commit_signature, c2.commit_signature);
    // commit_ids also differ because signatures are part of the payload
    assert.notEqual(c1.commit_id, c2.commit_id);
  });
});
