/**
 * HttpCloudClient - production cloud client speaking the Prufs Cloud REST API.
 *
 * Default base URL is https://api.prufs.ai (the custom domain on Fly.io with
 * Lets Encrypt TLS, live as of April 7, 2026). Can be overridden for testing
 * or self-hosted deployments.
 *
 * Authentication: API key (prfs_ prefix) passed via Authorization: Bearer header.
 */

import type {
  CausalCommitLike,
  CloudClientLike,
  CommitRef,
  PushResult,
} from "./types.js";

export interface HttpCloudClientOptions {
  /** Base URL of the Prufs Cloud API. Defaults to https://api.prufs.ai */
  baseUrl?: string;
  /** API key with prfs_ prefix. Required. */
  apiKey: string;
  /** Organization slug (e.g. "cognitionhive"). Required. */
  orgSlug: string;
  /** Request timeout in ms. Defaults to 15000. */
  timeoutMs?: number;
  /** Optional custom fetch implementation (for testing). */
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.prufs.ai";
const DEFAULT_TIMEOUT_MS = 15000;

export class HttpCloudClient implements CloudClientLike {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly orgSlug: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpCloudClientOptions) {
    if (!options.apiKey) {
      throw new Error("HttpCloudClient: apiKey is required");
    }
    if (!options.orgSlug) {
      throw new Error("HttpCloudClient: orgSlug is required");
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.orgSlug = options.orgSlug;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async pushCommit(commit: CausalCommitLike): Promise<PushResult> {
    const url = `${this.baseUrl}/v1/commits`;
    const response = await this.request(url, {
      method: "POST",
      body: JSON.stringify({ commit, org_slug: this.orgSlug }),
    });

    if (response.status === 201) {
      return { commit_id: commit.commit_id, status: "accepted" };
    }
    if (response.status === 200) {
      const body = await response.json().catch(() => ({}));
      const status = (body as { status?: string }).status === "duplicate" ? "duplicate" : "accepted";
      return { commit_id: commit.commit_id, status };
    }
    if (response.status === 409) {
      return { commit_id: commit.commit_id, status: "duplicate" };
    }
    if (response.status >= 400 && response.status < 500) {
      const body = await response.text().catch(() => "");
      return {
        commit_id: commit.commit_id,
        status: "rejected",
        reason: `HTTP ${response.status}: ${body}`,
      };
    }
    // 5xx is a transient error that the engine's retry wrapper will handle.
    throw new Error(`Server error ${response.status} when pushing commit ${commit.commit_id}`);
  }

  async fetchLog(branch?: string): Promise<CommitRef[]> {
    const params = new URLSearchParams({ org_slug: this.orgSlug });
    if (branch) {
      params.set("branch", branch);
    }
    const url = `${this.baseUrl}/v1/log?${params.toString()}`;
    const response = await this.request(url, { method: "GET" });

    if (!response.ok) {
      throw new Error(`fetchLog failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as { commits?: CommitRef[] };
    return body.commits ?? [];
  }

  async fetchCommit(commit_id: string): Promise<CausalCommitLike | null> {
    const url = `${this.baseUrl}/v1/commits/${encodeURIComponent(commit_id)}?full=true`;
    const response = await this.request(url, { method: "GET" });

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`fetchCommit failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as { commit?: CausalCommitLike };
    return body.commit ?? null;
  }

  async fetchBranches(): Promise<string[]> {
    const params = new URLSearchParams({ org_slug: this.orgSlug });
    const url = `${this.baseUrl}/v1/branches?${params.toString()}`;
    const response = await this.request(url, { method: "GET" });

    if (!response.ok) {
      throw new Error(`fetchBranches failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as { branches?: string[] };
    return body.branches ?? [];
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "User-Agent": "prufs-sync/0.1.0",
          ...(init.headers ?? {}),
        },
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
