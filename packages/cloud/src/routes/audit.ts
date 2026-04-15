/**
 * @prufs/cloud - Audit routes
 *
 * GET /v1/orgs/:slug/audit   Paginated audit log (member+)
 *   Query params:
 *     limit     (1-100, default 25)
 *     offset    (default 0)
 *     action    (filter by action string)
 *     category  (filter by category)
 *     actor_id  (filter by actor)
 *     since     (ISO date string, inclusive)
 *     until     (ISO date string, inclusive)
 */

import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import * as orgModel from '../models/orgs.js';
import * as auditModel from '../models/audit.js';

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/v1/orgs/:slug/audit',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const org = await orgModel.getOrgBySlug(slug);
      if (!org || org.id !== request.auth.org_id) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      const q = request.query as {
        limit?: string;
        offset?: string;
        action?: string;
        category?: string;
        actor_id?: string;
        since?: string;
        until?: string;
      };

      const page = await auditModel.listAudit(org.id, {
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
        offset: q.offset ? parseInt(q.offset, 10) : undefined,
        action: q.action,
        category: q.category,
        actor_id: q.actor_id,
        since: q.since,
        until: q.until,
      });

      return page;
    },
  );
}
