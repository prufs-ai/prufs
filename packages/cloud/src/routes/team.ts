/**
 * @prufs/cloud - Team routes (invitations)
 *
 * Invites:
 *   GET    /v1/orgs/:slug/invites            List pending (admin+)
 *   POST   /v1/orgs/:slug/invites            Create (admin+)
 *   DELETE /v1/orgs/:slug/invites/:id         Revoke (admin+)
 */

import type { FastifyInstance } from 'fastify';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as orgModel from '../models/orgs.js';
import * as inviteModel from '../models/invites.js';

const VALID_ROLES = new Set(['admin', 'member', 'viewer']);

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  async function resolveOrg(slug: string, authOrgId: string) {
    const org = await orgModel.getOrgBySlug(slug);
    if (!org || org.id !== authOrgId) return null;
    return org;
  }

  app.get(
    '/v1/orgs/:slug/invites',
    { preHandler: [requireAuth, requireRole('admin', 'owner')] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const org = await resolveOrg(slug, request.auth.org_id);
      if (!org) return reply.code(404).send({ error: 'NOT_FOUND' });

      return inviteModel.listInvites(org.id);
    },
  );

  app.post(
    '/v1/orgs/:slug/invites',
    { preHandler: [requireAuth, requireRole('admin', 'owner')] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const org = await resolveOrg(slug, request.auth.org_id);
      if (!org) return reply.code(404).send({ error: 'NOT_FOUND' });

      const body = request.body as { email?: string; role?: string };

      if (!body.email || typeof body.email !== 'string' || !body.email.includes('@')) {
        return reply.code(400).send({ error: 'VALIDATION', message: 'Valid email is required' });
      }
      if (!body.role || !VALID_ROLES.has(body.role)) {
        return reply.code(400).send({
          error: 'VALIDATION',
          message: 'role must be one of: admin, member, viewer',
        });
      }

      const invite = await inviteModel.createInvite(
        org.id,
        body.email.toLowerCase().trim(),
        body.role as 'admin' | 'member' | 'viewer',
      );
      return reply.code(201).send(invite);
    },
  );

  app.delete(
    '/v1/orgs/:slug/invites/:id',
    { preHandler: [requireAuth, requireRole('admin', 'owner')] },
    async (request, reply) => {
      const { slug, id } = request.params as { slug: string; id: string };
      const org = await resolveOrg(slug, request.auth.org_id);
      if (!org) return reply.code(404).send({ error: 'NOT_FOUND' });

      const ok = await inviteModel.revokeInvite(org.id, id);
      if (!ok) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Invite not found or already accepted' });
      }
      return reply.code(204).send();
    },
  );
}
