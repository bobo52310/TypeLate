import { describe, expect, it, vi } from "vitest";
import { retryWithBackoff } from "@/lib/retryWithBackoff";

describe("retryWithBackoff", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 rate limit errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Groq API error (429)"))
      .mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 server errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Groq API error (500)"))
      .mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 401 client errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Groq API error (401)"));

    await expect(retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 })).rejects.toThrow("401");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry on 400 client errors", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Groq API error (400)"));

    await expect(retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 })).rejects.toThrow("400");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after max retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Groq API error (500)"));

    await expect(retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 })).rejects.toThrow("500");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("retries on network errors", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, { maxRetries: 1, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on AbortError", async () => {
    const fn = vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"));

    await expect(retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 })).rejects.toThrow(
      "Aborted",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
