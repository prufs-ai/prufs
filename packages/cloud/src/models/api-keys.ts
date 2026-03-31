/**
 * @prufs/cloud - API key management
 *
 * Key format: prfs_<32 random hex chars>
 * Storage: bcrypt-style hash via SHA-256 (no native bcrypt dep needed)
 * Lookup: prefix index on first 8 chars for fast identification
 *
 * The raw key is returned exactly once on creation and never stored.
 */

import { randomBytes } from 'node:crypto';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { query } from '../db.js';
import type { ApiKey, ApiKeyWithSecret, AuthContext } from '../types.js';
import { NotFoundError, AppError } from '../types.js';

const KEY_PREFIX = 'prfs_';
const KEY_RANDOM_BYTES = 32;

// --- Key generation ---

export function generateRawKey(): string {
  const random = randomBytes(KEY_RANDOM_BYTES);
  return KEY_PREFIX + bytesToHex(random);
}

export function hashKey(rawKey: string): string {
  const hash = sha256(new TextEncoder().encode(rawKey));
  return bytesToHex(hash);
}

export function extractPrefix(rawKey: string): string {
  return rawKey.slice(0, KEY_PREFIX.length + 8); // "prfs_" + 8 hex chars
}

// --- CRUD ---

export async function createApiKey(
  orgId: string,
  userId: string,
  name?: string,
): Promise<ApiKeyWithSecret> {
  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);
  const prefix = extractPrefix(rawKey);

  const result = await query<ApiKey>(
    `INSERT INTO api_keys (org_id, user_id, key_hash, prefix, name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, org_id, user_id, prefix, name, created_at, last_used_at, expires_at, revoked_at`,
    [orgId, userId, keyHash, prefix, name ?? null],
  );

  return {
    ...result.rows[0],
    raw_key: rawKey,
  };
}

export async function listApiKeys(orgId: string): Promise<ApiKey[]> {
  const result = await query<ApiKey>(
    `SELECT id, org_id, user_id, prefix, name, created_at, last_used_at, expires_at, revoked_at
     FROM api_keys
     WHERE org_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC`,
    [orgId],
  );
  return result.rows;
}

export async function revokeApiKey(keyId: string, orgId: string): Promise<ApiKey> {
  const result = await query<ApiKey>(
    `UPDATE api_keys SET revoked_at = NOW()
     WHERE id = $1 AND org_id = $2 AND revoked_at IS NULL
     RETURNING *`,
    [keyId, orgId],
  );
  if (result.rows.length === 0) throw new NotFoundError('API key', keyId);
  return result.rows[0];
}

// --- Verification (used by auth middleware) ---

/**
 * Verify a raw API key and return the auth context.
 *
 * Steps:
 * 1. Extract prefix, find candidate rows
 * 2. Hash the raw key
 * 3. Match against stored hashes
 * 4. Check not revoked, not expired
 * 5. Update last_used_at
 * 6. Build AuthContext with org and membership info
 */
export async function verifyApiKey(rawKey: string): Promise<AuthContext | null> {
  if (!rawKey.startsWith(KEY_PREFIX)) return null;

  const keyHash = hashKey(rawKey);

  // Single query: join api_keys -> orgs -> org_members to get full context
  const result = await query<{
    key_id: string;
    org_id: string;
    user_id: string;
    revoked_at: string | null;
    expires_at: string | null;
    org_slug: string;
    org_tier: 'free' | 'pro' | 'enterprise';
    role: string;
  }>(
    `SELECT
       ak.id AS key_id,
       ak.org_id,
       ak.user_id,
       ak.revoked_at,
       ak.expires_at,
       o.slug AS org_slug,
       o.tier AS org_tier,
       om.role
     FROM api_keys ak
     JOIN orgs o ON o.id = ak.org_id
     JOIN org_members om ON om.org_id = ak.org_id AND om.user_id = ak.user_id
     WHERE ak.key_hash = $1`,
    [keyHash],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  // Check revocation
  if (row.revoked_at) return null;

  // Check expiry
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  // Update last_used_at (fire and forget - do not block auth on this)
  query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [row.key_id]).catch(() => {});

  return {
    org_id: row.org_id,
    user_id: row.user_id,
    org_slug: row.org_slug,
    org_tier: row.org_tier as 'free' | 'pro' | 'enterprise',
    role: row.role as AuthContext['role'],
  };
}
