/**
 * @prufs/git-bridge - scheduler.ts
 *
 * BridgeScheduler: wraps PrufsGitExporter in a node-cron schedule.
 *
 * The schedule is the only way to trigger exports in an enterprise context.
 * There is no ad-hoc / on-demand export path exposed in this class.
 * That is intentional: predictable, scheduled snapshots are operationally
 * safer than event-driven exports when the source (Prufs) may produce
 * thousands of commits per hour.
 *
 * Usage:
 *   const scheduler = new BridgeScheduler(store, config);
 *   scheduler.start();   // begins cron, returns immediately
 *   scheduler.stop();    // graceful shutdown, waits for any in-flight run
 *   scheduler.status();  // last N results, next scheduled run time, running state
 */

import * as cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { PrufsGitExporter } from './exporter.js';
import type { ExportResult, PrufsStoreAdapter } from './exporter.js';
import type { BridgeConfig } from './config.js';
import { validateConfig } from './config.js';

// ---------------------------------------------------------------------------
// Scheduler status
// ---------------------------------------------------------------------------

export interface SchedulerStatus {
  running: boolean;
  schedule: string;
  last_run_at: string | null;
  last_results: ExportResult[];
  total_runs: number;
  total_failures: number;
}

// ---------------------------------------------------------------------------
// BridgeScheduler
// ---------------------------------------------------------------------------

export class BridgeScheduler {
  private config: BridgeConfig;
  private exporter: PrufsGitExporter;
  private task: ScheduledTask | null = null;
  private running = false;
  private inFlight = false;
  private totalRuns = 0;
  private totalFailures = 0;
  private lastRunAt: string | null = null;

  constructor(store: PrufsStoreAdapter, config: BridgeConfig) {
    const errors = validateConfig(config);
    if (errors.length > 0) {
      throw new Error(
        `Invalid BridgeConfig:\n  ${errors.join('\n  ')}`
      );
    }

    if (config.schedule && !cron.validate(config.schedule)) {
      throw new Error(
        `Invalid cron expression: '${config.schedule}'`
      );
    }

    this.config = config;
    this.exporter = new PrufsGitExporter(store, config);
  }

  // -------------------------------------------------------------------------
  // start() - begin the cron schedule
  // -------------------------------------------------------------------------

  start(): void {
    if (this.running) {
      console.warn('[prufs-git-bridge] Scheduler is already running');
      return;
    }

    if (!cron.validate(this.config.schedule)) {
      throw new Error(
        `Invalid cron expression: '${this.config.schedule}'`
      );
    }

    this.task = cron.schedule(this.config.schedule, () => {
      void this.runExport();
    });

    this.running = true;

    if (this.config.verbose !== false) {
      console.log(
        `[prufs-git-bridge] Scheduler started. Schedule: '${this.config.schedule}'. ` +
        `Branches: ${this.config.branches.map((b) => b.prufs_branch).join(', ')}. ` +
        `Remote: ${this.config.remote_url}`
      );
      console.log(
        '[prufs-git-bridge] DEPRECATION NOTICE: This bridge is a migration shim. ' +
        'Remove it once your team is fully on Prufs.'
      );
    }
  }

  // -------------------------------------------------------------------------
  // stop() - graceful shutdown
  // -------------------------------------------------------------------------

  async stop(): Promise<void> {
    if (!this.running) return;

    this.task?.stop();
    this.task = null;
    this.running = false;

    // Wait for any in-flight export to complete
    if (this.inFlight) {
      if (this.config.verbose !== false) {
        console.log('[prufs-git-bridge] Waiting for in-flight export to complete...');
      }
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (!this.inFlight) {
            clearInterval(interval);
            resolve();
          }
        }, 100);
      });
    }

    if (this.config.verbose !== false) {
      console.log('[prufs-git-bridge] Scheduler stopped.');
    }
  }

  // -------------------------------------------------------------------------
  // status() - current state + last N results
  // -------------------------------------------------------------------------

  status(historyLimit = 10): SchedulerStatus {
    return {
      running: this.running,
      schedule: this.config.schedule,
      last_run_at: this.lastRunAt,
      last_results: this.exporter.history(historyLimit),
      total_runs: this.totalRuns,
      total_failures: this.totalFailures,
    };
  }

  // -------------------------------------------------------------------------
  // isRunning() - simple state check
  // -------------------------------------------------------------------------

  isRunning(): boolean {
    return this.running;
  }

  // -------------------------------------------------------------------------
  // Private: run one export cycle (called by cron tick)
  // -------------------------------------------------------------------------

  private async runExport(): Promise<void> {
    if (this.inFlight) {
      console.warn(
        '[prufs-git-bridge] Previous export still in flight, skipping this tick. ' +
        'Consider lengthening the schedule interval.'
      );
      return;
    }

    this.inFlight = true;
    this.totalRuns++;
    this.lastRunAt = new Date().toISOString();

    try {
      const results = await this.exporter.exportAll();
      const failures = results.filter((r) => !r.ok);
      this.totalFailures += failures.length;

      if (failures.length > 0 && this.config.verbose !== false) {
        console.error(
          `[prufs-git-bridge] ${failures.length} branch export(s) failed this run:`,
          failures.map((r) => `${r.prufs_branch}: ${r.error}`).join(', ')
        );
      }
    } catch (err) {
      this.totalFailures++;
      console.error('[prufs-git-bridge] Unexpected error during export run:', err);
    } finally {
      this.inFlight = false;
    }
  }
}
