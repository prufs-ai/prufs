/**
 * @prufs/cloud - Org CRUD operations
 */

import { query, transaction } from '../db.js';
import type { Org, CreateOrgInput, UpdateOrgInput, OrgMember, OrgRole } from '../types.js';
import { NotFoundError, ConflictError } from '../types.js';

// --- Slug validation ---

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export function validateSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

// --- Org CRUD ---

export async function createOrg(input: CreateOrgInput, ownerUserId: string): Promise<Org> {
  if (!validateSlug(input.slug)) {
    throw new ConflictError(
      'Slug must be 3-40 chars, lowercase alphanumeric and hyphens, cannot start or end with hyphen.',
    );
  }

  return transaction(async (client) => {
    // Check slug uniqueness
    const existing = await client.query('SELECT id FROM orgs WHERE slug = $1', [input.slug]);
    if (existing.rows.length > 0) {
      throw new ConflictError(`Org slug already taken: ${input.slug}`);
    }

    // Create org
    const orgResult = await client.query<Org>(
      `INSERT INTO orgs (name, slug, tier)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.name, input.slug, input.tier ?? 'free'],
    );
    const org = orgResult.rows[0];

    // Add creator as owner
    await client.query(
      `INSERT INTO org_members (org_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [org.id, ownerUserId],
    );

    return org;
  });
}

export async function getOrgBySlug(slug: string): Promise<Org | null> {
  const result = await query<Org>('SELECT * FROM orgs WHERE slug = $1', [slug]);
  return result.rows[0] ?? null;
}

export async function getOrgById(id: string): Promise<Org | null> {
  const result = await query<Org>('SELECT * FROM orgs WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

export async function updateOrg(id: string, input: UpdateOrgInput): Promise<Org> {
  const setClauses: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`);
    params.push(input.name);
  }
  if (input.tier !== undefined) {
    setClauses.push(`tier = $${paramIndex++}`);
    params.push(input.tier);
  }
  if (input.settings !== undefined) {
    setClauses.push(`settings = $${paramIndex++}`);
    params.push(JSON.stringify(input.settings));
  }

  if (setClauses.length === 0) {
    const org = await getOrgById(id);
    if (!org) throw new NotFoundError('Org', id);
    return org;
  }

  params.push(id);
  const result = await query<Org>(
    `UPDATE orgs SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    params,
  );

  if (result.rows.length === 0) throw new NotFoundError('Org', id);
  return result.rows[0];
}

export async function deleteOrg(id: string): Promise<void> {
  const result = await query('DELETE FROM orgs WHERE id = $1', [id]);
  if (result.rowCount === 0) throw new NotFoundError('Org', id);
}

// --- Membership ---

export async function addMember(orgId: string, userId: string, role: OrgRole): Promise<OrgMember> {
  try {
    const result = await query<OrgMember>(
      `INSERT INTO org_members (org_id, user_id, role)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [orgId, userId, role],
    );
    return result.rows[0];
  } catch (err: any) {
    if (err.code === '23505') {
      throw new ConflictError('User is already a member of this org.');
    }
    throw err;
  }
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  const result = await query(
    'DELETE FROM org_members WHERE org_id = $1 AND user_id = $2',
    [orgId, userId],
  );
  if (result.rowCount === 0) throw new NotFoundError('Member', userId);
}

export async function getMembers(orgId: string): Promise<OrgMember[]> {
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

export async function getMembership(orgId: string, userId: string): Promise<OrgMember | null> {
  const result = await query<OrgMember>(
    'SELECT * FROM org_members WHERE org_id = $1 AND user_id = $2',
    [orgId, userId],
  );
  return result.rows[0] ?? null;
}

export async function updateMemberRole(
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<OrgMember> {
  const result = await query<OrgMember>(
    `UPDATE org_members SET role = $3
     WHERE org_id = $1 AND user_id = $2
     RETURNING *`,
    [orgId, userId, role],
  );
  if (result.rows.length === 0) throw new NotFoundError('Member', userId);
  return result.rows[0];
}
