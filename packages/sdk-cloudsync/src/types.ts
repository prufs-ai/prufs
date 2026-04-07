import type {
  LocalStoreLike,
  CloudClientLike,
  SyncEventType,
  SyncEventPayload,
  SyncSummary,
  SyncStatus,
  SyncEngineOptions,
} from "@prufs/sync";

/**
 * Configuration for CloudSync. Consumers supply credentials and a local store;
 * CloudSync constructs the HTTP client and sync engine internally.
 */
export interface CloudSyncConfig {
  /** Prufs API key (Bearer token). Required unless cloudClient is supplied. */
  apiKey?: string;
  /** Organization slug. Required unless cloudClient is supplied. */
  orgSlug?: string;
  /** Local causal commit store. Required. */
  localStore: LocalStoreLike;
  /** Override the default API base URL. Defaults to https://api.prufs.ai. */
  baseUrl?: string;
  /** Request timeout in ms. Defaults to 15000. */
  timeoutMs?: number;
  /** Inject a custom fetch implementation (for testing). */
  fetchImpl?: typeof fetch;
  /** Inject a pre-built cloud client. When supplied, apiKey/orgSlug/baseUrl are ignored. */
  cloudClient?: CloudClientLike;
  /** Advanced sync engine options (batchSize, retry envelope, etc). */
  engineOptions?: SyncEngineOptions;
}

export type {
  LocalStoreLike,
  CloudClientLike,
  SyncEventType,
  SyncEventPayload,
  SyncSummary,
  SyncStatus,
};
