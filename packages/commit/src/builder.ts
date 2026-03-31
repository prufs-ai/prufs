/**
 * @prufs/commit - builder.ts
 *
 * Assembles a fully-signed CausalCommit from a CommitInput.
 *
 * Signing flow:
 *   1. Compute graph_hash from trail nodes + edges
 *   2. Compute tree_hash from file blobs
 *   3. Sign the attestation preimage with the agent key
 *   4. Sign the commit preimage (binds what to why)
 *   5. Compute the final commit_id (content-addressed)
 *
 * The builder enforces all structural invariants before signing.
 * A commit that would fail validation is never produced.
 */

import * as ed from '@noble/ed25519';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { sha512 } from '@noble/hashes/sha512';
import type { CausalCommit, CommitInput } from './types.js';
import {
  buildTrailSnapshot,
  buildFileChangeset,
  attestationPreimage,
  commitSignaturePreimage,
  computeCommitId,
  sha256Hex,
  canonicalJson,
} from './hashing.js';
import { validateCommitInput } from './validator.js';

// @noble/ed25519 v2 requires sha512 to be set explicitly in non-browser envs
ed.etc.sha512Sync = (... m: Parameters<typeof sha512>) => sha512(...m);

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

export interface SigningKeypair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  key_id: string;
}

export async function generateKeypair(): Promise<SigningKeypair> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  const key_id = bytesToHex(publicKey).slice(0, 16);
  return { privateKey, publicKey, key_id };
}

export function keypairFromHex(privateKeyHex: string): SigningKeypair {
  const privateKey = hexToBytes(privateKeyHex);
  const publicKey = ed.getPublicKey(privateKey);
  const key_id = bytesToHex(publicKey).slice(0, 16);
  return { privateKey, publicKey, key_id };
}

export function keypairToHex(kp: SigningKeypair): string {
  return bytesToHex(kp.privateKey);
}

// ---------------------------------------------------------------------------
// Build a CausalCommit
// ---------------------------------------------------------------------------

export async function buildCommit(
  input: CommitInput,
  keypair: SigningKeypair
): Promise<CausalCommit> {
  const validationErrors = validateCommitInput(input);
  if (validationErrors.length > 0) {
    throw new Error(
      `Invalid CommitInput:\n  ${validationErrors.join('\n  ')}`
    );
  }

  const timestamp = input.trail.nodes[0]?.timestamp ?? new Date().toISOString();
  const commitTimestamp = new Date().toISOString();

  // 1. Compute hashes
  const trail = buildTrailSnapshot(input.trail.nodes, input.trail.edges);
  const changeset = buildFileChangeset(input.changeset.changed);

  // 2. Derive message from first Directive node if not provided
  const directiveNode = trail.nodes.find((n) => n.type === 'Directive');
  const message =
    input.message ??
    (directiveNode
      ? directiveNode.content.slice(0, 120)
      : 'Agent commit (no directive)');

  // 3. Hash the prompt (we only get the raw text here to hash it)
  const prompt_hash = sha256Hex(
    canonicalJson({ agent_id: input.attestation.agent_id, session_id: input.attestation.session_id })
  );

  // 4. Sign attestation: agent_id + model_id + session_id + prompt_hash
  const attPreimage = attestationPreimage(
    input.attestation.agent_id,
    input.attestation.model_id,
    input.attestation.session_id,
    prompt_hash
  );
  const attSigBytes = await ed.signAsync(
    hexToBytes(attPreimage),
    keypair.privateKey
  );
  const attestation_signature = bytesToHex(attSigBytes);

  // 5. Sign commit: tree_hash + graph_hash + parent_hash + agent_id + timestamp
  const commitPreimage = commitSignaturePreimage(
    changeset.tree_hash,
    trail.graph_hash,
    input.parent_hash,
    input.attestation.agent_id,
    commitTimestamp
  );
  const commitSigBytes = await ed.signAsync(
    hexToBytes(commitPreimage),
    keypair.privateKey
  );
  const commit_signature = bytesToHex(commitSigBytes);

  // 6. Assemble (without commit_id)
  const partial: Omit<CausalCommit, 'commit_id'> = {
    parent_hash: input.parent_hash,
    timestamp: commitTimestamp,
    trail,
    attestation: {
      agent_id: input.attestation.agent_id,
      model_id: input.attestation.model_id,
      session_id: input.attestation.session_id,
      prompt_hash,
      signature: attestation_signature,
      signer_key_id: keypair.key_id,
    },
    changeset,
    commit_signature,
    signer_key_id: keypair.key_id,
    message,
    branch: input.branch,
  };

  // 7. Content-address the whole thing
  const commit_id = computeCommitId(partial);

  return { commit_id, ...partial };
}
