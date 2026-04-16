/**
 * @prufs/cloud - Invitation management
 *
 * list pending + create (upsert) + revoke
 */

import { query } from '../db.js';
import type { Invite } from '../types.js';

/** List pending (not accepted, not expired) invitations for an org. */
export async function listInvites(orgId: string): Promise<Invite[]> {
  const result = await query<Invite>(
    `SELECT id, email, role, created_at, expires_at
     FROM invites
     WHERE org_id = $1
       AND accepted_at IS NULL
       AND expires_at > now()
     ORDER BY created_at DESC`,
    [orgId],
  );
  return result.rows;
}

/**
 * Create or refresh an invitation.
 * If an active invite for the same email already exists, it is replaced
 * (new token, new expiry).
 */
export async function createInvite(
  orgId: string,
  email: string,
  role: 'admin' | 'member' | 'viewer',
): Promise<Invite> {
  const result = await query<Invite>(
    `INSERT INTO invites (org_id, email, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (org_id, email)
     DO UPDATE SET
       role        = EXCLUDED.role,
       token       = encode(gen_random_bytes(32), 'hex'),
       created_at  = now(),
       expires_at  = now() + INTERVAL '7 days',
       accepted_at = NULL
     RETURNING id, email, role, created_at, expires_at`,
    [orgId, email, role],
  );
  return result.rows[0];
}

/** Delete a pending invite. Returns true if a row was removed. */
export async function revokeInvite(
  orgId: string,
  inviteId: string,
): Promise<boolean> {
  const result = await query(
    `DELETE FROM invites
     WHERE id = $1 AND org_id = $2 AND accepted_at IS NULL
     RETURNING id`,
    [inviteId, orgId],
  );
  return result.rows.length > 0;
}
