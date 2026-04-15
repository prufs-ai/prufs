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

  // Current period total
  const totalResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM meter_log
     WHERE org_id = $1 AND billing_period = $2`,
    [orgId, period],
  );
  const eventsConsumed = parseInt(totalResult.rows[0].count, 10);

  // Daily history for last 90 days
  const historyResult = await query<{ day: string; count: string }>(
    `SELECT DATE(recorded_at)::text AS day, COUNT(*) AS count
     FROM meter_log
     WHERE org_id = $1 AND recorded_at >= NOW() - INTERVAL '90 days'
     GROUP BY DATE(recorded_at)
     ORDER BY day ASC`,
    [orgId],
  );

  // Reset date: first day of next calendar month (UTC)
  const now = new Date();
  const resetDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    org_id: orgId,
    billing_period: period,
    events_consumed: eventsConsumed,
    events_cap: tier === 'free' ? FREE_TIER_LIMIT : null,
    reset_date: resetDate.toISOString(),
    tier,
    history: historyResult.rows.map(r => ({ date: r.day, count: parseInt(r.count, 10) })),
  };
}

/**
 * Check rate limit before accepting a commit push.
 * Throws RateLimitError for Free tier orgs over 10K.
 */
export async function checkRateLimit(orgId: string, tier: string): Promise<void> {
  if (tier !== 'free') return; // Pro and Enterprise have no hard cap

  const usage = await getUsage(orgId, tier);
  if (usage.events_consumed >= FREE_TIER_LIMIT) {
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

  return {
    org_id: orgId,
    billing_period: period,
    events_consumed: eventCount,
    events_cap: tier === 'free' ? FREE_TIER_LIMIT : null,
    reset_date: '',
    tier,
    history: [],
  };
}
