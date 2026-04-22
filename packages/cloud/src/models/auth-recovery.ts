/**
 * @prufs/cloud - Auth recovery model
 *
 * Create and consume magic-link tokens for password-less sign-in.
 * Tokens are single-use with a 1-hour TTL.
 */

import { query } from '../db.js';

interface RecoveryToken {
  id: string;
  email: string;
  token: string;
  expires_at: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
}

/**
 * Create a recovery token for the given email.
 * If the email has existing unused tokens, they remain valid until expiry
 * (rate limiting on the route prevents abuse).
 *
 * Returns the token string, or null if the email is not associated with
 * any user account (we return null silently to avoid email enumeration).
 */
export async function createRecoveryToken(email: string): Promise<string | null> {
  // Verify the email belongs to a known user (check org_members).
  const userCheck = await query<UserRow>(
    `SELECT user_id AS id, email FROM org_members WHERE email = $1 LIMIT 1`,
    [email],
  );
  if (userCheck.rows.length === 0) {
    // Silent fail: do not reveal whether the email exists.
    return null;
  }

  // Purge expired tokens for this email (housekeeping).
  await query(
    `DELETE FROM recovery_tokens WHERE email = $1 AND expires_at < now()`,
    [email],
  );

  const result = await query<RecoveryToken>(
    `INSERT INTO recovery_tokens (email)
     VALUES ($1)
     RETURNING token, expires_at`,
    [email],
  );

  return result.rows[0]?.token ?? null;
}

/**
 * Consume a recovery token. Returns the associated email if the token
 * is valid, unused, and not expired. Marks the token as used atomically.
 */
export async function consumeRecoveryToken(token: string): Promise<string | null> {
  const result = await query<{ email: string }>(
    `UPDATE recovery_tokens
     SET used_at = now()
     WHERE token = $1
       AND used_at IS NULL
       AND expires_at > now()
     RETURNING email`,
    [token],
  );
  return result.rows[0]?.email ?? null;
}
