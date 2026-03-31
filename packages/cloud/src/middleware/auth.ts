/**
 * @prufs/cloud - Auth middleware
 *
 * Fastify plugin that extracts and verifies API keys from the
 * Authorization header, then attaches AuthContext to the request.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyApiKey } from '../models/api-keys.js';
import type { AuthContext } from '../types.js';

// Extend Fastify request type
declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

/**
 * Extract Bearer token from Authorization header.
 */
function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;

  // Support "Bearer <token>" and raw "<token>"
  if (header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return header.trim();
}

/**
 * Auth hook - attach to routes that require authentication.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const token = extractToken(request);

  if (!token) {
    reply.code(401).send({
      error: 'UNAUTHORIZED',
      message: 'Missing Authorization header. Provide: Authorization: Bearer prfs_<key>',
    });
    return;
  }

  const auth = await verifyApiKey(token);

  if (!auth) {
    reply.code(401).send({
      error: 'UNAUTHORIZED',
      message: 'Invalid or expired API key.',
    });
    return;
  }

  request.auth = auth;
}

/**
 * Role guard - use after requireAuth to enforce minimum role.
 */
export function requireRole(...allowed: AuthContext['role'][]) {
  return async function roleGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (!request.auth) {
      reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Not authenticated.' });
      return;
    }

    const roleHierarchy: Record<string, number> = {
      viewer: 0,
      member: 1,
      admin: 2,
      owner: 3,
    };

    const userLevel = roleHierarchy[request.auth.role] ?? -1;
    const minLevel = Math.min(...allowed.map((r) => roleHierarchy[r] ?? 99));

    if (userLevel < minLevel) {
      reply.code(403).send({
        error: 'FORBIDDEN',
        message: `Requires role: ${allowed.join(' or ')}. You have: ${request.auth.role}.`,
      });
      return;
    }
  };
}
