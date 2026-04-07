import {
  SyncEngine,
  HttpCloudClient,
  type CloudClientLike,
  type SyncEventPayload,
  type SyncEventType,
  type SyncStatus,
  type SyncSummary,
} from "@prufs/sync";
import type { CloudSyncConfig } from "./types.js";

/**
 * CloudSync — one-import wrapper around the @prufs/sync engine.
 *
 * Usage:
 *   const cloud = new CloudSync({ apiKey, orgSlug, localStore });
 *   await cloud.sync();
 *
 * CloudSync owns the HTTP client and the sync engine; consumers interact with
 * a single facade. All events emitted by the underlying engine are re-emitted
 * here, so consumers can subscribe without reaching into internals.
 */
export class CloudSync {
  private readonly engine: SyncEngine;
  private readonly client: CloudClientLike;

  constructor(config: CloudSyncConfig) {
    if (!config) {
      throw new Error("CloudSync: config is required");
    }
    if (!config.localStore) {
      throw new Error("CloudSync: config.localStore is required");
    }

    this.client =
      config.cloudClient ??
      new HttpCloudClient({
        apiKey: this.requireField(config.apiKey, "apiKey"),
        orgSlug: this.requireField(config.orgSlug, "orgSlug"),
        baseUrl: config.baseUrl,
        timeoutMs: config.timeoutMs,
        fetchImpl: config.fetchImpl,
      });

    this.engine = new SyncEngine(
      config.localStore,
      this.client,
      config.engineOptions
    );
  }

  private requireField(value: string | undefined, name: string): string {
    if (!value || typeof value !== "string") {
      throw new Error(`CloudSync: config.${name} is required`);
    }
    return value;
  }

  /** Pull new commits from cloud to local. Returns count pulled. */
  async pull(branch?: string): Promise<number> {
    return this.engine.pull(branch);
  }

  /**
   * Push local commits to cloud. Returns a tuple of
   * [pushed, duplicates, rejected].
   */
  async push(branch?: string): Promise<[number, number, number]> {
    return this.engine.push(branch);
  }

  /** Full bidirectional sync (pull then push). */
  async sync(branch?: string): Promise<SyncSummary> {
    return this.engine.sync(branch);
  }

  /** Report current sync state without transferring any commits. */
  async status(): Promise<SyncStatus> {
    return this.engine.status();
  }

  /** Subscribe to sync events. Use "*" for a wildcard listener. */
  on(
    event: SyncEventType | "*",
    listener: (payload: SyncEventPayload) => void
  ): this {
    this.engine.on(event, listener);
    return this;
  }

  /** Unsubscribe a previously registered listener. */
  off(
    event: SyncEventType | "*",
    listener: (payload: SyncEventPayload) => void
  ): this {
    this.engine.off(event, listener);
    return this;
  }

  /** Direct access to the underlying engine for advanced callers. */
  get rawEngine(): SyncEngine {
    return this.engine;
  }

  /** Direct access to the underlying cloud client for advanced callers. */
  get rawClient(): CloudClientLike {
    return this.client;
  }
}
