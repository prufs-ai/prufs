/**
 * @prufs/store - db.ts
 *
 * Database abstraction layer.
 *
 * Two adapters, one interface:
 *   SqlJsAdapter        - WASM, zero native deps, used in tests and dev
 *   BetterSqlite3Adapter - native bindings, used in production
 *
 * The DbAdapter interface exposes only the operations PrufsStore needs:
 *   run()   - write (INSERT, UPDATE, CREATE)
 *   get()   - read one row
 *   all()   - read many rows
 *   exec()  - multi-statement DDL (schema init)
 *
 * Do NOT attempt to build BetterSqlite3Adapter in the Claude.ai sandbox.
 * It requires node-gyp and the nodejs.org headers download is blocked.
 * Use SqlJsAdapter for all sandbox work.
 */

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS blobs (
  content_hash  TEXT PRIMARY KEY,
  content       TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  path_hint     TEXT
);

CREATE TABLE IF NOT EXISTS commits (
  commit_id   TEXT PRIMARY KEY,
  parent_hash TEXT NOT NULL,
  branch      TEXT NOT NULL DEFAULT 'main',
  timestamp   TEXT NOT NULL,
  message     TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  commit_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commits_branch    ON commits (branch);
CREATE INDEX IF NOT EXISTS idx_commits_parent    ON commits (parent_hash);
CREATE INDEX IF NOT EXISTS idx_commits_timestamp ON commits (timestamp);

CREATE TABLE IF NOT EXISTS commit_blobs (
  commit_id   TEXT NOT NULL,
  path        TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  change_type TEXT NOT NULL,
  PRIMARY KEY (commit_id, path),
  FOREIGN KEY (commit_id)    REFERENCES commits (commit_id),
  FOREIGN KEY (content_hash) REFERENCES blobs   (content_hash)
);

CREATE TABLE IF NOT EXISTS branch_heads (
  branch     TEXT PRIMARY KEY,
  commit_id  TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (commit_id) REFERENCES commits (commit_id)
);

CREATE TABLE IF NOT EXISTS merge_log (
  merge_id    TEXT PRIMARY KEY,
  branch      TEXT NOT NULL,
  commit_ids  TEXT NOT NULL,
  strategy    TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  timestamp   TEXT NOT NULL,
  detail_json TEXT NOT NULL
);
`;

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface DbAdapter {
  /** Execute a write statement with bound parameters */
  run(sql: string, params?: unknown[]): RunResult;
  /** Fetch a single row (or undefined) */
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  /** Fetch all matching rows */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  /** Execute a multi-statement DDL string */
  exec(sql: string): void;
  /** Close / release the database */
  close(): void;
}

// ---------------------------------------------------------------------------
// SqlJsAdapter - WASM backend (test / dev)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqlJsDatabase = any;

export class SqlJsAdapter implements DbAdapter {
  private db: SqlJsDatabase;

  constructor(db: SqlJsDatabase) {
    this.db = db;
  }

  run(sql: string, params: unknown[] = []): RunResult {
    const stmt = this.db.prepare(sql);
    stmt.run(params);
    const changes = this.db.getRowsModified();
    stmt.free();
    return { changes, lastInsertRowid: 0 };
  }

  get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
      const row = stmt.getAsObject() as T;
      stmt.free();
      return row;
    }
    stmt.free();
    return undefined;
  }

  all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const results: T[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return results;
  }

  exec(sql: string): void {
    this.db.run(sql);
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// BetterSqlite3Adapter - native backend (production)
// Do not instantiate in test/sandbox environments.
// ---------------------------------------------------------------------------

export class BetterSqlite3Adapter implements DbAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(db: any) {
    this.db = db;
  }

  run(sql: string, params: unknown[] = []): RunResult {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(params);
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  }

  get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
    return this.db.prepare(sql).get(params) as T | undefined;
  }

  all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    return this.db.prepare(sql).all(params) as T[];
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Factory - create an in-memory SqlJs database (test/dev)
// ---------------------------------------------------------------------------

export async function createInMemoryDb(): Promise<DbAdapter> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  return new SqlJsAdapter(db);
}
