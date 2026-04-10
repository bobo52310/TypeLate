import type { TriggerMode } from "./index";

export type PresetTriggerKey =
  | "fn"
  | "option"
  | "rightOption"
  | "command"
  | "rightAlt"
  | "leftAlt"
  | "control"
  | "rightControl"
  | "shift";

export interface CustomTriggerKey {
  custom: { keycode: number };
}

export type TriggerKey = PresetTriggerKey | CustomTriggerKey;

export function isPresetTriggerKey(key: TriggerKey): key is PresetTriggerKey {
  return typeof key === "string";
}

export function isCustomTriggerKey(key: TriggerKey): key is CustomTriggerKey {
  return typeof key === "object" && key !== null && "custom" in key;
}

export interface HotkeyConfig {
  triggerKey: TriggerKey;
  triggerMode: TriggerMode;
}

export const PROMPT_MODE_VALUES = ["none", "minimal", "active", "custom"] as const;
export type PromptMode = (typeof PROMPT_MODE_VALUES)[number];
export type PresetPromptMode = Exclude<PromptMode, "custom" | "none">;
