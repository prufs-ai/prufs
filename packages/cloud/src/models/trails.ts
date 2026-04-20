import { query } from '../db.js'

interface TrailSummaryRow {
  trail_id: string
  root_directive: string
  sensitivity: string
  integrity: string
  created_at: string
}

interface TrailRow extends TrailSummaryRow {
  nodes: unknown
  edges: unknown
}

export async function listTrails(
  orgId: string,
  sensitivity?: string
): Promise<TrailSummaryRow[]> {
  if (sensitivity && sensitivity !== 'all') {
    const result = await query<TrailSummaryRow>(
      `SELECT trail_id, root_directive, sensitivity, integrity, created_at
       FROM trails
       WHERE org_id = $1 AND sensitivity = $2
       ORDER BY created_at DESC`,
      [orgId, sensitivity]
    )
    return result.rows
  }
  const result = await query<TrailSummaryRow>(
    `SELECT trail_id, root_directive, sensitivity, integrity, created_at
     FROM trails
     WHERE org_id = $1
     ORDER BY created_at DESC`,
    [orgId]
  )
  return result.rows
}

export async function getTrail(
  orgId: string,
  trailId: string
): Promise<TrailRow | null> {
  const result = await query<TrailRow>(
    `SELECT trail_id, root_directive, sensitivity, integrity, nodes, edges, created_at
     FROM trails
     WHERE org_id = $1 AND trail_id = $2`,
    [orgId, trailId]
  )
  return result.rows[0] ?? null
}
