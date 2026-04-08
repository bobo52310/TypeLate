import { invoke } from "@tauri-apps/api/core";
import type { TriggerKey, PromptMode } from "@/types/settings";
import type { TranscriptionLocale } from "@/i18n/languageConfig";
import { TRANSCRIPTION_LANGUAGE_OPTIONS } from "@/i18n/languageConfig";
import { isCustomTriggerKey } from "@/types/settings";
import type { TriggerMode } from "@/types";

const TRIGGER_MODE_LABELS: Record<TriggerMode, string> = {
  hold: "按住",
  toggle: "切換",
  doubleTap: "雙擊",
};

const PRESET_KEY_NAMES: Record<string, string> = {
  fn: "Fn",
  option: "Option",
  rightOption: "Right Option",
  command: "Command",
  rightAlt: "Right Alt",
  leftAlt: "Left Alt",
  control: "Control",
  rightControl: "Right Control",
  shift: "Shift",
};

function formatHotkeyLabel(key: TriggerKey, mode: TriggerMode): string {
  const keyName = isCustomTriggerKey(key)
    ? `Key ${key.custom.keycode}`
    : PRESET_KEY_NAMES[key] ?? key;
  const modeLabel = TRIGGER_MODE_LABELS[mode] ?? mode;
  return `快捷鍵：${keyName}（${modeLabel}）`;
}

function formatLanguageLabel(locale: TranscriptionLocale): string {
  const opt = TRANSCRIPTION_LANGUAGE_OPTIONS.find((o) => o.locale === locale);
  return `轉錄語言：${opt?.displayName ?? locale}`;
}

function formatMicLabel(deviceName: string): string {
  return `麥克風：${deviceName || "系統預設"}`;
}

async function updateTrayField(field: string, value: string): Promise<void> {
  try {
    await invoke("update_tray_label", { field, value });
  } catch {
    // Non-critical — silently ignore if tray not available (e.g. HUD window)
  }
}

export async function syncTrayMic(deviceName: string): Promise<void> {
  await updateTrayField("mic", formatMicLabel(deviceName));
}

export async function syncTrayLanguage(locale: TranscriptionLocale): Promise<void> {
  await updateTrayField("language", formatLanguageLabel(locale));
}

export async function syncTrayHotkey(key: TriggerKey, mode: TriggerMode): Promise<void> {
  await updateTrayField("hotkey", formatHotkeyLabel(key, mode));
}

const PROMPT_MODE_TRAY_LABELS: Record<string, string> = {
  minimal: "潤稿",
  active: "排版",
  custom: "自訂",
};

export async function syncTrayPromptMode(mode: PromptMode): Promise<void> {
  const label = PROMPT_MODE_TRAY_LABELS[mode] ?? mode;
  await updateTrayField("prompt_mode", `AI 模式：${label}`);
}
