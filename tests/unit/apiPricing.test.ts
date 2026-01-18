import { describe, expect, it } from "vitest";
import { calculateWhisperCostCeiling, calculateChatCostCeiling } from "@/lib/apiPricing";

describe("calculateWhisperCostCeiling", () => {
  it("returns a positive number for valid audio", () => {
    const cost = calculateWhisperCostCeiling(30_000);
    expect(cost).toBeGreaterThan(0);
  });

  it("applies minimum 10s billing floor", () => {
    // 1s recording should be billed as 10s
    const cost1s = calculateWhisperCostCeiling(1_000);
    const cost10s = calculateWhisperCostCeiling(10_000);
    expect(cost1s).toBe(cost10s);
  });

  it("longer audio costs more than minimum", () => {
    const costShort = calculateWhisperCostCeiling(10_000);
    const costLong = calculateWhisperCostCeiling(3_600_000); // 1 hour
    expect(costLong).toBeGreaterThan(costShort);
  });

  it("returns 0 for 0ms audio (billed as 10s minimum)", () => {
    const cost = calculateWhisperCostCeiling(0);
    // Should still be billed at minimum 10s
    expect(cost).toBeGreaterThan(0);
  });
});

describe("calculateChatCostCeiling", () => {
  it("returns a positive number for tokens", () => {
    const cost = calculateChatCostCeiling(1000);
    expect(cost).toBeGreaterThan(0);
  });

  it("returns 0 for 0 tokens", () => {
    const cost = calculateChatCostCeiling(0);
    expect(cost).toBe(0);
  });

  it("scales linearly with token count", () => {
    const cost100 = calculateChatCostCeiling(100);
    const cost1000 = calculateChatCostCeiling(1000);
    expect(cost1000 / cost100).toBeCloseTo(10, 5);
  });
});
