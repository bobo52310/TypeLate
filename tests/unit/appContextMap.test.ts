import { describe, expect, it } from "vitest";
import { resolveAppCategory } from "../../src/lib/appContextMap";

describe("resolveAppCategory", () => {
  it("returns 'default' for null bundleId", () => {
    expect(resolveAppCategory(null, {})).toBe("default");
  });

  it("maps known email apps", () => {
    expect(resolveAppCategory("com.apple.mail", {})).toBe("email");
    expect(resolveAppCategory("com.microsoft.Outlook", {})).toBe("email");
  });

  it("maps known chat apps", () => {
    expect(resolveAppCategory("com.tinyspeck.slackmacgap", {})).toBe("chat");
    expect(resolveAppCategory("com.hnc.Discord", {})).toBe("chat");
    expect(resolveAppCategory("ru.keepcoder.Telegram", {})).toBe("chat");
  });

  it("maps known IDE apps", () => {
    expect(resolveAppCategory("com.microsoft.VSCode", {})).toBe("ide");
    expect(resolveAppCategory("com.apple.dt.Xcode", {})).toBe("ide");
  });

  it("maps known notes apps", () => {
    expect(resolveAppCategory("com.apple.Notes", {})).toBe("notes");
    expect(resolveAppCategory("md.obsidian", {})).toBe("notes");
  });

  it("returns 'default' for unknown apps", () => {
    expect(resolveAppCategory("com.apple.finder", {})).toBe("default");
    expect(resolveAppCategory("com.unknown.app", {})).toBe("default");
  });

  it("user overrides take precedence over defaults", () => {
    const overrides = { "com.apple.mail": "chat" as const };
    expect(resolveAppCategory("com.apple.mail", overrides)).toBe("chat");
  });

  it("user overrides work for unknown apps", () => {
    const overrides = { "com.custom.app": "email" as const };
    expect(resolveAppCategory("com.custom.app", overrides)).toBe("email");
  });
});
