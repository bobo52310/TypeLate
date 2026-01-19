export type SoundSlot = "start" | "stop" | "error" | "learned";

export interface SoundPreset {
  id: string;
  labelKey: string;
  sounds: Record<SoundSlot, string>;
}

export const BUILT_IN_PRESETS: SoundPreset[] = [
  {
    id: "default",
    labelKey: "settings.sound.presets.default",
    sounds: { start: "Funk", stop: "Bottle", error: "Ping", learned: "Glass" },
  },
  {
    id: "gentle",
    labelKey: "settings.sound.presets.gentle",
    sounds: { start: "Tink", stop: "Pop", error: "Basso", learned: "Purr" },
  },
  {
    id: "minimal",
    labelKey: "settings.sound.presets.minimal",
    sounds: { start: "Pop", stop: "Pop", error: "Basso", learned: "Pop" },
  },
  {
    id: "retro",
    labelKey: "settings.sound.presets.retro",
    sounds: { start: "Morse", stop: "Submarine", error: "Sosumi", learned: "Hero" },
  },
];

export const CUSTOM_PRESET_ID = "custom";

export function findPresetById(id: string): SoundPreset | undefined {
  return BUILT_IN_PRESETS.find((p) => p.id === id);
}
