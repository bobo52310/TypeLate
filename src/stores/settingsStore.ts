import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import type { TriggerMode } from "@/types";
import {
  type HotkeyConfig,
  type TriggerKey,
  type CustomTriggerKey,
  type PromptMode,
  PROMPT_MODE_VALUES,
  isCustomTriggerKey,
  isPresetTriggerKey,
} from "@/types/settings";
import {
  getKeyDisplayName,
  getPlatformKeycode,
  isPresetEquivalentKey,
  getDangerousKeyWarning,
  getEscapeReservedMessage,
} from "@/lib/keycodeMap";
import {
  extractErrorMessage,
  getHotkeyRecordingTimeoutMessage,
  getHotkeyUnsupportedKeyMessage,
  getHotkeyPresetHint,
} from "@/lib/errorUtils";
import { captureError } from "@/lib/sentry";
import {
  getMinimalPromptForLocale,
  getPromptForModeAndLocale,
  isKnownDefaultPrompt,
} from "@/i18n/prompts";
import i18n from "@/i18n";
import {
  type SupportedLocale,
  type TranscriptionLocale,
  FALLBACK_LOCALE,
  detectSystemLocale,
  getHtmlLangForLocale,
  getWhisperCodeForTranscriptionLocale,
} from "@/i18n/languageConfig";
import { emitEvent, SETTINGS_UPDATED } from "@/hooks/useTauriEvent";
import type { SettingsUpdatedPayload } from "@/types/events";
import {
  DEFAULT_LLM_MODEL_ID,
  DEFAULT_VOCABULARY_ANALYSIS_MODEL_ID,
  DEFAULT_WHISPER_MODEL_ID,
  getEffectiveLlmModelId,
  getEffectiveVocabularyAnalysisModelId,
  getEffectiveWhisperModelId,
  type LlmModelId,
  type VocabularyAnalysisModelId,
  type WhisperModelId,
} from "@/lib/modelRegistry";

import { APP_VERSION } from "@/lib/version";
import { IS_MAC } from "@/lib/platform";

const STORE_NAME = "settings.json";

export const DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED = false;
export const DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT = 10;
export const DEFAULT_MUTE_ON_RECORDING = true;
const DEFAULT_SMART_DICTIONARY_ENABLED = IS_MAC;
const DEFAULT_SOUND_EFFECTS_ENABLED = true;
const DEFAULT_PROMPT_MODE: PromptMode = "minimal";
const DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED = false;
const DEFAULT_RECORDING_AUTO_CLEANUP_DAYS = 7;

function getDefaultTriggerKey(): TriggerKey {
  return IS_MAC ? "fn" : "rightAlt";
}

const PRESET_KEY_DISPLAY_NAMES: Record<string, string> = {
  fn: "Fn",
  option: "Option (\u2325)",
  rightOption: "Right Option (\u2325)",
  command: "Command (\u2318)",
  rightAlt: "Right Alt",
  leftAlt: "Left Alt",
  control: "Control (\u2303)",
  rightControl: "Right Control",
  shift: "Shift (\u21E7)",
};

interface SettingsState {
  // -- State --
  hotkeyConfig: HotkeyConfig | null;
  apiKey: string;
  aiPrompt: string;
  promptMode: PromptMode;
  showPromptUpgradeNotice: boolean;
  isAutoStartEnabled: boolean;
  isEnhancementThresholdEnabled: boolean;
  enhancementThresholdCharCount: number;
  selectedLlmModelId: LlmModelId;
  selectedVocabularyAnalysisModelId: VocabularyAnalysisModelId;
  selectedWhisperModelId: WhisperModelId;
  customTriggerKey: CustomTriggerKey | null;
  isMuteOnRecordingEnabled: boolean;
  isSmartDictionaryEnabled: boolean;
  customTriggerKeyDomCode: string;
  selectedLocale: SupportedLocale;
  selectedTranscriptionLocale: TranscriptionLocale;
  isSoundEffectsEnabled: boolean;
  isRecordingAutoCleanupEnabled: boolean;
  recordingAutoCleanupDays: number;
  selectedAudioInputDeviceName: string;

  // -- Derived getters --
  triggerMode: () => TriggerMode;
  hasApiKey: () => boolean;

  // -- Helper getters (proxied from lib/) --
  getPlatformKeycode: typeof getPlatformKeycode;
  getKeyDisplayName: typeof getKeyDisplayName;
  isPresetEquivalentKey: typeof isPresetEquivalentKey;
  getDangerousKeyWarning: typeof getDangerousKeyWarning;
  getEscapeReservedMessage: typeof getEscapeReservedMessage;
  getHotkeyRecordingTimeoutMessage: typeof getHotkeyRecordingTimeoutMessage;
  getHotkeyUnsupportedKeyMessage: typeof getHotkeyUnsupportedKeyMessage;
  getHotkeyPresetHint: typeof getHotkeyPresetHint;

  // -- Actions --
  getApiKey: () => string;
  getAiPrompt: () => string;
  getEffectivePromptLocale: () => SupportedLocale;
  getTriggerKeyDisplayName: (key: TriggerKey) => string;
  getWhisperLanguageCode: () => string | null;

  loadSettings: () => Promise<void>;
  saveHotkeyConfig: (key: TriggerKey, mode: TriggerMode) => Promise<void>;
  saveCustomTriggerKey: (keycode: number, domCode: string, mode: TriggerMode) => Promise<void>;
  switchToPresetMode: (presetKey: TriggerKey, mode: TriggerMode) => Promise<void>;
  switchToCustomMode: (mode: TriggerMode) => Promise<void>;
  saveApiKey: (key: string) => Promise<void>;
  refreshApiKey: () => Promise<void>;
  deleteApiKey: () => Promise<void>;
  savePromptMode: (mode: PromptMode) => Promise<void>;
  consumeUpgradeNotice: () => Promise<void>;
  saveAiPrompt: (prompt: string) => Promise<void>;
  resetAiPrompt: () => Promise<void>;
  saveEnhancementThreshold: (enabled: boolean, charCount: number) => Promise<void>;
  saveLlmModel: (id: LlmModelId) => Promise<void>;
  saveVocabularyAnalysisModel: (id: VocabularyAnalysisModelId) => Promise<void>;
  saveWhisperModel: (id: WhisperModelId) => Promise<void>;
  saveMuteOnRecording: (enabled: boolean) => Promise<void>;
  saveSoundEffectsEnabled: (enabled: boolean) => Promise<void>;
  saveSmartDictionaryEnabled: (enabled: boolean) => Promise<void>;
  saveRecordingAutoCleanup: (enabled: boolean, days: number) => Promise<void>;
  saveAudioInputDevice: (deviceName: string) => Promise<void>;
  saveLocale: (locale: SupportedLocale) => Promise<void>;
  saveTranscriptionLocale: (locale: TranscriptionLocale) => Promise<void>;
  refreshCrossWindowSettings: () => Promise<void>;
  loadAutoStartStatus: () => Promise<void>;
  toggleAutoStart: () => Promise<void>;
  initializeAutoStart: () => Promise<void>;
}

// Guard flag lives outside the store to prevent re-initialization
let isLoaded = false;

async function syncHotkeyConfigToRust(key: TriggerKey, mode: TriggerMode) {
  try {
    await invoke("update_hotkey_config", {
      triggerKey: key,
      triggerMode: mode,
    });
  } catch (err) {
    console.error(
      "[settingsStore] Failed to sync hotkey config:",
      extractErrorMessage(err),
    );
    captureError(err, { source: "settings", step: "sync-hotkey" });
  }
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  // -- State --
  hotkeyConfig: null,
  apiKey: "",
  aiPrompt: getMinimalPromptForLocale(FALLBACK_LOCALE),
  promptMode: DEFAULT_PROMPT_MODE,
  showPromptUpgradeNotice: false,
  isAutoStartEnabled: false,
  isEnhancementThresholdEnabled: DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED,
  enhancementThresholdCharCount: DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
  selectedLlmModelId: DEFAULT_LLM_MODEL_ID,
  selectedVocabularyAnalysisModelId: DEFAULT_VOCABULARY_ANALYSIS_MODEL_ID,
  selectedWhisperModelId: DEFAULT_WHISPER_MODEL_ID,
  customTriggerKey: null,
  isMuteOnRecordingEnabled: DEFAULT_MUTE_ON_RECORDING,
  isSmartDictionaryEnabled: DEFAULT_SMART_DICTIONARY_ENABLED,
  customTriggerKeyDomCode: "",
  selectedLocale: FALLBACK_LOCALE,
  selectedTranscriptionLocale: FALLBACK_LOCALE,
  isSoundEffectsEnabled: DEFAULT_SOUND_EFFECTS_ENABLED,
  isRecordingAutoCleanupEnabled: DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED,
  recordingAutoCleanupDays: DEFAULT_RECORDING_AUTO_CLEANUP_DAYS,
  selectedAudioInputDeviceName: "",

  // -- Derived getters --
  triggerMode: () => get().hotkeyConfig?.triggerMode ?? "hold",
  hasApiKey: () => get().apiKey !== "",

  // -- Proxied lib helpers --
  getPlatformKeycode,
  getKeyDisplayName,
  isPresetEquivalentKey,
  getDangerousKeyWarning,
  getEscapeReservedMessage,
  getHotkeyRecordingTimeoutMessage,
  getHotkeyUnsupportedKeyMessage,
  getHotkeyPresetHint,

  // -- Helper getters --
  getEffectivePromptLocale: () => {
    const { selectedTranscriptionLocale, selectedLocale } = get();
    return selectedTranscriptionLocale === "auto"
      ? selectedLocale
      : selectedTranscriptionLocale;
  },

  getApiKey: () => get().apiKey,

  getAiPrompt: () => {
    const { promptMode, aiPrompt, getEffectivePromptLocale: getLocale } = get();
    if (promptMode === "custom") return aiPrompt;
    return getPromptForModeAndLocale(promptMode, getLocale());
  },

  getTriggerKeyDisplayName: (key: TriggerKey) => {
    if (isPresetTriggerKey(key)) {
      return PRESET_KEY_DISPLAY_NAMES[key] ?? key;
    }
    const { customTriggerKeyDomCode } = get();
    if (customTriggerKeyDomCode) {
      return getKeyDisplayName(customTriggerKeyDomCode);
    }
    return i18n.t("settings.hotkey.customKeyDisplay", {
      keycode: key.custom.keycode,
    });
  },

  getWhisperLanguageCode: () => {
    return getWhisperCodeForTranscriptionLocale(get().selectedTranscriptionLocale);
  },

  // -- Actions --

  loadSettings: async () => {
    if (isLoaded) return;

    try {
      const store = await load(STORE_NAME);
      const savedKey = await store.get<TriggerKey>("hotkeyTriggerKey");
      const savedMode = await store.get<TriggerMode>("hotkeyTriggerMode");
      const savedApiKey = await store.get<string>("groqApiKey");

      const key = savedKey ?? getDefaultTriggerKey();
      const mode = savedMode ?? "hold";

      // Load custom key independently
      const savedCustomKey =
        await store.get<CustomTriggerKey>("customTriggerKey");
      const savedCustomDomCode = await store.get<string>(
        "customTriggerKeyDomCode",
      );
      let resolvedCustomKey: CustomTriggerKey | null = null;
      let resolvedCustomDomCode = "";
      if (savedCustomKey && isCustomTriggerKey(savedCustomKey)) {
        resolvedCustomKey = savedCustomKey;
        resolvedCustomDomCode = savedCustomDomCode ?? "";
      }

      // Load locale
      let resolvedLocale: SupportedLocale;
      const savedLocale = await store.get<SupportedLocale>("selectedLocale");
      if (savedLocale) {
        resolvedLocale = savedLocale;
      } else {
        const detected = detectSystemLocale();
        resolvedLocale = detected;
        await store.set("selectedLocale", detected);
        await store.save();
      }
      await i18n.changeLanguage(resolvedLocale);
      document.documentElement.lang = getHtmlLangForLocale(resolvedLocale);

      // Load transcription locale
      const savedTranscriptionLocale = await store.get<TranscriptionLocale>(
        "selectedTranscriptionLocale",
      );
      const resolvedTranscriptionLocale: TranscriptionLocale =
        savedTranscriptionLocale ?? resolvedLocale;
      if (!savedTranscriptionLocale) {
        await store.set("selectedTranscriptionLocale", resolvedLocale);
        await store.save();
      }

      // Load aiPrompt
      const savedPrompt = await store.get<string>("aiPrompt");
      const trimmedSavedPrompt = savedPrompt?.trim() ?? "";

      // Prompt mode migration
      const savedPromptMode = await store.get<string>("promptMode");
      let resolvedPromptMode: PromptMode;
      if (
        savedPromptMode &&
        (PROMPT_MODE_VALUES as readonly string[]).includes(savedPromptMode)
      ) {
        resolvedPromptMode = savedPromptMode as PromptMode;
      } else if (!savedPromptMode) {
        if (!trimmedSavedPrompt || isKnownDefaultPrompt(trimmedSavedPrompt)) {
          resolvedPromptMode = "minimal";
        } else {
          resolvedPromptMode = "custom";
        }
        await store.set("promptMode", resolvedPromptMode);
        await store.save();
      } else {
        resolvedPromptMode = DEFAULT_PROMPT_MODE;
      }

      // Effective prompt locale for fallback
      const effectivePromptLocale =
        resolvedTranscriptionLocale === "auto"
          ? resolvedLocale
          : resolvedTranscriptionLocale;

      const resolvedAiPrompt =
        trimmedSavedPrompt ||
        getMinimalPromptForLocale(effectivePromptLocale);

      // Enhancement threshold
      const savedThresholdEnabled = await store.get<boolean>(
        "enhancementThresholdEnabled",
      );
      const savedThresholdCharCount = await store.get<number>(
        "enhancementThresholdCharCount",
      );

      // LLM model with Kimi K2 migration
      const savedLlmModelId = await store.get<string>("llmModelId");
      const effectiveLlmModelId = getEffectiveLlmModelId(
        savedLlmModelId ?? null,
      );
      const llmMigratedToKimiK2 = await store.get<boolean>(
        "llmMigratedToKimiK2",
      );
      let resolvedLlmModelId: LlmModelId;
      if (!llmMigratedToKimiK2) {
        resolvedLlmModelId = DEFAULT_LLM_MODEL_ID;
        await store.set("llmModelId", DEFAULT_LLM_MODEL_ID);
        await store.set("llmMigratedToKimiK2", true);
        await store.save();
      } else {
        resolvedLlmModelId = effectiveLlmModelId;
      }

      // Vocabulary analysis model
      const savedVocabularyAnalysisModelId = await store.get<string>(
        "vocabularyAnalysisModelId",
      );
      const resolvedVocabModelId = getEffectiveVocabularyAnalysisModelId(
        savedVocabularyAnalysisModelId ?? null,
      );

      // Whisper model
      const savedWhisperModelId = await store.get<string>("whisperModelId");
      const resolvedWhisperModelId = getEffectiveWhisperModelId(
        savedWhisperModelId ?? null,
      );

      // Boolean settings
      const savedMuteOnRecording = await store.get<boolean>("muteOnRecording");
      const savedSoundEffects = await store.get<boolean>("soundEffectsEnabled");
      const savedSmartDictionary = await store.get<boolean>(
        "smartDictionaryEnabled",
      );
      const savedRecordingAutoCleanup = await store.get<boolean>(
        "recordingAutoCleanupEnabled",
      );
      const savedRecordingAutoCleanupDays = await store.get<number>(
        "recordingAutoCleanupDays",
      );
      const savedAudioInputDeviceName = await store.get<string>(
        "audioInputDeviceName",
      );

      set({
        hotkeyConfig: { triggerKey: key, triggerMode: mode },
        apiKey: savedApiKey?.trim() ?? "",
        customTriggerKey: resolvedCustomKey,
        customTriggerKeyDomCode: resolvedCustomDomCode,
        selectedLocale: resolvedLocale,
        selectedTranscriptionLocale: resolvedTranscriptionLocale,
        promptMode: resolvedPromptMode,
        aiPrompt: resolvedAiPrompt,
        isEnhancementThresholdEnabled:
          savedThresholdEnabled ?? DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED,
        enhancementThresholdCharCount:
          savedThresholdCharCount ?? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
        selectedLlmModelId: resolvedLlmModelId,
        selectedVocabularyAnalysisModelId: resolvedVocabModelId,
        selectedWhisperModelId: resolvedWhisperModelId,
        isMuteOnRecordingEnabled:
          savedMuteOnRecording ?? DEFAULT_MUTE_ON_RECORDING,
        isSoundEffectsEnabled:
          savedSoundEffects ?? DEFAULT_SOUND_EFFECTS_ENABLED,
        isSmartDictionaryEnabled:
          savedSmartDictionary ?? DEFAULT_SMART_DICTIONARY_ENABLED,
        isRecordingAutoCleanupEnabled:
          savedRecordingAutoCleanup ?? DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED,
        recordingAutoCleanupDays:
          savedRecordingAutoCleanupDays ?? DEFAULT_RECORDING_AUTO_CLEANUP_DAYS,
        selectedAudioInputDeviceName: savedAudioInputDeviceName ?? "",
      });

      // Sync saved config to Rust on startup
      await syncHotkeyConfigToRust(key, mode);
      isLoaded = true;
      console.log(
        `[settingsStore] Settings loaded: key=${JSON.stringify(key)}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[settingsStore] loadSettings failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "load" });

      // Fallback to platform defaults
      const key = getDefaultTriggerKey();
      set({
        hotkeyConfig: { triggerKey: key, triggerMode: "hold" },
        isEnhancementThresholdEnabled: DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED,
        enhancementThresholdCharCount: DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
        isMuteOnRecordingEnabled: DEFAULT_MUTE_ON_RECORDING,
        isSoundEffectsEnabled: DEFAULT_SOUND_EFFECTS_ENABLED,
      });
    }
  },

  saveHotkeyConfig: async (key: TriggerKey, mode: TriggerMode) => {
    try {
      const store = await load(STORE_NAME);
      await store.set("hotkeyTriggerKey", key);
      await store.set("hotkeyTriggerMode", mode);
      await store.save();

      set({ hotkeyConfig: { triggerKey: key, triggerMode: mode } });

      await syncHotkeyConfigToRust(key, mode);

      const payload: SettingsUpdatedPayload = {
        key: "hotkey",
        value: { triggerKey: key, triggerMode: mode },
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[settingsStore] Hotkey config saved: key=${JSON.stringify(key)}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[settingsStore] saveHotkeyConfig failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-hotkey" });
      throw err;
    }
  },

  saveCustomTriggerKey: async (
    keycode: number,
    domCode: string,
    mode: TriggerMode,
  ) => {
    const customKey: CustomTriggerKey = { custom: { keycode } };
    try {
      const store = await load(STORE_NAME);
      await store.set("customTriggerKey", customKey);
      await store.set("customTriggerKeyDomCode", domCode);
      await store.save();

      set({
        customTriggerKey: customKey,
        customTriggerKeyDomCode: domCode,
      });

      // Reuse shared logic for active key + Rust sync + event broadcast
      await get().saveHotkeyConfig(customKey, mode);

      console.log(
        `[settingsStore] Custom trigger key saved: keycode=${keycode}, domCode=${domCode}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[settingsStore] saveCustomTriggerKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  },

  switchToPresetMode: async (presetKey: TriggerKey, mode: TriggerMode) => {
    await get().saveHotkeyConfig(presetKey, mode);
  },

  switchToCustomMode: async (mode: TriggerMode) => {
    const { customTriggerKey } = get();
    if (!customTriggerKey) return;
    await get().saveHotkeyConfig(customTriggerKey, mode);
  },

  saveApiKey: async (key: string) => {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error(i18n.t("errors.apiKeyEmpty"));
    }
    if (!trimmedKey.startsWith("gsk_")) {
      throw new Error(i18n.t("errors.apiKeyInvalidFormat", { defaultValue: "API Key should start with gsk_" }));
    }

    try {
      const store = await load(STORE_NAME);
      await store.set("groqApiKey", trimmedKey);
      await store.save();
      set({ apiKey: trimmedKey });

      const payload: SettingsUpdatedPayload = {
        key: "apiKey",
        value: trimmedKey,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[settingsStore] API Key saved");
    } catch (err) {
      console.error(
        "[settingsStore] saveApiKey failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-api-key" });
      throw err;
    }
  },

  refreshApiKey: async () => {
    try {
      const store = await load(STORE_NAME);
      const savedApiKey = await store.get<string>("groqApiKey");
      set({ apiKey: savedApiKey?.trim() ?? "" });
    } catch (err) {
      console.error(
        "[settingsStore] refreshApiKey failed:",
        extractErrorMessage(err),
      );
    }
  },

  deleteApiKey: async () => {
    try {
      const store = await load(STORE_NAME);
      await store.delete("groqApiKey");
      await store.save();
      set({ apiKey: "" });

      const payload: SettingsUpdatedPayload = { key: "apiKey", value: "" };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[settingsStore] API Key deleted");
    } catch (err) {
      console.error(
        "[settingsStore] deleteApiKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  },

  savePromptMode: async (mode: PromptMode) => {
    const previousMode = get().promptMode;
    set({ promptMode: mode });
    try {
      const store = await load(STORE_NAME);
      await store.set("promptMode", mode);
      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "promptMode",
        value: mode,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[settingsStore] Prompt mode saved: ${mode}`);
    } catch (err) {
      set({ promptMode: previousMode });
      console.error(
        "[settingsStore] savePromptMode failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-prompt-mode" });
      throw err;
    }
  },

  consumeUpgradeNotice: async () => {
    try {
      const store = await load(STORE_NAME);
      const lastSeenVersion = await store.get<string>("lastSeenVersion");

      if (lastSeenVersion === null || lastSeenVersion === undefined) {
        const existingApiKey = await store.get<string>("groqApiKey");
        if (existingApiKey) {
          set({ showPromptUpgradeNotice: true });
        }
        await store.set("lastSeenVersion", APP_VERSION);
        await store.save();
        return;
      }

      if (lastSeenVersion !== APP_VERSION) {
        set({ showPromptUpgradeNotice: true });
        await store.set("lastSeenVersion", APP_VERSION);
        await store.save();
      }
    } catch (err) {
      console.error(
        "[settingsStore] consumeUpgradeNotice failed:",
        extractErrorMessage(err),
      );
    }
  },

  saveAiPrompt: async (prompt: string) => {
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt === "") {
      throw new Error(i18n.t("errors.promptEmpty"));
    }

    try {
      const store = await load(STORE_NAME);
      await store.set("aiPrompt", trimmedPrompt);
      await store.save();
      set({ aiPrompt: trimmedPrompt });

      const payload: SettingsUpdatedPayload = {
        key: "aiPrompt",
        value: trimmedPrompt,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[settingsStore] AI Prompt saved");
    } catch (err) {
      console.error(
        "[settingsStore] saveAiPrompt failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  },

  resetAiPrompt: async () => {
    try {
      const store = await load(STORE_NAME);
      const defaultPrompt = getMinimalPromptForLocale(
        get().getEffectivePromptLocale(),
      );
      set({ promptMode: "minimal", aiPrompt: defaultPrompt });
      await store.set("promptMode", "minimal");
      await store.set("aiPrompt", defaultPrompt);
      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "promptMode",
        value: "minimal",
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[settingsStore] AI Prompt reset to minimal");
    } catch (err) {
      console.error(
        "[settingsStore] resetAiPrompt failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  },

  saveEnhancementThreshold: async (enabled: boolean, charCount: number) => {
    const validatedCharCount =
      !Number.isInteger(charCount) || charCount < 1
        ? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT
        : charCount;

    try {
      const store = await load(STORE_NAME);
      await store.set("enhancementThresholdEnabled", enabled);
      await store.set("enhancementThresholdCharCount", validatedCharCount);
      await store.save();

      set({
        isEnhancementThresholdEnabled: enabled,
        enhancementThresholdCharCount: validatedCharCount,
      });

      const payload: SettingsUpdatedPayload = {
        key: "enhancementThreshold",
        value: { enabled, charCount: validatedCharCount },
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[settingsStore] Enhancement threshold saved: enabled=${enabled}, charCount=${validatedCharCount}`,
      );
    } catch (err) {
      console.error(
        "[settingsStore] saveEnhancementThreshold failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  },

  saveLlmModel: async (id: LlmModelId) => {
    try {
      const store = await load(STORE_NAME);
      await store.set("llmModelId", id);
      await store.save();
      set({ selectedLlmModelId: id });

      const payload: SettingsUpdatedPayload = {
        key: "llmModel",
        value: id,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[settingsStore] LLM model saved: ${id}`);
    } catch (err) {
      console.error(
        "[settingsStore] saveLlmModel failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  },

  saveVocabularyAnalysisModel: async (id: VocabularyAnalysisModelId) => {
    try {
      const store = await load(STORE_NAME);
      await store.set("vocabularyAnalysisModelId", id);
      await store.save();
      set({ selectedVocabularyAnalysisModelId: id });

      const payload: SettingsUpdatedPayload = {
        key: "vocabularyAnalysisModel",
        value: id,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[settingsStore] Vocabulary analysis model saved: ${id}`);
    } catch (err) {
      console.error(
        "[settingsStore] saveVocabularyAnalysisModel failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  },

  saveWhisperModel: async (id: WhisperModelId) => {
    try {
      const store = await load(STORE_NAME);
      await store.set("whisperModelId", id);
      await store.save();
      set({ selectedWhisperModelId: id });

      const payload: SettingsUpdatedPayload = {
        key: "whisperModel",
        value: id,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[settingsStore] Whisper model saved: ${id}`);
    } catch (err) {
      console.error(
        "[settingsStore] saveWhisperModel failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  },

  loadAutoStartStatus: async () => {
    try {
      const { isEnabled } = await import("@tauri-apps/plugin-autostart");
      set({ isAutoStartEnabled: await isEnabled() });
    } catch (err) {
      console.error(
        "[settingsStore] loadAutoStartStatus failed:",
        extractErrorMessage(err),
      );
    }
  },

  toggleAutoStart: async () => {
    try {
      if (get().isAutoStartEnabled) {
        const { disable } = await import("@tauri-apps/plugin-autostart");
        await disable();
        set({ isAutoStartEnabled: false });
      } else {
        const { enable } = await import("@tauri-apps/plugin-autostart");
        await enable();
        set({ isAutoStartEnabled: true });
      }
    } catch (err) {
      console.error(
        "[settingsStore] toggleAutoStart failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  },

  saveLocale: async (locale: SupportedLocale) => {
    try {
      const store = await load(STORE_NAME);

      await store.set("selectedLocale", locale);
      set({ selectedLocale: locale });
      await i18n.changeLanguage(locale);
      document.documentElement.lang = getHtmlLangForLocale(locale);

      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "locale",
        value: locale,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[settingsStore] Locale saved: ${locale}`);
    } catch (err) {
      console.error(
        "[settingsStore] saveLocale failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-locale" });
      throw err;
    }
  },

  saveTranscriptionLocale: async (locale: TranscriptionLocale) => {
    try {
      const store = await load(STORE_NAME);

      await store.set("selectedTranscriptionLocale", locale);
      set({ selectedTranscriptionLocale: locale });

      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "transcriptionLocale",
        value: locale,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[settingsStore] Transcription locale saved: ${locale}`);
    } catch (err) {
      console.error(
        "[settingsStore] saveTranscriptionLocale failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-transcription-locale",
      });
      throw err;
    }
  },

  saveMuteOnRecording: async (enabled: boolean) => {
    try {
      const store = await load(STORE_NAME);
      await store.set("muteOnRecording", enabled);
      await store.save();
      set({ isMuteOnRecordingEnabled: enabled });

      const payload: SettingsUpdatedPayload = {
        key: "muteOnRecording",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[settingsStore] muteOnRecording saved: ${enabled}`);
    } catch (err) {
      console.error(
        "[settingsStore] saveMuteOnRecording failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-mute" });
      throw err;
    }
  },

  saveSoundEffectsEnabled: async (enabled: boolean) => {
    try {
      const store = await load(STORE_NAME);
      await store.set("soundEffectsEnabled", enabled);
      await store.save();
      set({ isSoundEffectsEnabled: enabled });

      const payload: SettingsUpdatedPayload = {
        key: "soundEffectsEnabled",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[settingsStore] soundEffectsEnabled saved: ${enabled}`);
    } catch (err) {
      console.error(
        "[settingsStore] saveSoundEffectsEnabled failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-sound-effects" });
      throw err;
    }
  },

  saveSmartDictionaryEnabled: async (enabled: boolean) => {
    try {
      const store = await load(STORE_NAME);
      await store.set("smartDictionaryEnabled", enabled);
      await store.save();
      set({ isSmartDictionaryEnabled: enabled });

      const payload: SettingsUpdatedPayload = {
        key: "smartDictionaryEnabled",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(
        `[settingsStore] smartDictionaryEnabled saved: ${enabled}`,
      );
    } catch (err) {
      console.error(
        "[settingsStore] saveSmartDictionaryEnabled failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-smart-dictionary",
      });
      throw err;
    }
  },

  saveRecordingAutoCleanup: async (enabled: boolean, days: number) => {
    const validatedDays =
      !Number.isInteger(days) || days < 1
        ? DEFAULT_RECORDING_AUTO_CLEANUP_DAYS
        : days;

    try {
      const store = await load(STORE_NAME);
      await store.set("recordingAutoCleanupEnabled", enabled);
      await store.set("recordingAutoCleanupDays", validatedDays);
      await store.save();

      set({
        isRecordingAutoCleanupEnabled: enabled,
        recordingAutoCleanupDays: validatedDays,
      });

      console.log(
        `[settingsStore] Recording auto cleanup saved: enabled=${enabled}, days=${validatedDays}`,
      );
    } catch (err) {
      console.error(
        "[settingsStore] saveRecordingAutoCleanup failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-recording-auto-cleanup",
      });
      throw err;
    }
  },

  saveAudioInputDevice: async (deviceName: string) => {
    try {
      const store = await load(STORE_NAME);
      await store.set("audioInputDeviceName", deviceName);
      await store.save();

      set({ selectedAudioInputDeviceName: deviceName });

      const payload: SettingsUpdatedPayload = {
        key: "audioInputDevice",
        value: deviceName,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[settingsStore] Audio input device saved: "${deviceName || "(system default)"}"`,
      );
    } catch (err) {
      console.error(
        "[settingsStore] saveAudioInputDevice failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-audio-input-device",
      });
      throw err;
    }
  },

  refreshCrossWindowSettings: async () => {
    try {
      const store = await load(STORE_NAME);
      const savedKey = await store.get<TriggerKey>("hotkeyTriggerKey");
      const savedMode = await store.get<TriggerMode>("hotkeyTriggerMode");
      const savedCustomKey =
        await store.get<CustomTriggerKey>("customTriggerKey");
      const savedCustomDomCode = await store.get<string>(
        "customTriggerKeyDomCode",
      );
      const savedApiKey = await store.get<string>("groqApiKey");
      const savedPrompt = await store.get<string>("aiPrompt");
      const savedThresholdEnabled = await store.get<boolean>(
        "enhancementThresholdEnabled",
      );
      const savedThresholdCharCount = await store.get<number>(
        "enhancementThresholdCharCount",
      );
      const savedLlmModelId = await store.get<string>("llmModelId");
      const savedVocabModelId = await store.get<string>(
        "vocabularyAnalysisModelId",
      );
      const savedWhisperModelId = await store.get<string>("whisperModelId");
      const savedMuteOnRecording = await store.get<boolean>("muteOnRecording");
      const savedSoundEffects = await store.get<boolean>("soundEffectsEnabled");
      const savedSmartDictionary = await store.get<boolean>(
        "smartDictionaryEnabled",
      );

      const resolvedCustomKey =
        savedCustomKey && isCustomTriggerKey(savedCustomKey)
          ? savedCustomKey
          : null;
      const resolvedCustomDomCode =
        savedCustomKey && isCustomTriggerKey(savedCustomKey)
          ? (savedCustomDomCode ?? "")
          : "";

      // Locale + transcription locale
      const savedLocale = await store.get<SupportedLocale>("selectedLocale");
      const resolvedLocale = savedLocale ?? FALLBACK_LOCALE;
      await i18n.changeLanguage(resolvedLocale);
      document.documentElement.lang = getHtmlLangForLocale(resolvedLocale);

      const savedTranscriptionLocale = await store.get<TranscriptionLocale>(
        "selectedTranscriptionLocale",
      );
      const resolvedTranscriptionLocale: TranscriptionLocale =
        savedTranscriptionLocale ?? resolvedLocale;

      // Prompt mode
      const savedPromptMode = await store.get<string>("promptMode");
      const resolvedPromptMode: PromptMode =
        savedPromptMode &&
        (PROMPT_MODE_VALUES as readonly string[]).includes(savedPromptMode)
          ? (savedPromptMode as PromptMode)
          : DEFAULT_PROMPT_MODE;

      // Effective prompt locale for fallback
      const effectivePromptLocale =
        resolvedTranscriptionLocale === "auto"
          ? resolvedLocale
          : resolvedTranscriptionLocale;

      const savedRecCleanup = await store.get<boolean>(
        "recordingAutoCleanupEnabled",
      );
      const savedRecCleanupDays = await store.get<number>(
        "recordingAutoCleanupDays",
      );
      const savedAudioDevice = await store.get<string>("audioInputDeviceName");

      set({
        hotkeyConfig: {
          triggerKey: savedKey ?? getDefaultTriggerKey(),
          triggerMode: savedMode ?? "hold",
        },
        customTriggerKey: resolvedCustomKey,
        customTriggerKeyDomCode: resolvedCustomDomCode,
        selectedLocale: resolvedLocale,
        selectedTranscriptionLocale: resolvedTranscriptionLocale,
        promptMode: resolvedPromptMode,
        apiKey: savedApiKey?.trim() ?? "",
        aiPrompt:
          savedPrompt?.trim() ||
          getMinimalPromptForLocale(effectivePromptLocale),
        isEnhancementThresholdEnabled:
          savedThresholdEnabled ?? DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED,
        enhancementThresholdCharCount:
          savedThresholdCharCount ?? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
        selectedLlmModelId: getEffectiveLlmModelId(savedLlmModelId ?? null),
        selectedVocabularyAnalysisModelId:
          getEffectiveVocabularyAnalysisModelId(savedVocabModelId ?? null),
        selectedWhisperModelId: getEffectiveWhisperModelId(
          savedWhisperModelId ?? null,
        ),
        isMuteOnRecordingEnabled:
          savedMuteOnRecording ?? DEFAULT_MUTE_ON_RECORDING,
        isSoundEffectsEnabled:
          savedSoundEffects ?? DEFAULT_SOUND_EFFECTS_ENABLED,
        isSmartDictionaryEnabled:
          savedSmartDictionary ?? DEFAULT_SMART_DICTIONARY_ENABLED,
        isRecordingAutoCleanupEnabled:
          savedRecCleanup ?? DEFAULT_RECORDING_AUTO_CLEANUP_ENABLED,
        recordingAutoCleanupDays:
          savedRecCleanupDays ?? DEFAULT_RECORDING_AUTO_CLEANUP_DAYS,
        selectedAudioInputDeviceName: savedAudioDevice ?? "",
      });
    } catch (err) {
      console.error(
        "[settingsStore] refreshCrossWindowSettings failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "refresh-cross-window" });
    }
  },

  initializeAutoStart: async () => {
    try {
      const store = await load(STORE_NAME);
      const hasInitAutoStart = await store.get<boolean>("hasInitAutoStart");

      if (!hasInitAutoStart) {
        const { enable } = await import("@tauri-apps/plugin-autostart");
        await enable();
        await store.set("hasInitAutoStart", true);
        await store.save();
        set({ isAutoStartEnabled: true });
        console.log("[settingsStore] Auto-start enabled on first launch");
      } else {
        await get().loadAutoStartStatus();
      }
    } catch (err) {
      console.error(
        "[settingsStore] initializeAutoStart failed:",
        extractErrorMessage(err),
      );
    }
  },
}));
