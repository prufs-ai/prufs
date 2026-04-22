/**
 * @prufs/cloud - Org member management (Day 9)
 *
 * listMembers re-exports the existing getMembers from orgs.ts.
 * removeMember adds deletion with last-owner guard.
 */

import { query } from '../db.js';
import type { OrgMember } from '../types.js';

/** List all members of an org, with email/name from users table. */
export async function listMembers(orgId: string): Promise<OrgMember[]> {
  const result = await query<OrgMember>(
    `SELECT om.*, u.email, u.name
     FROM org_members om
     JOIN users u ON u.id = om.user_id
     WHERE om.org_id = $1
     ORDER BY om.joined_at`,
    [orgId],
  );
  return result.rows;
}

/**
 * Remove a member from an org.
 * Returns 'removed' | 'not_found' | 'last_owner'.
 * Blocks removal of the last owner to prevent orphaned orgs.
 */
export async function removeMember(
  orgId: string,
  userId: string,
): Promise<'removed' | 'not_found' | 'last_owner'> {
  const targets = await query<{ role: string }>(
    `SELECT role FROM org_members WHERE org_id = $1 AND user_id = $2`,
    [orgId, userId],
  );
  if (targets.rows.length === 0) return 'not_found';

  if (targets.rows[0].role === 'owner') {
    const counts = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM org_members WHERE org_id = $1 AND role = 'owner'`,
      [orgId],
    );
    if (parseInt(counts.rows[0].count, 10) <= 1) return 'last_owner';
  }

  await query(
    `DELETE FROM org_members WHERE org_id = $1 AND user_id = $2`,
    [orgId, userId],
  );
  return 'removed';
}
