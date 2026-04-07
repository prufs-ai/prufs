/**
 * @prufs/sync
 *
 * Bidirectional sync engine between @prufs/store (local SQLite) and
 * @prufs/cloud (api.prufs.ai + R2).
 *
 * Quick start:
 *
 *   import { SyncEngine, HttpCloudClient } from "@prufs/sync";
 *   import { PrufsStore } from "@prufs/store";
 *
 *   const store = new PrufsStore({ path: ".prufs/store.db" });
 *   const cloud = new HttpCloudClient({
 *     apiKey: process.env.PRUFS_API_KEY,
 *     orgSlug: "cognitionhive",
 *   });
 *
 *   const engine = new SyncEngine(store, cloud);
 *
 *   engine.on("sync:complete", (e) => console.log("synced:", e.count));
 *
 *   const summary = await engine.sync();
 *   console.log(summary);
 */

export { SyncEngine, isCausalCommit } from "./engine.js";
export { HttpCloudClient } from "./http-client.js";
export { SyncEmitter } from "./emitter.js";
export { computeDiff, groupByBranch } from "./diff.js";
export { computeBackoffDelay, sleep, withRetry } from "./backoff.js";

export type {
  CausalCommitLike,
  CommitRef,
  CloudClientLike,
  LocalStoreLike,
  PushResult,
  SyncEngineOptions,
  SyncEventPayload,
  SyncEventType,
  SyncStatus,
  SyncSummary,
} from "./types.js";

export type { HttpCloudClientOptions } from "./http-client.js";
export type { DiffResult } from "./diff.js";
export type { BackoffOptions } from "./backoff.js";
