import { describe, expect, it } from "vitest";
import { truncateText, formatCostCeiling } from "@/lib/formatUtils";

describe("truncateText", () => {
  it("returns empty string for empty input", () => {
    expect(truncateText("")).toBe("");
  });

  it("returns text as-is when under max length", () => {
    expect(truncateText("hello", 10)).toBe("hello");
  });

  it("truncates at exactly max length with ellipsis", () => {
    expect(truncateText("hello world", 5)).toBe("hello...");
  });

  it("returns text as-is when at exactly max length", () => {
    expect(truncateText("hello", 5)).toBe("hello");
  });

  it("uses default max length of 50", () => {
    const longText = "A".repeat(60);
    const result = truncateText(longText);
    expect(result).toBe("A".repeat(50) + "...");
  });
});

describe("formatCostCeiling", () => {
  it("returns $0 for zero cost", () => {
    expect(formatCostCeiling(0)).toBe("$0");
  });

  it("formats small costs with ceiling symbol", () => {
    expect(formatCostCeiling(0.001)).toBe("≤ $0.0010");
  });

  it("formats larger costs with 4 decimal places", () => {
    expect(formatCostCeiling(1.23456)).toBe("≤ $1.2346");
  });
});
