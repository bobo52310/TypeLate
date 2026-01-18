/**
 * Retry a function with exponential backoff and jitter.
 *
 * Retries on:
 * - Network errors (TypeError: Failed to fetch)
 * - Rate limiting (429)
 * - Server errors (5xx)
 *
 * Does NOT retry on:
 * - Client errors (400, 401, 403, 404)
 * - Abort signals
 */

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 500;

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false;

  const message = error instanceof Error ? error.message : String(error);

  // Rate limited
  if (message.includes("429") || message.includes("rate")) return true;

  // Server errors
  if (/\b5\d{2}\b/.test(message)) return true;

  // Network errors
  if (
    message.includes("Failed to fetch") ||
    message.includes("NetworkError") ||
    message.includes("network")
  ) {
    return true;
  }

  return false;
}

function delayWithJitter(baseMs: number, attempt: number): number {
  const exponentialDelay = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseMs;
  return exponentialDelay + jitter;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if aborted
      if (options?.signal?.aborted) throw error;

      // Don't retry non-retryable errors or if we've exhausted attempts
      if (attempt >= maxRetries || !isRetryableError(error)) {
        throw error;
      }

      // Wait with exponential backoff + jitter
      const delay = delayWithJitter(baseDelayMs, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Check abort again after delay
      if (options?.signal?.aborted) throw error;
    }
  }

  throw lastError;
}
