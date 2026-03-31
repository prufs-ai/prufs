/**
 * @prufs/cloud - Database connection pool
 *
 * Works with Neon serverless, local Postgres, Docker, or any PG-compatible.
 * Set DATABASE_URL in environment. Falls back to localhost for dev.
 */

import pg from 'pg';

const { Pool } = pg;

export interface DbConfig {
  connectionString?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

let pool: pg.Pool | null = null;

export function getPool(config?: DbConfig): pg.Pool {
  if (pool) return pool;

  const connectionString =
    config?.connectionString ||
    process.env.DATABASE_URL ||
    'postgresql://localhost:5432/prufs';

  pool = new Pool({
    connectionString,
    max: config?.max ?? 10,
    idleTimeoutMillis: config?.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: config?.connectionTimeoutMillis ?? 5_000,
    ssl: connectionString.includes('neon.tech') || connectionString.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : undefined,
  });

  pool.on('error', (err) => {
    console.error('[prufs/cloud] Unexpected pool error:', err.message);
  });

  return pool;
}

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[],
): Promise<pg.QueryResult<T>> {
  const p = getPool();
  return p.query<T>(text, params);
}

export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
