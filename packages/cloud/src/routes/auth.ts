/**
 * @prufs/cloud - Auth recovery routes
 *
 * POST /v1/auth/recover   Request a magic-link email
 * GET  /v1/auth/verify     Consume token, return session
 *
 * These routes are PUBLIC (no requireAuth). Rate limiting applies via
 * the global rate-limit plugin (keyed on IP for unauthenticated requests).
 */

import type { FastifyInstance } from 'fastify';
import * as recoveryModel from '../models/auth-recovery.js';
import { sendRecoveryEmail } from '../lib/email.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {

  /**
   * POST /v1/auth/recover
   *
   * Body: { email: string }
   *
   * Always returns 200 regardless of whether the email exists,
   * to prevent email enumeration. If the email is registered,
   * a magic-link email is sent.
   */
  app.post('/v1/auth/recover', async (request, reply) => {
    const body = request.body as { email?: string };

    if (!body.email || typeof body.email !== 'string' || !body.email.includes('@')) {
      return reply.code(400).send({
        error: 'VALIDATION',
        message: 'A valid email address is required.',
      });
    }

    const email = body.email.toLowerCase().trim();
    const token = await recoveryModel.createRecoveryToken(email);

    // Send email only if the user exists and a token was created.
    // The response is identical either way (prevents enumeration).
    if (token) {
      const result = await sendRecoveryEmail(email, token);
      if (!result.success) {
        app.log.error({ email, error: result.error }, 'Recovery email send failed');
      }
    }

    return reply.code(200).send({
      message: 'If that email is registered, a sign-in link has been sent.',
    });
  });

  /**
   * GET /v1/auth/verify?token=<hex>
   *
   * Consumes the magic-link token. If valid, returns the user's email
   * and a session token that the dashboard stores in localStorage.
   *
   * NOTE: The session/JWT creation depends on your existing auth setup.
   * The placeholder below returns the email so the dashboard can call
   * your existing login flow. Replace the response with a real session
   * token once the auth module is confirmed.
   */
  app.get('/v1/auth/verify', async (request, reply) => {
    const { token } = request.query as { token?: string };

    if (!token || typeof token !== 'string' || token.length < 32) {
      return reply.code(400).send({
        error: 'VALIDATION',
        message: 'A valid token is required.',
      });
    }

    const email = await recoveryModel.consumeRecoveryToken(token);

    if (!email) {
      return reply.code(401).send({
        error: 'INVALID_TOKEN',
        message: 'This link has expired or has already been used.',
      });
    }

    // TODO: Replace with your existing session/JWT creation logic.
    // For now, return the verified email so the dashboard can
    // complete the sign-in flow.
    return reply.code(200).send({
      verified: true,
      email,
    });
  });
}
