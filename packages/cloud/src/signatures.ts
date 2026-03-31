/**
 * @prufs/cloud - Signature verification
 *
 * Verifies Ed25519 signatures on CausalCommits using public keys
 * registered in the signing_keys table.
 *
 * Two signatures per commit:
 *   1. Attestation signature - over agent_id + model_id + session_id + prompt_hash
 *   2. Commit signature - over tree_hash + graph_hash + parent_hash + agent_id + timestamp
 *
 * Uses @noble/ed25519 (same library as @prufs/commit).
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { query } from './db.js';
import type { CausalCommit, VerificationResult, VerificationStep } from './commit-types.js';

function fail(step: VerificationStep, message: string): VerificationResult {
  return { valid: false, step, message };
}

function pass(): VerificationResult {
  return { valid: true };
}

/**
 * Look up a registered, non-revoked public key for an org.
 */
async function getPublicKey(orgId: string, keyId: string): Promise<string | null> {
  const result = await query<{ public_key: string }>(
    `SELECT public_key FROM signing_keys
     WHERE org_id = $1 AND key_id = $2 AND revoked_at IS NULL`,
    [orgId, keyId],
  );
  return result.rows[0]?.public_key ?? null;
}

/**
 * Compute the attestation message that was signed.
 * Must match exactly what @prufs/commit signs.
 */
function attestationMessage(commit: CausalCommit): Uint8Array {
  const msg = [
    commit.attestation.agent_id,
    commit.attestation.model_id,
    commit.attestation.session_id,
    commit.attestation.prompt_hash,
  ].join(':');
  return sha256(new TextEncoder().encode(msg));
}

/**
 * Compute the commit message that was signed.
 * Must match exactly what @prufs/commit signs.
 */
function commitMessage(commit: CausalCommit): Uint8Array {
  const msg = [
    commit.changeset.tree_hash,
    commit.trail.graph_hash,
    commit.parent_hash,
    commit.attestation.agent_id,
    commit.timestamp,
  ].join(':');
  return sha256(new TextEncoder().encode(msg));
}

/**
 * Verify the attestation signature using the registered public key.
 */
export async function verifyAttestationSignature(
  orgId: string,
  commit: CausalCommit,
): Promise<VerificationResult> {
  const publicKeyHex = await getPublicKey(orgId, commit.attestation.signer_key_id);
  if (!publicKeyHex) {
    return fail(
      'signing_key_registered',
      `Signing key not registered or revoked: ${commit.attestation.signer_key_id}`,
    );
  }

  try {
    const message = attestationMessage(commit);
    const signature = hexToBytes(commit.attestation.signature);
    const publicKey = hexToBytes(publicKeyHex);

    const valid = ed25519.verify(signature, message, publicKey);
    if (!valid) {
      return fail('attestation_fields', 'Attestation signature verification failed.');
    }
    return pass();
  } catch (err: any) {
    return fail('attestation_fields', `Attestation signature error: ${err.message}`);
  }
}

/**
 * Verify the commit signature using the registered public key.
 */
export async function verifyCommitSignature(
  orgId: string,
  commit: CausalCommit,
): Promise<VerificationResult> {
  const publicKeyHex = await getPublicKey(orgId, commit.signer_key_id);
  if (!publicKeyHex) {
    return fail(
      'signing_key_registered',
      `Signing key not registered or revoked: ${commit.signer_key_id}`,
    );
  }

  try {
    const message = commitMessage(commit);
    const signature = hexToBytes(commit.commit_signature);
    const publicKey = hexToBytes(publicKeyHex);

    const valid = ed25519.verify(signature, message, publicKey);
    if (!valid) {
      return fail('commit_id', 'Commit signature verification failed.');
    }
    return pass();
  } catch (err: any) {
    return fail('commit_id', `Commit signature error: ${err.message}`);
  }
}

/**
 * Full signature verification: attestation + commit.
 * Call this after structural verification passes.
 */
export async function verifySignatures(
  orgId: string,
  commit: CausalCommit,
): Promise<VerificationResult> {
  // Check attestation signature
  const attestResult = await verifyAttestationSignature(orgId, commit);
  if (!attestResult.valid) return attestResult;

  // Check commit signature
  const commitResult = await verifyCommitSignature(orgId, commit);
  if (!commitResult.valid) return commitResult;

  return pass();
}
