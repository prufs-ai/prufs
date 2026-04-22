import fp from 'fastify-plugin';
/**
 * @prufs/cloud - Rate limiting plugin
 *
 * In-memory rate limiting via @fastify/rate-limit.
 * Keyed by API key (prfs_ prefix extracted from Authorization header).
 * Free tier: 100 requests/minute. Upgrade path: read limit from org plan.
 *
 * Returns 429 Too Many Requests with Retry-After header when exceeded.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';

/** Requests per minute by plan tier. Extend as paid tiers are added. */
const TIER_LIMITS: Record<string, number> = {
  free: 100,
  pro: 1000,
  enterprise: 5000,
};

const DEFAULT_LIMIT = TIER_LIMITS.free;

/**
 * Extract a rate-limit key from the request.
 * Authenticated requests key on org_id (so all keys in the same org share a budget).
 * Unauthenticated requests (health, auth/recover) key on IP.
 */
function keyGenerator(request: FastifyRequest): string {
  if (request.auth?.org_id) {
    return `org:${request.auth.org_id}`;
  }
  return `ip:${request.ip}`;
}

async function rateLimitPluginInner(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    max: DEFAULT_LIMIT,
    timeWindow: '1 minute',
    keyGenerator,
    errorResponseBuilder(_request, context) {
      return {
        error: 'RATE_LIMITED',
        message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
        limit: context.max,
        remaining: 0,
        retryAfter: Math.ceil(context.ttl / 1000),
      };
    },
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });
}

export const rateLimitPlugin = fp(rateLimitPluginInner, { name: 'prufs-rate-limit' });
