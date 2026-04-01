/**
 * Circuit breaker for API calls.
 *
 * After `threshold` consecutive failures within `windowMs`, the circuit
 * "opens" and all calls fail immediately without hitting the API.
 * After `cooldownMs`, the circuit "half-opens" — the next call is allowed
 * through; if it succeeds, the circuit resets to "closed".
 *
 * States: CLOSED (normal) → OPEN (blocking) → HALF_OPEN (testing) → CLOSED
 */

const DEFAULT_THRESHOLD = 3;
const DEFAULT_WINDOW_MS = 5 * 60_000; // 5 minutes
const DEFAULT_COOLDOWN_MS = 60_000; // 1 minute

type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreakerOptions {
  threshold?: number;
  windowMs?: number;
  cooldownMs?: number;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureTimestamps: number[] = [];
  private openedAt = 0;
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;

  constructor(options?: CircuitBreakerOptions) {
    this.threshold = options?.threshold ?? DEFAULT_THRESHOLD;
    this.windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
    this.cooldownMs = options?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  /** Check if the circuit allows a call through. */
  canExecute(): boolean {
    if (this.state === "closed") return true;

    if (this.state === "open") {
      // Check if cooldown has elapsed → transition to half-open
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.state = "half-open";
        return true;
      }
      return false;
    }

    // half-open: allow one test call
    return true;
  }

  /** Report a successful call. Resets the circuit to closed. */
  recordSuccess(): void {
    this.state = "closed";
    this.failureTimestamps = [];
  }

  /** Report a failed call. May open the circuit if threshold is reached. */
  recordFailure(): void {
    const now = Date.now();

    if (this.state === "half-open") {
      // Test call failed — re-open immediately
      this.state = "open";
      this.openedAt = now;
      return;
    }

    // Prune old timestamps outside the window
    this.failureTimestamps = this.failureTimestamps.filter((ts) => now - ts < this.windowMs);
    this.failureTimestamps.push(now);

    if (this.failureTimestamps.length >= this.threshold) {
      this.state = "open";
      this.openedAt = now;
    }
  }

  /** Get time remaining until the circuit resets (0 if closed). */
  getRemainingCooldownMs(): number {
    if (this.state !== "open") return 0;
    return Math.max(0, this.cooldownMs - (Date.now() - this.openedAt));
  }

  getState(): CircuitState {
    return this.state;
  }

  /** Force reset to closed state. */
  reset(): void {
    this.state = "closed";
    this.failureTimestamps = [];
    this.openedAt = 0;
  }
}

// ── Per-provider circuit breaker instances ──

const circuitBreakerMap = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(providerId: string): CircuitBreaker {
  if (!circuitBreakerMap.has(providerId)) {
    circuitBreakerMap.set(providerId, new CircuitBreaker());
  }
  return circuitBreakerMap.get(providerId)!;
}

/** Shared circuit breaker for the Groq API transcription pipeline.
 *  @deprecated Use getCircuitBreaker(providerId) instead. */
export const groqCircuitBreaker = getCircuitBreaker("groq");
