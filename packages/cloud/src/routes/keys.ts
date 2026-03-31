/**
 * @prufs/cloud - Key routes
 *
 * Signing keys:
 *   GET    /v1/orgs/:slug/signing-keys           List all (member+)
 *   POST   /v1/orgs/:slug/signing-keys           Register (admin+)
 *   DELETE /v1/orgs/:slug/signing-keys/:keyId     Revoke (admin+)
 *
 * API keys:
 *   GET    /v1/orgs/:slug/api-keys                List all (admin+)
 *   POST   /v1/orgs/:slug/api-keys                Create (admin+)
 *   DELETE /v1/orgs/:slug/api-keys/:id             Revoke (admin+)
 */

import type { FastifyInstance } from 'fastify';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as signingKeyModel from '../models/signing-keys.js';
import * as apiKeyModel from '../models/api-keys.js';
import * as orgModel from '../models/orgs.js';

export async function keyRoutes(app: FastifyInstance): Promise<void> {
  // ─── Helper: resolve org and check membership ──────────────────────
  async function resolveOrg(slug: string, authOrgId: string) {
    const org = await orgModel.getOrgBySlug(slug);
    if (!org || org.id !== authOrgId) return null;
    return org;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Signing keys
  // ═══════════════════════════════════════════════════════════════════

  app.get(
    '/v1/orgs/:slug/signing-keys',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const org = await resolveOrg(slug, request.auth.org_id);
      if (!org) return reply.code(404).send({ error: 'NOT_FOUND' });

      return signingKeyModel.listSigningKeys(org.id);
    },
  );

  app.post(
    '/v1/orgs/:slug/signing-keys',
    { preHandler: [requireAuth, requireRole('admin', 'owner')] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const org = await resolveOrg(slug, request.auth.org_id);
      if (!org) return reply.code(404).send({ error: 'NOT_FOUND' });

      const body = request.body as { key_id: string; public_key: string; label?: string };
      if (!body.key_id || !body.public_key) {
        return reply.code(400).send({
          error: 'VALIDATION',
          message: 'Required: key_id, public_key (64-char hex Ed25519 public key)',
        });
      }

      const key = await signingKeyModel.registerSigningKey(org.id, request.auth.user_id, body);
      return reply.code(201).send(key);
    },
  );

  app.delete(
    '/v1/orgs/:slug/signing-keys/:keyId',
    { preHandler: [requireAuth, requireRole('admin', 'owner')] },
    async (request, reply) => {
      const { slug, keyId } = request.params as { slug: string; keyId: string };
      const org = await resolveOrg(slug, request.auth.org_id);
      if (!org) return reply.code(404).send({ error: 'NOT_FOUND' });

      const revoked = await signingKeyModel.revokeSigningKey(org.id, keyId);
      return revoked;
    },
  );

  // ═══════════════════════════════════════════════════════════════════
  // API keys
  // ═══════════════════════════════════════════════════════════════════

  app.get(
    '/v1/orgs/:slug/api-keys',
    { preHandler: [requireAuth, requireRole('admin', 'owner')] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const org = await resolveOrg(slug, request.auth.org_id);
      if (!org) return reply.code(404).send({ error: 'NOT_FOUND' });

      return apiKeyModel.listApiKeys(org.id);
    },
  );

  app.post(
    '/v1/orgs/:slug/api-keys',
    { preHandler: [requireAuth, requireRole('admin', 'owner')] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const org = await resolveOrg(slug, request.auth.org_id);
      if (!org) return reply.code(404).send({ error: 'NOT_FOUND' });

      const body = request.body as { name?: string; user_id?: string };
      const targetUserId = body.user_id ?? request.auth.user_id;

      const key = await apiKeyModel.createApiKey(org.id, targetUserId, body.name);
      return reply.code(201).send({
        ...key,
        message: 'Save this key now. It will not be shown again.',
      });
    },
  );

  app.delete(
    '/v1/orgs/:slug/api-keys/:id',
    { preHandler: [requireAuth, requireRole('admin', 'owner')] },
    async (request, reply) => {
      const { slug, id } = request.params as { slug: string; id: string };
      const org = await resolveOrg(slug, request.auth.org_id);
      if (!org) return reply.code(404).send({ error: 'NOT_FOUND' });

      const revoked = await apiKeyModel.revokeApiKey(id, org.id);
      return revoked;
    },
  );
}
