import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CircuitBreaker } from "@/lib/circuitBreaker";

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in closed state", () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe("closed");
    expect(cb.canExecute()).toBe(true);
  });

  it("stays closed after fewer failures than threshold", () => {
    const cb = new CircuitBreaker({ threshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    expect(cb.canExecute()).toBe(true);
  });

  it("opens after reaching failure threshold", () => {
    const cb = new CircuitBreaker({ threshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.canExecute()).toBe(false);
  });

  it("transitions to half-open after cooldown", () => {
    const cb = new CircuitBreaker({ threshold: 2, cooldownMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.canExecute()).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(cb.canExecute()).toBe(true);
    expect(cb.getState()).toBe("half-open");
  });

  it("closes on success in half-open state", () => {
    const cb = new CircuitBreaker({ threshold: 2, cooldownMs: 500 });
    cb.recordFailure();
    cb.recordFailure();

    vi.advanceTimersByTime(500);
    cb.canExecute(); // triggers half-open
    cb.recordSuccess();

    expect(cb.getState()).toBe("closed");
    expect(cb.canExecute()).toBe(true);
  });

  it("re-opens on failure in half-open state", () => {
    const cb = new CircuitBreaker({ threshold: 2, cooldownMs: 500 });
    cb.recordFailure();
    cb.recordFailure();

    vi.advanceTimersByTime(500);
    cb.canExecute(); // triggers half-open
    cb.recordFailure();

    expect(cb.getState()).toBe("open");
    expect(cb.canExecute()).toBe(false);
  });

  it("prunes old failures outside the time window", () => {
    const cb = new CircuitBreaker({
      threshold: 3,
      windowMs: 2000,
    });

    cb.recordFailure();
    vi.advanceTimersByTime(1500);
    cb.recordFailure();
    vi.advanceTimersByTime(1500); // first failure is now 3000ms old
    cb.recordFailure();

    // Only 2 failures within the 2000ms window
    expect(cb.getState()).toBe("closed");
  });

  it("reports remaining cooldown time", () => {
    const cb = new CircuitBreaker({ threshold: 1, cooldownMs: 5000 });
    cb.recordFailure();

    expect(cb.getRemainingCooldownMs()).toBe(5000);
    vi.advanceTimersByTime(2000);
    expect(cb.getRemainingCooldownMs()).toBe(3000);
    vi.advanceTimersByTime(3000);
    expect(cb.getRemainingCooldownMs()).toBe(0);
  });

  it("returns 0 cooldown when closed", () => {
    const cb = new CircuitBreaker();
    expect(cb.getRemainingCooldownMs()).toBe(0);
  });

  it("can be force-reset", () => {
    const cb = new CircuitBreaker({ threshold: 1 });
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    cb.reset();
    expect(cb.getState()).toBe("closed");
    expect(cb.canExecute()).toBe(true);
  });

  it("resets failure history on success", () => {
    const cb = new CircuitBreaker({ threshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure(); // only 1 failure after reset
    expect(cb.getState()).toBe("closed");
  });
});
