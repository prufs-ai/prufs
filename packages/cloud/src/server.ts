/**
 * @prufs/cloud - Fastify server
 *
 * Multi-tenant SaaS backend for Prufs causal commit storage.
 * Entry point: start with `node dist/server.js`
 *
 * Environment variables:
 *   DATABASE_URL  - Postgres connection string (required)
 *   PORT          - HTTP port (default 3100)
 *   HOST          - Bind address (default 0.0.0.0)
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getPool, closePool } from './db.js';
import { orgRoutes } from './routes/orgs.js';
import { keyRoutes } from './routes/keys.js';
import { commitRoutes } from './routes/commits.js';
import { auditRoutes } from './routes/audit.js';
import { teamRoutes } from './routes/team.js';
import { trailRoutes } from './routes/trails.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { AppError } from './types.js';
import { authRoutes } from './routes/auth.js';
import { isR2Configured, getR2Config, headObject } from './r2.js';

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  // ─── CORS ──────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: true, // Allow all origins for now; lock down for production
    credentials: true,
  });

  // ─── Rate limiting ──────────────────────────────────────────────────
  await app.register(rateLimitPlugin);

  // ─── Error handler ─────────────────────────────────────────────────
  app.setErrorHandler((error: Error & { validation?: unknown }, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: error.code ?? 'ERROR',
        message: error.message,
      });
    }

    // Fastify validation errors
    if (error.validation) {
      return reply.code(400).send({
        error: 'VALIDATION',
        message: error.message,
      });
    }

    request.log.error(error);
    return reply.code(500).send({
      error: 'INTERNAL',
      message: 'Internal server error.',
    });
  });

  // ─── Health check ──────────────────────────────────────────────────
  app.get('/health', async () => {
    const health: Record<string, string> = { service: 'prufs-cloud' };

    // DB check
    try {
      const pool = getPool();
      await pool.query('SELECT 1');
      health.db = 'connected';
    } catch {
      health.db = 'disconnected';
    }

    // R2 check
    if (isR2Configured()) {
      try {
        const r2 = getR2Config();
        await headObject(r2, '_health');
        health.r2 = 'connected';
      } catch {
        health.r2 = 'error';
      }
    } else {
      health.r2 = 'not_configured';
    }

    health.status = health.db === 'connected' ? 'ok' : 'degraded';
    return health;
  });

  // ─── API info ──────────────────────────────────────────────────────
  app.get('/', async () => ({
    service: 'prufs-cloud',
    version: '0.1.0',
    docs: 'https://docs.prufs.ai',
    endpoints: {
      health: 'GET /health',
      bootstrap: 'POST /v1/orgs',
      org: 'GET /v1/orgs/:slug',
      members: 'GET /v1/orgs/:slug/members',
      signing_keys: 'GET /v1/orgs/:slug/signing-keys',
      api_keys: 'GET /v1/orgs/:slug/api-keys',
      usage: 'GET /v1/orgs/:slug/usage',
      push_commit: 'POST /v1/commits',
      push_batch: 'POST /v1/commits/batch',
      get_commit: 'GET /v1/commits/:id',
      get_commit_full: 'GET /v1/commits/:id?full=true',
      get_blob: 'GET /v1/blobs/:hash',
      branches: 'GET /v1/branches',
      log: 'GET /v1/log',
      audit: 'GET /v1/orgs/:slug/audit',
    },
  }));

  // ─── Routes ────────────────────────────────────────────────────────
  await app.register(orgRoutes);
  await app.register(keyRoutes);
  await app.register(commitRoutes);
  await app.register(auditRoutes);
  await app.register(teamRoutes);
  await app.register(trailRoutes);
  await app.register(authRoutes);

  // ─── Graceful shutdown ─────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}. Shutting down...`);
    await app.close();
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return app;
}

// ─── Start if run directly ─────────────────────────────────────────────
const isMain = process.argv[1]?.endsWith('server.js');
if (isMain) {
  const port = parseInt(process.env.PORT ?? '3100', 10);
  const host = process.env.HOST ?? '0.0.0.0';

  const server = await buildServer();
  await server.listen({ port, host });
  server.log.info(`Prufs Cloud listening on ${host}:${port}`);
}
