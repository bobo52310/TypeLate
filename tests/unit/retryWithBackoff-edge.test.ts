import { describe, expect, it, vi } from "vitest";
import { retryWithBackoff } from "@/lib/retryWithBackoff";

describe("retryWithBackoff edge cases", () => {
  it("respects abort signal during retry delay", async () => {
    const controller = new AbortController();
    let callCount = 0;
    const fn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Abort during the delay between retries
        setTimeout(() => controller.abort(), 5);
        return Promise.reject(new Error("Groq API error (500)"));
      }
      return Promise.resolve("ok");
    });

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 2,
        baseDelayMs: 50,
        signal: controller.signal,
      }),
    ).rejects.toThrow("500");
  });

  it("handles zero maxRetries (no retry)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Groq API error (500)"));
    await expect(
      retryWithBackoff(fn, { maxRetries: 0, baseDelayMs: 10 }),
    ).rejects.toThrow("500");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 'rate' keyword in error message", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limit exceeded"))
      .mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, { maxRetries: 1, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 403 forbidden", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Groq API error (403)"));
    await expect(
      retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 }),
    ).rejects.toThrow("403");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 502 bad gateway", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("502 Bad Gateway"))
      .mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, { maxRetries: 1, baseDelayMs: 10 });
    expect(result).toBe("ok");
  });

  it("retries on 503 service unavailable", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Groq API error (503)"))
      .mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, { maxRetries: 1, baseDelayMs: 10 });
    expect(result).toBe("ok");
  });
});
