import { describe, expect, it } from "vitest";
import {
  getPlatformKeycode,
  getKeyDisplayName,
  isDangerousKey,
  isPresetEquivalentKey,
  getDangerousKeyWarning,
} from "@/lib/keycodeMap";

describe("getPlatformKeycode", () => {
  it("returns macOS keycode for known key on Mac", () => {
    const keycode = getPlatformKeycode("KeyA", "Macintosh");
    expect(keycode).toBe(0); // macOS CGEvent keycode for 'A'
  });

  it("returns Windows VK code for known key on Windows", () => {
    const keycode = getPlatformKeycode("KeyA", "Windows NT");
    expect(keycode).toBe(0x41); // VK_A
  });

  it("returns null for unknown DOM code", () => {
    expect(getPlatformKeycode("SomeUnknownKey", "Macintosh")).toBeNull();
  });

  it("maps F5 differently per platform", () => {
    const macF5 = getPlatformKeycode("F5", "Macintosh");
    const winF5 = getPlatformKeycode("F5", "Windows NT");
    expect(macF5).not.toBeNull();
    expect(winF5).not.toBeNull();
    expect(macF5).not.toBe(winF5);
  });

  it("maps modifier keys", () => {
    expect(getPlatformKeycode("ShiftLeft", "Macintosh")).not.toBeNull();
    expect(getPlatformKeycode("AltLeft", "Windows NT")).not.toBeNull();
    expect(getPlatformKeycode("ControlLeft", "Macintosh")).not.toBeNull();
  });
});

describe("getKeyDisplayName", () => {
  it("returns human-readable name for known keys", () => {
    expect(getKeyDisplayName("Space")).toBe("Space");
    expect(getKeyDisplayName("Enter")).toBe("Enter");
  });

  it("returns DOM code as fallback for unknown keys", () => {
    expect(getKeyDisplayName("SomeUnknownKey")).toBe("SomeUnknownKey");
  });

  it("maps letter keys to uppercase", () => {
    expect(getKeyDisplayName("KeyA")).toBe("A");
    expect(getKeyDisplayName("KeyZ")).toBe("Z");
  });

  it("maps digit keys", () => {
    expect(getKeyDisplayName("Digit0")).toBe("0");
    expect(getKeyDisplayName("Digit9")).toBe("9");
  });
});

describe("isDangerousKey", () => {
  it("flags CapsLock as dangerous", () => {
    expect(isDangerousKey("CapsLock")).toBe(true);
  });

  it("flags Escape as dangerous", () => {
    expect(isDangerousKey("Escape")).toBe(true);
  });

  it("flags Space, Tab, Backspace as dangerous", () => {
    expect(isDangerousKey("Space")).toBe(true);
    expect(isDangerousKey("Tab")).toBe(true);
    expect(isDangerousKey("Backspace")).toBe(true);
  });

  it("does not flag regular keys as dangerous", () => {
    expect(isDangerousKey("KeyA")).toBe(false);
    expect(isDangerousKey("F5")).toBe(false);
    expect(isDangerousKey("Digit1")).toBe(false);
  });
});

describe("isPresetEquivalentKey", () => {
  it("identifies preset modifier keys", () => {
    // macOS preset keys like Fn, Option, Command are preset equivalent
    expect(isPresetEquivalentKey("AltLeft")).toBe(true); // Option
    expect(isPresetEquivalentKey("AltRight")).toBe(true); // Right Option
    expect(isPresetEquivalentKey("MetaLeft")).toBe(true); // Command
  });

  it("does not flag regular keys as preset", () => {
    expect(isPresetEquivalentKey("KeyA")).toBe(false);
    expect(isPresetEquivalentKey("Space")).toBe(false);
    expect(isPresetEquivalentKey("F5")).toBe(false);
  });
});

describe("getDangerousKeyWarning", () => {
  it("returns null for non-dangerous keys", () => {
    expect(getDangerousKeyWarning("KeyA")).toBeNull();
    expect(getDangerousKeyWarning("F5")).toBeNull();
  });

  it("returns null for Escape (handled separately)", () => {
    expect(getDangerousKeyWarning("Escape")).toBeNull();
  });

  it("returns a warning string for CapsLock", () => {
    const warning = getDangerousKeyWarning("CapsLock");
    expect(warning).toBeTruthy();
    expect(typeof warning).toBe("string");
  });

  it("returns a warning string for Space", () => {
    const warning = getDangerousKeyWarning("Space");
    expect(warning).toBeTruthy();
    expect(typeof warning).toBe("string");
  });

  it("returns a warning string for Tab", () => {
    const warning = getDangerousKeyWarning("Tab");
    expect(warning).toBeTruthy();
    expect(typeof warning).toBe("string");
  });
});
