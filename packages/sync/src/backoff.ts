/**
 * Exponential backoff with jitter.
 *
 * Used by the sync engine to retry transient failures against the cloud API.
 * The jitter prevents thundering herd when multiple clients retry simultaneously.
 */

export interface BackoffOptions {
  baseMs: number;
  maxRetries: number;
  maxDelayMs?: number;
}

/**
 * Compute the delay in milliseconds for a given attempt number (0-indexed).
 * Uses full jitter: delay = random(0, min(maxDelay, base * 2^attempt)).
 */
export function computeBackoffDelay(attempt: number, options: BackoffOptions): number {
  const maxDelayMs = options.maxDelayMs ?? 30000;
  const exponential = options.baseMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, maxDelayMs);
  return Math.floor(Math.random() * capped);
}

/**
 * Sleep for the specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run an async operation with exponential backoff retry on failure.
 * The predicate determines whether an error is retryable.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: BackoffOptions,
  isRetryable: (err: unknown) => boolean = () => true
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt === options.maxRetries || !isRetryable(err)) {
        throw err;
      }
      const delay = computeBackoffDelay(attempt, options);
      await sleep(delay);
    }
  }
  throw lastError;
}
