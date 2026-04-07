/**
 * Tests for exponential backoff with jitter.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { computeBackoffDelay, sleep, withRetry } from "./backoff.js";

describe("computeBackoffDelay", () => {
  it("returns a delay within the exponential envelope for attempt 0", () => {
    for (let i = 0; i < 100; i++) {
      const delay = computeBackoffDelay(0, { baseMs: 100, maxRetries: 5 });
      assert.ok(delay >= 0);
      assert.ok(delay < 100);
    }
  });

  it("doubles the envelope for each attempt", () => {
    // Attempt 2 envelope is base * 4 = 400. With full jitter, delay < 400.
    for (let i = 0; i < 100; i++) {
      const delay = computeBackoffDelay(2, { baseMs: 100, maxRetries: 5 });
      assert.ok(delay >= 0);
      assert.ok(delay < 400);
    }
  });

  it("caps the delay at maxDelayMs", () => {
    // attempt 10 would be 100 * 1024 = 102400, capped at 5000
    for (let i = 0; i < 100; i++) {
      const delay = computeBackoffDelay(10, {
        baseMs: 100,
        maxRetries: 20,
        maxDelayMs: 5000,
      });
      assert.ok(delay < 5000);
    }
  });
});

describe("sleep", () => {
  it("waits at least the specified duration", async () => {
    const start = Date.now();
    await sleep(20);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 15); // allow 5ms timer tolerance
  });
});

describe("withRetry", () => {
  it("returns the result on first success", async () => {
    const result = await withRetry(
      async () => "ok",
      { baseMs: 1, maxRetries: 3 }
    );
    assert.equal(result, "ok");
  });

  it("retries on failure and eventually succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("transient");
        return "eventually";
      },
      { baseMs: 1, maxRetries: 3 }
    );
    assert.equal(result, "eventually");
    assert.equal(attempts, 3);
  });

  it("throws after exhausting all retries", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            attempts++;
            throw new Error("persistent");
          },
          { baseMs: 1, maxRetries: 2 }
        ),
      /persistent/
    );
    assert.equal(attempts, 3); // 1 initial + 2 retries
  });

  it("does not retry non-retryable errors", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            attempts++;
            throw new Error("fatal");
          },
          { baseMs: 1, maxRetries: 5 },
          (err) => !(err instanceof Error && err.message === "fatal")
        ),
      /fatal/
    );
    assert.equal(attempts, 1);
  });
});
