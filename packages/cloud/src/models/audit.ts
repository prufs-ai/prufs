/**
 * @prufs/cloud - Audit model
 *
 * Reads and writes to the audit_log table.
 * Writes are fire-and-forget (non-blocking) — a failed audit write
 * must never surface as an error to the caller.
 */

import { query } from '../db.js';
import type { AuditEntry } from '../types.js';

export interface AuditWriteInput {
  org_id: string;
  actor_id?: string | null;
  actor_email?: string | null;
  action: string;
  category?: string;
  target_type?: string | null;
  target_id?: string | null;
  metadata?: Record<string, unknown> | null;
  ip_address?: string | null;
  result?: 'success' | 'failure';
}

export interface AuditListOptions {
  limit?: number;
  offset?: number;
  action?: string;
  category?: string;
  actor_id?: string;
  since?: string;   // ISO date string
  until?: string;   // ISO date string
}

export interface AuditPage {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

/** Write an audit entry. Never throws — failures are logged to stderr only. */
export function writeAudit(input: AuditWriteInput): void {
  query(
    `INSERT INTO audit_log
       (org_id, actor_id, actor_email, action, category,
        target_type, target_id, metadata, ip_address, result)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.org_id,
      input.actor_id ?? null,
      input.actor_email ?? null,
      input.action,
      input.category ?? 'system',
      input.target_type ?? null,
      input.target_id ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.ip_address ?? null,
      input.result ?? 'success',
    ],
  ).catch(err => {
    console.error('[audit] Failed to write audit entry:', err.message);
  });
}

/** Paginated read of audit entries for an org, newest first. */
export async function listAudit(
  orgId: string,
  opts: AuditListOptions = {},
): Promise<AuditPage> {
  const limit = Math.min(opts.limit ?? 25, 100);
  const offset = opts.offset ?? 0;

  const conditions: string[] = ['org_id = $1'];
  const params: unknown[] = [orgId];
  let idx = 2;

  if (opts.action) {
    conditions.push(`action = $${idx++}`);
    params.push(opts.action);
  }
  if (opts.category) {
    conditions.push(`category = $${idx++}`);
    params.push(opts.category);
  }
  if (opts.actor_id) {
    conditions.push(`actor_id = $${idx++}`);
    params.push(opts.actor_id);
  }
  if (opts.since) {
    conditions.push(`created_at >= $${idx++}`);
    params.push(opts.since);
  }
  if (opts.until) {
    conditions.push(`created_at <= $${idx++}`);
    params.push(opts.until);
  }

  const where = conditions.join(' AND ');

  const [dataResult, countResult] = await Promise.all([
    query<AuditEntry>(
      `SELECT id, org_id, actor_id, actor_email, action, category,
              target_type, target_id, metadata, ip_address, result, created_at
       FROM audit_log
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset],
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM audit_log WHERE ${where}`,
      params,
    ),
  ]);

  return {
    entries: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
    limit,
    offset,
  };
}
