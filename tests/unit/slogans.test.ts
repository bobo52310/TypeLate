import { describe, expect, it } from "vitest";
import { getSlogans, getRandomSlogan } from "@/lib/slogans";

describe("getSlogans", () => {
  it("returns an array", () => {
    const slogans = getSlogans();
    expect(Array.isArray(slogans)).toBe(true);
  });

  it("returns non-empty array (en locale has slogans)", () => {
    const slogans = getSlogans();
    expect(slogans.length).toBeGreaterThan(0);
  });

  it("contains only strings", () => {
    const slogans = getSlogans();
    for (const slogan of slogans) {
      expect(typeof slogan).toBe("string");
      expect(slogan.length).toBeGreaterThan(0);
    }
  });
});

describe("getRandomSlogan", () => {
  it("returns a non-empty string", () => {
    const slogan = getRandomSlogan();
    expect(typeof slogan).toBe("string");
    expect(slogan.length).toBeGreaterThan(0);
  });

  it("returns a value from the slogans array", () => {
    const allSlogans = getSlogans();
    const random = getRandomSlogan();
    expect(allSlogans).toContain(random);
  });
});
