/**
 * @prufs/cloud - Ed25519 signing key management
 *
 * Orgs register public keys here. The Verifier uses these to validate
 * commit signatures and attestation signatures on inbound CausalCommits.
 */

import { query } from '../db.js';
import type { SigningKey, RegisterSigningKeyInput } from '../types.js';
import { NotFoundError, ConflictError } from '../types.js';

// --- Validation ---

const HEX_PATTERN = /^[0-9a-f]{64}$/;

export function validatePublicKey(hex: string): boolean {
  return HEX_PATTERN.test(hex.toLowerCase());
}

// --- CRUD ---

export async function registerSigningKey(
  orgId: string,
  userId: string,
  input: RegisterSigningKeyInput,
): Promise<SigningKey> {
  if (!validatePublicKey(input.public_key)) {
    throw new ConflictError(
      'public_key must be a 64-character hex string (32-byte Ed25519 public key).',
    );
  }

  if (!input.key_id || input.key_id.length > 128) {
    throw new ConflictError('key_id must be 1-128 characters.');
  }

  try {
    const result = await query<SigningKey>(
      `INSERT INTO signing_keys (org_id, key_id, public_key, label, registered_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [orgId, input.key_id, input.public_key.toLowerCase(), input.label ?? null, userId],
    );
    return result.rows[0];
  } catch (err: any) {
    if (err.code === '23505') {
      throw new ConflictError(`Signing key already registered: ${input.key_id}`);
    }
    throw err;
  }
}

export async function listSigningKeys(orgId: string): Promise<SigningKey[]> {
  const result = await query<SigningKey>(
    `SELECT * FROM signing_keys
     WHERE org_id = $1
     ORDER BY registered_at DESC`,
    [orgId],
  );
  return result.rows;
}

export async function getActiveSigningKeys(orgId: string): Promise<SigningKey[]> {
  const result = await query<SigningKey>(
    `SELECT * FROM signing_keys
     WHERE org_id = $1 AND revoked_at IS NULL
     ORDER BY registered_at DESC`,
    [orgId],
  );
  return result.rows;
}

export async function getSigningKeyByKeyId(
  orgId: string,
  keyId: string,
): Promise<SigningKey | null> {
  const result = await query<SigningKey>(
    'SELECT * FROM signing_keys WHERE org_id = $1 AND key_id = $2',
    [orgId, keyId],
  );
  return result.rows[0] ?? null;
}

export async function revokeSigningKey(orgId: string, keyId: string): Promise<SigningKey> {
  const result = await query<SigningKey>(
    `UPDATE signing_keys SET revoked_at = NOW()
     WHERE org_id = $1 AND key_id = $2 AND revoked_at IS NULL
     RETURNING *`,
    [orgId, keyId],
  );
  if (result.rows.length === 0) {
    throw new NotFoundError('Signing key', keyId);
  }
  return result.rows[0];
}
