import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PRESETS,
  CUSTOM_PRESET_ID,
  findPresetById,
  type SoundSlot,
} from "@/lib/soundPresets";

const REQUIRED_SLOTS: SoundSlot[] = ["start", "stop", "error", "learned"];

describe("BUILT_IN_PRESETS", () => {
  it("has at least 2 presets", () => {
    expect(BUILT_IN_PRESETS.length).toBeGreaterThanOrEqual(2);
  });

  it("each preset has a unique id", () => {
    const ids = BUILT_IN_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each preset has all 4 required sound slots", () => {
    for (const preset of BUILT_IN_PRESETS) {
      for (const slot of REQUIRED_SLOTS) {
        expect(preset.sounds[slot]).toBeTruthy();
      }
    }
  });

  it("no preset uses CUSTOM_PRESET_ID", () => {
    for (const preset of BUILT_IN_PRESETS) {
      expect(preset.id).not.toBe(CUSTOM_PRESET_ID);
    }
  });

  it("each preset has a labelKey", () => {
    for (const preset of BUILT_IN_PRESETS) {
      expect(preset.labelKey).toBeTruthy();
    }
  });
});

describe("findPresetById", () => {
  it("finds existing preset", () => {
    const preset = findPresetById("default");
    expect(preset).toBeDefined();
    expect(preset?.id).toBe("default");
  });

  it("returns undefined for unknown preset", () => {
    expect(findPresetById("nonexistent")).toBeUndefined();
  });

  it("returns undefined for custom preset id", () => {
    expect(findPresetById(CUSTOM_PRESET_ID)).toBeUndefined();
  });
});

describe("CUSTOM_PRESET_ID", () => {
  it("is a string", () => {
    expect(typeof CUSTOM_PRESET_ID).toBe("string");
  });

  it("is not empty", () => {
    expect(CUSTOM_PRESET_ID.length).toBeGreaterThan(0);
  });
});
