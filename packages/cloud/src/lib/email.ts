/**
 * @prufs/cloud - Transactional email via Resend
 *
 * Shared utility for sending invite and auth recovery emails.
 * Requires RESEND_API_KEY in environment (Fly secrets).
 *
 * Resend docs: https://resend.com/docs/send-with-nodejs
 */

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

/** The verified sender domain. Update after Resend domain verification. */
const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'Prufs <noreply@prufs.ai>';

/** Base URL for dashboard links in emails. */
const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'https://dashboard.prufs.ai';

export interface SendResult {
  success: boolean;
  id?: string;
  error?: string;
}

/**
 * Send a team invite email with an accept link.
 */
export async function sendInviteEmail(
  to: string,
  orgName: string,
  role: string,
  token: string,
): Promise<SendResult> {
  const acceptUrl = `${DASHBOARD_URL}/invites/accept?token=${token}`;

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: `You've been invited to ${orgName} on Prufs`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #111; font-size: 20px; margin-bottom: 16px;">Join ${orgName} on Prufs</h2>
          <p style="color: #444; font-size: 15px; line-height: 1.6;">
            You've been invited to join <strong>${orgName}</strong> as a <strong>${role}</strong>.
          </p>
          <p style="color: #444; font-size: 15px; line-height: 1.6;">
            Prufs captures the decision trail behind every AI-generated commit: the reasoning,
            the constraints honored, the alternatives considered. Your team uses it to maintain
            institutional memory as agents contribute to the codebase.
          </p>
          <div style="margin: 32px 0;">
            <a href="${acceptUrl}"
               style="background: #3B82F6; color: #fff; padding: 12px 24px; border-radius: 6px;
                      text-decoration: none; font-size: 15px; font-weight: 500;">
              Accept Invite
            </a>
          </div>
          <p style="color: #888; font-size: 13px;">
            This invite expires in 7 days. If you didn't expect this, you can ignore this email.
          </p>
        </div>
      `,
    });

    if (error) {
      console.error('[email] invite send failed:', error);
      return { success: false, error: error.message };
    }
    return { success: true, id: data?.id };
  } catch (err) {
    console.error('[email] invite send error:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Send a magic-link auth recovery email.
 */
export async function sendRecoveryEmail(
  to: string,
  token: string,
): Promise<SendResult> {
  const recoveryUrl = `${DASHBOARD_URL}/auth/recover?token=${token}`;

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: 'Sign in to Prufs',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #111; font-size: 20px; margin-bottom: 16px;">Sign in to Prufs</h2>
          <p style="color: #444; font-size: 15px; line-height: 1.6;">
            Click the link below to sign in to your Prufs dashboard. This link is valid for 1 hour.
          </p>
          <div style="margin: 32px 0;">
            <a href="${recoveryUrl}"
               style="background: #3B82F6; color: #fff; padding: 12px 24px; border-radius: 6px;
                      text-decoration: none; font-size: 15px; font-weight: 500;">
              Sign In
            </a>
          </div>
          <p style="color: #888; font-size: 13px;">
            If you didn't request this, you can safely ignore this email. The link expires in 1 hour.
          </p>
        </div>
      `,
    });

    if (error) {
      console.error('[email] recovery send failed:', error);
      return { success: false, error: error.message };
    }
    return { success: true, id: data?.id };
  } catch (err) {
    console.error('[email] recovery send error:', err);
    return { success: false, error: String(err) };
  }
}
