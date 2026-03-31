/**
 * @prufs/cloud - Meter service
 *
 * Counts billable events per org per billing period.
 * Enforces Free tier hard cap (10K events/month).
 */

import { query } from '../db.js';
import type { UsageSummary } from '../types.js';
import { RateLimitError } from '../types.js';

const FREE_TIER_LIMIT = 10_000;

function currentBillingPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function recordEvent(
  orgId: string,
  eventType: string,
  commitId?: string,
): Promise<void> {
  const period = currentBillingPeriod();
  await query(
    `INSERT INTO meter_log (org_id, event_type, commit_id, billing_period)
     VALUES ($1, $2, $3, $4)`,
    [orgId, eventType, commitId ?? null, period],
  );
}

export async function getUsage(orgId: string, tier: string): Promise<UsageSummary> {
  const period = currentBillingPeriod();
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM meter_log
     WHERE org_id = $1 AND billing_period = $2`,
    [orgId, period],
  );

  const eventCount = parseInt(result.rows[0].count, 10);
  const limit = tier === 'free' ? FREE_TIER_LIMIT : null;

  return {
    org_id: orgId,
    billing_period: period,
    event_count: eventCount,
    tier,
    limit,
  };
}

/**
 * Check rate limit before accepting a commit push.
 * Throws RateLimitError for Free tier orgs over 10K.
 */
export async function checkRateLimit(orgId: string, tier: string): Promise<void> {
  if (tier !== 'free') return; // Pro and Enterprise have no hard cap

  const usage = await getUsage(orgId, tier);
  if (usage.event_count >= FREE_TIER_LIMIT) {
    throw new RateLimitError(0, FREE_TIER_LIMIT);
  }
}

export async function getUsageForPeriod(
  orgId: string,
  period: string,
  tier: string,
): Promise<UsageSummary> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM meter_log
     WHERE org_id = $1 AND billing_period = $2`,
    [orgId, period],
  );

  const eventCount = parseInt(result.rows[0].count, 10);
  const limit = tier === 'free' ? FREE_TIER_LIMIT : null;

  return {
    org_id: orgId,
    billing_period: period,
    event_count: eventCount,
    tier,
    limit,
  };
}
