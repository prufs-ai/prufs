/**
 * @prufs/git-bridge - config.ts
 *
 * Typed configuration for the Git bridge scheduler and exporter.
 *
 * DEPRECATION NOTICE
 * ------------------
 * This package is a migration shim with a shelf life.
 * It exists to keep existing Git-dependent CI/CD pipelines alive during
 * team transitions to Prufs. If your team is fully on Prufs, you do not
 * need this package and should remove it.
 *
 * The Git mirror produced by this bridge is a lossy read-only snapshot.
 * Prufs never reads from it. Do not treat it as a source of truth.
 */

// ---------------------------------------------------------------------------
// Git author identity (required by Git, not meaningful to Prufs)
// ---------------------------------------------------------------------------

export interface GitAuthorConfig {
  /** Display name written into Git commit author field */
  name: string;
  /** Email written into Git commit author field */
  email: string;
}

// ---------------------------------------------------------------------------
// Remote authentication
// ---------------------------------------------------------------------------

export type GitAuthConfig =
  | { type: 'token'; token: string }
  | { type: 'ssh'; keyPath: string }
  | { type: 'none' };

// ---------------------------------------------------------------------------
// Per-branch export configuration
// ---------------------------------------------------------------------------

export interface BranchExportConfig {
  /**
   * Prufs branch name to export (e.g. 'main', 'feature/payments').
   * This is the branch in @prufs/store, not a Git branch name.
   */
  prufs_branch: string;

  /**
   * Git branch name to push to on the remote (e.g. 'main', 'prufs-mirror').
   * Defaults to prufs_branch if not specified.
   */
  git_branch?: string;
}

// ---------------------------------------------------------------------------
// Top-level bridge configuration
// ---------------------------------------------------------------------------

export interface BridgeConfig {
  /**
   * Cron expression for the export schedule.
   *
   * Examples:
   *   '0 * * * *'       - every hour
   *   '0 2 * * *'       - daily at 2am
   *   '0,30 * * * *'    - every 30 minutes
   *
   * Standard 5-field cron format (minute hour day month weekday).
   * Do not use sub-minute schedules - the overhead of a full snapshot
   * export makes sub-minute runs wasteful and potentially harmful.
   */
  schedule: string;

  /** Git remote URL (HTTPS or SSH) */
  remote_url: string;

  /** Authentication for the remote */
  auth: GitAuthConfig;

  /** Author identity written into synthetic Git commits */
  author: GitAuthorConfig;

  /** Branches to export. At least one required. */
  branches: BranchExportConfig[];

  /**
   * Working directory for the local Git mirror repo.
   * Will be created if it does not exist.
   * The bridge maintains a persistent local repo here between runs
   * to avoid re-initialising on every export.
   */
  mirror_dir: string;

  /**
   * Maximum number of export result records to keep in memory.
   * Oldest records are dropped when this limit is exceeded.
   * Default: 100.
   */
  history_limit?: number;

  /**
   * If true, log each export run result to console.
   * Default: true.
   */
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateConfig(config: BridgeConfig): string[] {
  const errors: string[] = [];

  if (!config.schedule || typeof config.schedule !== 'string') {
    errors.push('schedule is required (cron expression string)');
  }

  if (!config.remote_url || typeof config.remote_url !== 'string') {
    errors.push('remote_url is required');
  }

  if (!config.author?.name) errors.push('author.name is required');
  if (!config.author?.email) errors.push('author.email is required');

  if (!config.branches || config.branches.length === 0) {
    errors.push('at least one branch must be configured');
  }

  for (const b of config.branches ?? []) {
    if (!b.prufs_branch) {
      errors.push('each branch config must specify prufs_branch');
    }
  }

  if (!config.mirror_dir || typeof config.mirror_dir !== 'string') {
    errors.push('mirror_dir is required');
  }

  return errors;
}
