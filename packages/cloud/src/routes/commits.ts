/**
 * @prufs/cloud - Commit ingest routes
 *
 * POST   /v1/commits              Push a CausalCommit (auth required, metered)
 * POST   /v1/commits/batch        Push multiple commits (auth required, metered)
 * GET    /v1/commits/:id          Get a single commit (auth required)
 * GET    /v1/branches             List branch heads (auth required)
 * GET    /v1/log                  Commit log for a branch (auth required)
 */

import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { verifyCommit } from '../verifier.js';
import { verifySignatures } from '../signatures.js';
import * as commitStore from '../models/commits.js';
import * as meter from '../models/meter.js';
import { query } from '../db.js';
import type { CausalCommit } from '../commit-types.js';

export async function commitRoutes(app: FastifyInstance): Promise<void> {

  // ─── Push a single commit ──────────────────────────────────────────
  app.post(
    '/v1/commits',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const orgId = request.auth.org_id;
      const tier = request.auth.org_tier;

      // Rate limit check (Free tier)
      await meter.checkRateLimit(orgId, tier);

      // Verify the commit
      const verification = await verifyCommit(request.body, {
        commitExists: (id) => commitStore.commitExists(orgId, id),
      });

      if (!verification.valid) {
        // Log rejection for Enterprise orgs
        if (tier === 'enterprise') {
          await query(
            `INSERT INTO rejected_commits (org_id, commit_payload, rejection_reason, rejection_step)
             VALUES ($1, $2, $3, $4)`,
            [orgId, JSON.stringify(request.body), verification.message, verification.step],
          );
        }

        return reply.code(422).send({
          error: 'VERIFICATION_FAILED',
          step: verification.step,
          message: verification.message,
          expected: verification.expected,
          actual: verification.actual,
        });
      }

      const commit = request.body as CausalCommit;

      // Signature verification (Ed25519 - requires registered signing key)
      const sigResult = await verifySignatures(orgId, commit);
      if (!sigResult.valid) {
        if (tier === 'enterprise') {
          await query(
            `INSERT INTO rejected_commits (org_id, commit_payload, rejection_reason, rejection_step)
             VALUES ($1, $2, $3, $4)`,
            [orgId, JSON.stringify(request.body), sigResult.message, sigResult.step],
          );
        }

        return reply.code(422).send({
          error: 'SIGNATURE_FAILED',
          step: sigResult.step,
          message: sigResult.message,
        });
      }

      // Store the verified commit
      const result = await commitStore.storeCommit(orgId, commit);

      // Record billable event (only if newly stored, not idempotent skip)
      if (result.stored) {
        await meter.recordEvent(orgId, 'commit_push', commit.commit_id);
      }

      // Audit log
      await query(
        `INSERT INTO audit_log (org_id, user_id, action, target_type, target_id, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          orgId,
          request.auth.user_id,
          'commit.push',
          'commit',
          commit.commit_id,
          JSON.stringify({
            branch: commit.branch ?? 'main',
            agent_id: commit.attestation.agent_id,
            stored: result.stored,
          }),
        ],
      );

      return reply.code(result.stored ? 201 : 200).send({
        commit_id: commit.commit_id,
        stored: result.stored,
        branch: commit.branch ?? 'main',
        message: result.stored ? 'Commit verified and stored.' : 'Commit already exists (idempotent).',
      });
    },
  );

  // ─── Push batch of commits ─────────────────────────────────────────
  app.post(
    '/v1/commits/batch',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const orgId = request.auth.org_id;
      const tier = request.auth.org_tier;

      const body = request.body as { commits: unknown[] };
      if (!body.commits || !Array.isArray(body.commits)) {
        return reply.code(400).send({
          error: 'VALIDATION',
          message: 'Request body must contain a "commits" array.',
        });
      }

      if (body.commits.length > 100) {
        return reply.code(400).send({
          error: 'VALIDATION',
          message: 'Batch size limit: 100 commits per request.',
        });
      }

      // Rate limit check
      await meter.checkRateLimit(orgId, tier);

      const results: Array<{
        index: number;
        commit_id?: string;
        stored?: boolean;
        error?: string;
        step?: string;
      }> = [];

      for (let i = 0; i < body.commits.length; i++) {
        const raw = body.commits[i];

        const verification = await verifyCommit(raw, {
          commitExists: (id) => commitStore.commitExists(orgId, id),
        });

        if (!verification.valid) {
          results.push({
            index: i,
            error: verification.message,
            step: verification.step,
          });
          continue;
        }

        const commit = raw as CausalCommit;

        // Signature verification
        const sigResult = await verifySignatures(orgId, commit);
        if (!sigResult.valid) {
          results.push({
            index: i,
            error: sigResult.message,
            step: sigResult.step,
          });
          continue;
        }

        const storeResult = await commitStore.storeCommit(orgId, commit);

        if (storeResult.stored) {
          await meter.recordEvent(orgId, 'commit_push', commit.commit_id);
        }

        results.push({
          index: i,
          commit_id: commit.commit_id,
          stored: storeResult.stored,
        });
      }

      const stored = results.filter((r) => r.stored === true).length;
      const skipped = results.filter((r) => r.stored === false).length;
      const failed = results.filter((r) => r.error).length;

      return reply.code(200).send({
        total: body.commits.length,
        stored,
        skipped,
        failed,
        results,
      });
    },
  );

  // ─── Get a single commit ──────────────────────────────────────────
  app.get(
    '/v1/commits/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const commit = await commitStore.getCommit(request.auth.org_id, id);

      if (!commit) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Commit not found.' });
      }

      return commit;
    },
  );

  // ─── List branch heads ────────────────────────────────────────────
  app.get(
    '/v1/branches',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      return commitStore.getBranchHeads(request.auth.org_id);
    },
  );

  // ─── Commit log ───────────────────────────────────────────────────
  app.get(
    '/v1/log',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const qs = request.query as { branch?: string; limit?: string };
      const branch = qs.branch ?? 'main';
      const limit = Math.min(parseInt(qs.limit ?? '50', 10), 200);

      return commitStore.getCommitLog(request.auth.org_id, branch, limit);
    },
  );
}
