/**
 * @prufs/cloud - Org routes
 *
 * POST   /v1/orgs                     Create org (public - creates user + org + key in one shot)
 * GET    /v1/orgs/:slug               Get org details (auth required)
 * PATCH  /v1/orgs/:slug               Update org (admin+)
 * DELETE /v1/orgs/:slug               Delete org (owner only)
 * GET    /v1/orgs/:slug/members       List members (member+)
 * POST   /v1/orgs/:slug/members       Add member (admin+)
 * DELETE /v1/orgs/:slug/members/:uid  Remove member (admin+)
 * GET    /v1/orgs/:slug/usage         Get usage for current period (member+)
 */

import type { FastifyInstance } from 'fastify';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as orgModel from '../models/orgs.js';
import * as userModel from '../models/users.js';
import * as apiKeyModel from '../models/api-keys.js';
import * as meterModel from '../models/meter.js';
import { AppError } from '../types.js';

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  // ─── Bootstrap: create org ─────────────────────────────────────────
  // This is the onboarding endpoint. Creates user + org + first API key
  // in a single call. Returns the raw API key (shown once, never again).
  app.post('/v1/orgs', async (request, reply) => {
    const body = request.body as {
      org_name: string;
      org_slug: string;
      email: string;
      user_name?: string;
    };

    if (!body.org_name || !body.org_slug || !body.email) {
      return reply.code(400).send({
        error: 'VALIDATION',
        message: 'Required: org_name, org_slug, email',
      });
    }

    // Get or create user
    const user = await userModel.getOrCreateUser(body.email, body.user_name);

    // Create org with user as owner
    const org = await orgModel.createOrg(
      { name: body.org_name, slug: body.org_slug },
      user.id,
    );

    // Generate first API key
    const apiKey = await apiKeyModel.createApiKey(org.id, user.id, 'default');

    return reply.code(201).send({
      org,
      user,
      api_key: {
        id: apiKey.id,
        prefix: apiKey.prefix,
        raw_key: apiKey.raw_key,
        message: 'Save this key now. It will not be shown again.',
      },
    });
  });

  // ─── Get org ───────────────────────────────────────────────────────
  app.get(
    '/v1/orgs/:slug',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const org = await orgModel.getOrgBySlug(slug);

      if (!org) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Org not found.' });
      if (org.id !== request.auth.org_id) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Not a member of this org.' });
      }

      return org;
    },
  );

  // ─── Update org ────────────────────────────────────────────────────
  app.patch(
    '/v1/orgs/:slug',
    { preHandler: [requireAuth, requireRole('admin', 'owner')] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const org = await orgModel.getOrgBySlug(slug);

      if (!org) return reply.code(404).send({ error: 'NOT_FOUND' });
      if (org.id !== request.auth.org_id) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const body = request.body as { name?: string; settings?: Record<string, unknown> };
      const updated = await orgModel.updateOrg(org.id, body);
      return updated;
    },
  );

  // ─── Delete org ────────────────────────────────────────────────────
  app.delete(
    '/v1/orgs/:slug',
    { preHandler: [requireAuth, requireRole('owner')] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const org = await orgModel.getOrgBySlug(slug);

      if (!org) return reply.code(404).send({ error: 'NOT_FOUND' });
      if (org.id !== request.auth.org_id) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      await orgModel.deleteOrg(org.id);
      return reply.code(204).send();
    },
  );

  // ─── List members ──────────────────────────────────────────────────
  app.get(
    '/v1/orgs/:slug/members',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const org = await orgModel.getOrgBySlug(slug);

      if (!org || org.id !== request.auth.org_id) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      return orgModel.getMembers(org.id);
    },
  );

  // ─── Add member ────────────────────────────────────────────────────
  app.post(
    '/v1/orgs/:slug/members',
    { preHandler: [requireAuth, requireRole('admin', 'owner')] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const org = await orgModel.getOrgBySlug(slug);

      if (!org || org.id !== request.auth.org_id) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      const body = request.body as { email: string; role?: string; name?: string };
      if (!body.email) {
        return reply.code(400).send({ error: 'VALIDATION', message: 'Required: email' });
      }

      const user = await userModel.getOrCreateUser(body.email, body.name);
      const member = await orgModel.addMember(org.id, user.id, (body.role as any) ?? 'member');

      return reply.code(201).send(member);
    },
  );

  // ─── Remove member ─────────────────────────────────────────────────
  app.delete(
    '/v1/orgs/:slug/members/:userId',
    { preHandler: [requireAuth, requireRole('admin', 'owner')] },
    async (request, reply) => {
      const { slug, userId } = request.params as { slug: string; userId: string };
      const org = await orgModel.getOrgBySlug(slug);

      if (!org || org.id !== request.auth.org_id) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      await orgModel.removeMember(org.id, userId);
      return reply.code(204).send();
    },
  );

  // ─── Usage ─────────────────────────────────────────────────────────
  app.get(
    '/v1/orgs/:slug/usage',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const org = await orgModel.getOrgBySlug(slug);

      if (!org || org.id !== request.auth.org_id) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      return meterModel.getUsage(org.id, org.tier);
    },
  );
}
