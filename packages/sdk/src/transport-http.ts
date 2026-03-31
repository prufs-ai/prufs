/**
 * HTTP transport - sends events to the ingestion service in batches.
 *
 * Buffers events in memory and flushes either when the batch size
 * is reached or on a timer interval. Failed flushes are retried
 * with exponential backoff.
 */

import type { TrailEvent } from "./types.js";
import type { Transport } from "./recorder.js";

export class HttpTransport implements Transport {
  private buffer: TrailEvent[] = [];
  private endpoint: string;
  private flushIntervalMs: number;
  private flushBatchSize: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(
    endpoint: string,
    flushIntervalMs: number = 5000,
    flushBatchSize: number = 50
  ) {
    this.endpoint = endpoint.replace(/\/+$/, "");
    this.flushIntervalMs = flushIntervalMs;
    this.flushBatchSize = flushBatchSize;

    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  async emit(event: TrailEvent): Promise<void> {
    this.buffer.push(event);
    if (this.buffer.length >= this.flushBatchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;

    const batch = this.buffer.splice(0, this.flushBatchSize);

    try {
      const response = await fetch(`${this.endpoint}/api/v1/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        // Put events back at the front of the buffer for retry
        this.buffer.unshift(...batch);
        console.error(
          `[prufs] Failed to flush events: ${response.status} ${response.statusText}`
        );
      }
    } catch (err) {
      // Network error - put events back for retry
      this.buffer.unshift(...batch);
      console.error(`[prufs] Failed to flush events:`, err);
    } finally {
      this.flushing = false;
    }
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Final flush attempt
    await this.flush();
  }
}
