import { describe, expect, it } from "vitest";
import { IS_MAC } from "@/lib/platform";

describe("IS_MAC", () => {
  it("is a boolean", () => {
    expect(typeof IS_MAC).toBe("boolean");
  });

  it("detects based on navigator.userAgent", () => {
    // In jsdom, userAgent does not contain "Mac"
    // This test verifies the constant is derived from userAgent
    const expected = navigator.userAgent.includes("Mac");
    expect(IS_MAC).toBe(expected);
  });
});
