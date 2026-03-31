/**
 * @prufs/git-bridge
 *
 * DEPRECATION NOTICE
 * ------------------
 * This package is a migration shim with a shelf life.
 * It exists to keep Git-dependent CI/CD pipelines alive while your team
 * transitions to Prufs as the primary VCS.
 *
 * If your team is fully on Prufs, you do not need this package.
 * Remove it. The Git mirror it produces is lossy, read-only, and never
 * read back by Prufs. It is not a source of truth.
 *
 * Public API
 * ----------
 * BridgeScheduler  - the only entry point for enterprise use
 * PrufsGitExporter - the underlying snapshot exporter (for testing)
 * BridgeConfig     - configuration type
 * validateConfig   - config validation helper
 */

export { BridgeScheduler } from './scheduler.js';
export type { SchedulerStatus } from './scheduler.js';

export { PrufsGitExporter } from './exporter.js';
export type { ExportResult, PrufsStoreAdapter } from './exporter.js';

export type {
  BridgeConfig,
  BranchExportConfig,
  GitAuthorConfig,
  GitAuthConfig,
} from './config.js';
export { validateConfig } from './config.js';
