/**
 * Shared types for @prufs/sync
 *
 * These types describe the minimal surface area of CausalCommit and Store that
 * the sync engine needs. The production build will re-export from @prufs/commit
 * and @prufs/store; for this package we define local structural types so the
 * sync engine compiles and tests without pulling in the full peer packages.
 */

/**
 * Minimal structural shape of a CausalCommit, matching @prufs/commit.
 * The sync engine does not re-verify cryptographic signatures (that is the
 * cloud Verifier's responsibility on ingest); it treats commits as opaque
 * envelopes identified by commit_id and linked by parent_hash.
 */
export interface CausalCommitLike {
  commit_id: string;
  parent_hash: string;
  timestamp: string;
  trail: unknown;
  attestation: unknown;
  changeset: unknown;
  commit_signature: string;
  signer_key_id: string;
  message: string;
  branch?: string;
}

/**
 * A lightweight reference to a commit in the local store's log.
 */
export interface CommitRef {
  commit_id: string;
  parent_hash: string;
  branch: string;
  timestamp: string;
}

/**
 * Minimal structural interface for the local @prufs/store.
 * The sync engine depends only on these methods.
 */
export interface LocalStoreLike {
  /** Return the ordered commit log, oldest first. Optionally filtered by branch. */
  log(branch?: string): Promise<CommitRef[]>;
  /** Retrieve a full commit by id. */
  get(commit_id: string): Promise<CausalCommitLike | null>;
  /** Store a commit retrieved from the cloud. Idempotent. */
  put(commit: CausalCommitLike): Promise<void>;
  /** Return the head commit id for every branch. */
  heads(): Promise<Record<string, string>>;
  /** List all known branches. */
  branches(): Promise<string[]>;
}

/**
 * Minimal structural interface for a cloud client speaking the Prufs Cloud REST API.
 * The real implementation uses fetch against https://api.prufs.ai; the test suite
 * uses an in-memory mock that implements the same interface.
 */
export interface CloudClientLike {
  /** POST /v1/commits - push a single commit. Returns the server-assigned commit id (same as local). */
  pushCommit(commit: CausalCommitLike): Promise<PushResult>;
  /** GET /v1/log - retrieve the server commit log for a branch. */
  fetchLog(branch?: string): Promise<CommitRef[]>;
  /** GET /v1/commits/:id?full=true - retrieve a full commit from the server. */
  fetchCommit(commit_id: string): Promise<CausalCommitLike | null>;
  /** GET /v1/branches - list known server-side branches. */
  fetchBranches(): Promise<string[]>;
}

/**
 * Result of pushing a single commit to the cloud.
 */
export interface PushResult {
  commit_id: string;
  status: "accepted" | "duplicate" | "rejected";
  reason?: string;
}

/**
 * Event types emitted by the sync engine during a sync operation.
 * Consumers can subscribe via SyncEngine.on() for progress reporting.
 */
export type SyncEventType =
  | "sync:start"
  | "sync:complete"
  | "sync:error"
  | "pull:start"
  | "pull:commit"
  | "pull:complete"
  | "push:start"
  | "push:commit"
  | "push:complete"
  | "merge:conflict"
  | "merge:resolved";

export interface SyncEventPayload {
  type: SyncEventType;
  branch?: string;
  commit_id?: string;
  message?: string;
  error?: Error;
  count?: number;
}

/**
 * Configuration for the sync engine.
 */
export interface SyncEngineOptions {
  /** Maximum number of commits to batch in a single push. Default 25. */
  batchSize?: number;
  /** Maximum retry attempts on transient failure. Default 3. */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. Default 200. */
  retryBaseMs?: number;
  /** Optional logger callback for verbose output. */
  logger?: (message: string) => void;
}

/**
 * Summary returned by sync operations.
 */
export interface SyncSummary {
  pulled: number;
  pushed: number;
  duplicates: number;
  rejected: number;
  errors: number;
  branches: string[];
  duration_ms: number;
}

/**
 * Status report from a dry-run status() call.
 */
export interface SyncStatus {
  local_ahead: Record<string, number>;
  cloud_ahead: Record<string, number>;
  in_sync: string[];
  diverged: string[];
}
