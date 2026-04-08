import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import type { TriggerMode } from "@/types";
import { findPresetById, CUSTOM_PRESET_ID } from "@/lib/soundPresets";
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
import { logInfo, logError } from "@/lib/logger";
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
  getDefaultWhisperModelForProvider,
  getDefaultLlmModelForProvider,
  type LlmModelId,
  type VocabularyAnalysisModelId,
  type WhisperModelId,
} from "@/lib/modelRegistry";
import {
  type ProviderId,
  DEFAULT_PROVIDER_ID,
  getProviderConfig,
  isValidProviderId,
} from "@/lib/providerConfig";

import { APP_VERSION } from "@/lib/version";
import { IS_MAC } from "@/lib/platform";
import { type AppCategory, resolveAppCategory } from "@/lib/appContextMap";
import { composeContextAwarePrompt, getSurroundingTextInstruction } from "@/lib/contextPrompts";

const STORE_NAME = "settings.json";

export const DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED = false;
export const DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT = 10;
export const DEFAULT_MUTE_ON_RECORDING = true;
const DEFAULT_SMART_DICTIONARY_ENABLED = IS_MAC;
const DEFAULT_SOUND_EFFECTS_ENABLED = true;
export const DEFAULT_SUCCESS_DISPLAY_DURATION_SEC = 1.5;
export type SuccessDisplayDurationSec = 1 | 1.5 | 2 | 3 | 5;
const DEFAULT_PROMPT_MODE: PromptMode = "minimal";
export type RecordingRetentionPolicy = "forever" | "30" | "14" | "7" | "none";
const DEFAULT_RECORDING_RETENTION_POLICY: RecordingRetentionPolicy = "forever";

export interface RecordingsStorageInfo {
  totalSizeBytes: number;
  fileCount: number;
  path: string;
}

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
  selectedProviderId: ProviderId;
  apiKeys: Record<ProviderId, string>;
  apiKey: string; // derived: apiKeys[selectedProviderId] — kept for backward compat
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
  soundPresetId: string;
  customSoundPaths: Record<string, string> | null;
  recordingRetentionPolicy: RecordingRetentionPolicy;
  selectedAudioInputDeviceName: string;
  isCopyResultToClipboard: boolean;
  isContextAwareEnabled: boolean;
  contextAppOverrides: Record<string, AppCategory>;
  successDisplayDurationSec: SuccessDisplayDurationSec;

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
  getContextAwarePrompt: (bundleId: string | null) => string;
  getEffectivePromptLocale: () => SupportedLocale;
  getTriggerKeyDisplayName: (key: TriggerKey) => string;
  getWhisperLanguageCode: () => string | null;

  loadSettings: () => Promise<void>;
  saveHotkeyConfig: (key: TriggerKey, mode: TriggerMode) => Promise<void>;
  saveCustomTriggerKey: (keycode: number, domCode: string, mode: TriggerMode) => Promise<void>;
  switchToPresetMode: (presetKey: TriggerKey, mode: TriggerMode) => Promise<void>;
  switchToCustomMode: (mode: TriggerMode) => Promise<void>;
  saveProviderId: (id: ProviderId) => Promise<void>;
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
  saveSoundPreset: (presetId: string) => Promise<void>;
  saveCustomSoundPath: (slot: string, filePath: string) => Promise<void>;
  getSoundForSlot: (slot: "start" | "stop" | "error" | "learned") => string;
  saveSmartDictionaryEnabled: (enabled: boolean) => Promise<void>;
  saveContextAwareEnabled: (enabled: boolean) => Promise<void>;
  saveRecordingRetentionPolicy: (policy: RecordingRetentionPolicy) => Promise<void>;
  getRecordingsStorageInfo: () => Promise<RecordingsStorageInfo>;
  openRecordingsFolder: () => Promise<void>;
  saveAudioInputDevice: (deviceName: string) => Promise<void>;
  saveCopyResultToClipboard: (enabled: boolean) => Promise<void>;
  saveSuccessDisplayDuration: (sec: SuccessDisplayDurationSec) => Promise<void>;
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
    logError("settings", "[settingsStore] Failed to sync hotkey config:", extractErrorMessage(err));
    captureError(err, { source: "settings", step: "sync-hotkey" });
  }
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  // -- State --
  hotkeyConfig: null,
  selectedProviderId: DEFAULT_PROVIDER_ID,
  apiKeys: { groq: "", openai: "" },
  apiKey: "", // derived: kept in sync with apiKeys[selectedProviderId]
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
  soundPresetId: "default",
  customSoundPaths: null,
  recordingRetentionPolicy: DEFAULT_RECORDING_RETENTION_POLICY,
  selectedAudioInputDeviceName: "",
  isCopyResultToClipboard: false,
  isContextAwareEnabled: false,
  contextAppOverrides: {} as Record<string, AppCategory>,
  successDisplayDurationSec: DEFAULT_SUCCESS_DISPLAY_DURATION_SEC as SuccessDisplayDurationSec,

  // -- Derived getters --
  triggerMode: () => get().hotkeyConfig?.triggerMode ?? "toggle",
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
    return selectedTranscriptionLocale === "auto" ? selectedLocale : selectedTranscriptionLocale;
  },

  getApiKey: () => get().apiKey,

  getAiPrompt: () => {
    const { promptMode, aiPrompt, getEffectivePromptLocale: getLocale } = get();
    if (promptMode === "custom") return aiPrompt;
    return getPromptForModeAndLocale(promptMode, getLocale());
  },

  getContextAwarePrompt: (bundleId: string | null) => {
    const basePrompt = get().getAiPrompt();
    if (!get().isContextAwareEnabled) return basePrompt;
    const locale = get().getEffectivePromptLocale();
    const category = resolveAppCategory(bundleId, get().contextAppOverrides);
    const prompt = composeContextAwarePrompt(basePrompt, category, locale);
    const surroundingInstruction = getSurroundingTextInstruction(locale);
    return surroundingInstruction ? `${prompt}\n${surroundingInstruction}` : prompt;
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

      // Provider migration: if no savedProviderId, existing user → default to groq
      const savedProviderId = await store.get<string>("selectedProviderId");
      const resolvedProviderId: ProviderId =
        savedProviderId && isValidProviderId(savedProviderId)
          ? savedProviderId
          : DEFAULT_PROVIDER_ID;
      if (!savedProviderId) {
        await store.set("selectedProviderId", resolvedProviderId);
        await store.save();
      }

      // Load per-provider API keys
      const savedGroqApiKey = await store.get<string>("groqApiKey");
      const savedOpenaiApiKey = await store.get<string>("openaiApiKey");
      const resolvedApiKeys: Record<ProviderId, string> = {
        groq: savedGroqApiKey?.trim() ?? "",
        openai: savedOpenaiApiKey?.trim() ?? "",
      };
      const resolvedActiveApiKey = resolvedApiKeys[resolvedProviderId];

      const key = savedKey ?? getDefaultTriggerKey();
      const mode = savedMode ?? "toggle";

      // Load custom key independently
      const savedCustomKey = await store.get<CustomTriggerKey>("customTriggerKey");
      const savedCustomDomCode = await store.get<string>("customTriggerKeyDomCode");
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
      if (savedPromptMode && (PROMPT_MODE_VALUES as readonly string[]).includes(savedPromptMode)) {
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
        resolvedTranscriptionLocale === "auto" ? resolvedLocale : resolvedTranscriptionLocale;

      const resolvedAiPrompt =
        trimmedSavedPrompt || getMinimalPromptForLocale(effectivePromptLocale);

      // Enhancement threshold
      const savedThresholdEnabled = await store.get<boolean>("enhancementThresholdEnabled");
      const savedThresholdCharCount = await store.get<number>("enhancementThresholdCharCount");

      // LLM model with Kimi K2 migration
      const savedLlmModelId = await store.get<string>("llmModelId");
      const effectiveLlmModelId = getEffectiveLlmModelId(savedLlmModelId ?? null);
      const llmMigratedToKimiK2 = await store.get<boolean>("llmMigratedToKimiK2");
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
      const savedVocabularyAnalysisModelId = await store.get<string>("vocabularyAnalysisModelId");
      const resolvedVocabModelId = getEffectiveVocabularyAnalysisModelId(
        savedVocabularyAnalysisModelId ?? null,
      );

      // Whisper model
      const savedWhisperModelId = await store.get<string>("whisperModelId");
      const resolvedWhisperModelId = getEffectiveWhisperModelId(savedWhisperModelId ?? null);

      // Boolean settings
      const savedMuteOnRecording = await store.get<boolean>("muteOnRecording");
      const savedSoundEffects = await store.get<boolean>("soundEffectsEnabled");
      const savedSoundPresetId = await store.get<string>("soundPresetId");
      const savedCustomSoundPaths = await store.get<Record<string, string>>("customSoundPaths");
      const savedSmartDictionary = await store.get<boolean>("smartDictionaryEnabled");
      // Recording retention: migrate from old boolean+days to new policy
      const savedRetentionPolicy = await store.get<RecordingRetentionPolicy>("recordingRetentionPolicy");
      let resolvedRetentionPolicy: RecordingRetentionPolicy = DEFAULT_RECORDING_RETENTION_POLICY;
      if (savedRetentionPolicy) {
        resolvedRetentionPolicy = savedRetentionPolicy;
      } else {
        // Migrate from legacy settings
        const legacyEnabled = await store.get<boolean>("recordingAutoCleanupEnabled");
        const legacyDays = await store.get<number>("recordingAutoCleanupDays");
        if (legacyEnabled && legacyDays) {
          if (legacyDays <= 7) resolvedRetentionPolicy = "7";
          else if (legacyDays <= 14) resolvedRetentionPolicy = "14";
          else resolvedRetentionPolicy = "30";
        }
      }
      const savedAudioInputDeviceName = await store.get<string>("audioInputDeviceName");
      const savedCopyResultToClipboard = await store.get<boolean>("copyResultToClipboard");
      const savedSuccessDisplayDurationSec = await store.get<number>("successDisplayDurationSec");

      // Context-aware enhancement
      const savedContextAwareEnabled = await store.get<boolean>("contextAwareEnabled");
      const savedContextAppOverrides = await store.get<Record<string, AppCategory>>("contextAppOverrides");

      set({
        hotkeyConfig: { triggerKey: key, triggerMode: mode },
        selectedProviderId: resolvedProviderId,
        apiKeys: resolvedApiKeys,
        apiKey: resolvedActiveApiKey,
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
        isMuteOnRecordingEnabled: savedMuteOnRecording ?? DEFAULT_MUTE_ON_RECORDING,
        isSoundEffectsEnabled: savedSoundEffects ?? DEFAULT_SOUND_EFFECTS_ENABLED,
        soundPresetId: savedSoundPresetId ?? "default",
        customSoundPaths: savedCustomSoundPaths ?? null,
        isSmartDictionaryEnabled: savedSmartDictionary ?? DEFAULT_SMART_DICTIONARY_ENABLED,
        recordingRetentionPolicy: resolvedRetentionPolicy,
        selectedAudioInputDeviceName: savedAudioInputDeviceName ?? "",
        isCopyResultToClipboard: savedCopyResultToClipboard ?? false,
        successDisplayDurationSec: (savedSuccessDisplayDurationSec ?? DEFAULT_SUCCESS_DISPLAY_DURATION_SEC) as SuccessDisplayDurationSec,
        isContextAwareEnabled: savedContextAwareEnabled ?? false,
        contextAppOverrides: savedContextAppOverrides ?? {},
      });

      // Sync saved config to Rust on startup
      await syncHotkeyConfigToRust(key, mode);
      isLoaded = true;
      logInfo("settings", `Settings loaded: key=${JSON.stringify(key)}, mode=${mode}`);
    } catch (err) {
      logError("settings", "[settingsStore] loadSettings failed:", extractErrorMessage(err));
      captureError(err, { source: "settings", step: "load" });

      // Fallback to platform defaults
      const key = getDefaultTriggerKey();
      set({
        hotkeyConfig: { triggerKey: key, triggerMode: "toggle" },
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

      logInfo("settings", `Hotkey config saved: key=${JSON.stringify(key)}, mode=${mode}`);
    } catch (err) {
      logError("settings", "[settingsStore] saveHotkeyConfig failed:", extractErrorMessage(err));
      captureError(err, { source: "settings", step: "save-hotkey" });
      throw err;
    }
  },

  saveCustomTriggerKey: async (keycode: number, domCode: string, mode: TriggerMode) => {
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

      logInfo(
        "settings",
        `Custom trigger key saved: keycode=${keycode}, domCode=${domCode}, mode=${mode}`,
      );
    } catch (err) {
      logError(
        "settings",
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

  saveProviderId: async (id: ProviderId) => {
    try {
      const store = await load(STORE_NAME);
      await store.set("selectedProviderId", id);

      // Auto-reset models to provider defaults
      const defaultWhisper = getDefaultWhisperModelForProvider(id);
      const defaultLlm = getDefaultLlmModelForProvider(id);
      await store.set("whisperModelId", defaultWhisper);
      await store.set("llmModelId", defaultLlm);
      await store.save();

      const { apiKeys } = get();
      set({
        selectedProviderId: id,
        apiKey: apiKeys[id],
        selectedWhisperModelId: defaultWhisper,
        selectedLlmModelId: defaultLlm,
      });

      const payload: SettingsUpdatedPayload = { key: "providerId", value: id };
      await emitEvent(SETTINGS_UPDATED, payload);

      logInfo("settings", `Provider changed to: ${id}`);
    } catch (err) {
      logError("settings", "[settingsStore] saveProviderId failed:", extractErrorMessage(err));
      captureError(err, { source: "settings", step: "save-provider" });
      throw err;
    }
  },

  saveApiKey: async (key: string) => {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error(i18n.t("errors.apiKeyEmpty"));
    }

    // Provider-specific validation
    const { selectedProviderId } = get();
    const providerConfig = getProviderConfig(selectedProviderId);
    if (providerConfig.keyPrefix && !trimmedKey.startsWith(providerConfig.keyPrefix)) {
      throw new Error(
        i18n.t("errors.apiKeyInvalidFormat", {
          prefix: providerConfig.keyPrefix,
          defaultValue: `API Key should start with ${providerConfig.keyPrefix}`,
        }),
      );
    }

    try {
      const store = await load(STORE_NAME);
      await store.set(providerConfig.keyStoreKey, trimmedKey);
      await store.save();

      const newApiKeys = { ...get().apiKeys, [selectedProviderId]: trimmedKey };
      set({ apiKeys: newApiKeys, apiKey: trimmedKey });

      const payload: SettingsUpdatedPayload = {
        key: "apiKey",
        value: trimmedKey,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      logInfo("settings", `API Key saved for provider: ${selectedProviderId}`);
    } catch (err) {
      logError("settings", "[settingsStore] saveApiKey failed:", extractErrorMessage(err));
      captureError(err, { source: "settings", step: "save-api-key" });
      throw err;
    }
  },

  refreshApiKey: async () => {
    try {
      const store = await load(STORE_NAME);
      const { selectedProviderId } = get();
      const providerConfig = getProviderConfig(selectedProviderId);
      const savedApiKey = await store.get<string>(providerConfig.keyStoreKey);
      const trimmedKey = savedApiKey?.trim() ?? "";
      const newApiKeys = { ...get().apiKeys, [selectedProviderId]: trimmedKey };
      set({ apiKeys: newApiKeys, apiKey: trimmedKey });
    } catch (err) {
      logError("settings", "[settingsStore] refreshApiKey failed:", extractErrorMessage(err));
    }
  },

  deleteApiKey: async () => {
    try {
      const { selectedProviderId } = get();
      const providerConfig = getProviderConfig(selectedProviderId);
      const store = await load(STORE_NAME);
      await store.delete(providerConfig.keyStoreKey);
      await store.save();

      const newApiKeys = { ...get().apiKeys, [selectedProviderId]: "" };
      set({ apiKeys: newApiKeys, apiKey: "" });

      const payload: SettingsUpdatedPayload = { key: "apiKey", value: "" };
      await emitEvent(SETTINGS_UPDATED, payload);

      logInfo("settings", `API Key deleted for provider: ${selectedProviderId}`);
    } catch (err) {
      logError("settings", "[settingsStore] deleteApiKey failed:", extractErrorMessage(err));
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
      logInfo("settings", `Prompt mode saved: ${mode}`);
    } catch (err) {
      set({ promptMode: previousMode });
      logError("settings", "[settingsStore] savePromptMode failed:", extractErrorMessage(err));
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
      logError(
        "settings",
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

      logInfo("settings", "AI Prompt saved");
    } catch (err) {
      logError("settings", "[settingsStore] saveAiPrompt failed:", extractErrorMessage(err));
      throw err;
    }
  },

  resetAiPrompt: async () => {
    try {
      const store = await load(STORE_NAME);
      const defaultPrompt = getMinimalPromptForLocale(get().getEffectivePromptLocale());
      set({ promptMode: "minimal", aiPrompt: defaultPrompt });
      await store.set("promptMode", "minimal");
      await store.set("aiPrompt", defaultPrompt);
      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "promptMode",
        value: "minimal",
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      logInfo("settings", "AI Prompt reset to minimal");
    } catch (err) {
      logError("settings", "[settingsStore] resetAiPrompt failed:", extractErrorMessage(err));
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

      logInfo(
        "settings",
        `Enhancement threshold saved: enabled=${enabled}, charCount=${validatedCharCount}`,
      );
    } catch (err) {
      logError(
        "settings",
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
      logInfo("settings", `LLM model saved: ${id}`);
    } catch (err) {
      logError("settings", "[settingsStore] saveLlmModel failed:", extractErrorMessage(err));
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
      logInfo("settings", `Vocabulary analysis model saved: ${id}`);
    } catch (err) {
      logError(
        "settings",
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
      logInfo("settings", `Whisper model saved: ${id}`);
    } catch (err) {
      logError("settings", "[settingsStore] saveWhisperModel failed:", extractErrorMessage(err));
      throw err;
    }
  },

  loadAutoStartStatus: async () => {
    try {
      const { isEnabled } = await import("@tauri-apps/plugin-autostart");
      set({ isAutoStartEnabled: await isEnabled() });
    } catch (err) {
      logError("settings", "[settingsStore] loadAutoStartStatus failed:", extractErrorMessage(err));
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
      logError("settings", "[settingsStore] toggleAutoStart failed:", extractErrorMessage(err));
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
      logInfo("settings", `Locale saved: ${locale}`);
    } catch (err) {
      logError("settings", "[settingsStore] saveLocale failed:", extractErrorMessage(err));
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
      logInfo("settings", `Transcription locale saved: ${locale}`);
    } catch (err) {
      logError(
        "settings",
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
      logInfo("settings", `muteOnRecording saved: ${enabled}`);
    } catch (err) {
      logError("settings", "[settingsStore] saveMuteOnRecording failed:", extractErrorMessage(err));
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
      logInfo("settings", `soundEffectsEnabled saved: ${enabled}`);
    } catch (err) {
      logError(
        "settings",
        "[settingsStore] saveSoundEffectsEnabled failed:",
        extractErrorMessage(err),
      );
      captureError(err, { source: "settings", step: "save-sound-effects" });
      throw err;
    }
  },

  saveSoundPreset: async (presetId: string) => {
    try {
      const store = await load(STORE_NAME);
      await store.set("soundPresetId", presetId);
      await store.save();
      set({ soundPresetId: presetId });
      const payload: SettingsUpdatedPayload = {
        key: "soundPresetId" as SettingsUpdatedPayload["key"],
        value: presetId,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      logInfo("settings", `Sound preset saved: ${presetId}`);
    } catch (err) {
      logError("settings", "saveSoundPreset failed:", extractErrorMessage(err));
      captureError(err, { source: "settings", step: "save-sound-preset" });
      throw err;
    }
  },

  saveCustomSoundPath: async (slot: string, filePath: string) => {
    try {
      const store = await load(STORE_NAME);
      const current = get().customSoundPaths ?? {};
      const updated = { ...current, [slot]: filePath };
      await store.set("customSoundPaths", updated);
      await store.save();
      set({ customSoundPaths: updated });
      logInfo("settings", `Custom sound path saved: ${slot}=${filePath}`);
    } catch (err) {
      logError("settings", "saveCustomSoundPath failed:", extractErrorMessage(err));
      captureError(err, { source: "settings", step: "save-custom-sound-path" });
      throw err;
    }
  },

  getSoundForSlot: (slot: "start" | "stop" | "error" | "learned") => {
    const { soundPresetId, customSoundPaths } = get();
    if (soundPresetId === CUSTOM_PRESET_ID && customSoundPaths?.[slot]) {
      return customSoundPaths[slot] ?? "";
    }
    const preset = findPresetById(soundPresetId);
    return preset?.sounds[slot] ?? "";
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
      logInfo("settings", `smartDictionaryEnabled saved: ${enabled}`);
    } catch (err) {
      logError(
        "settings",
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

  saveContextAwareEnabled: async (enabled: boolean) => {
    try {
      const store = await load(STORE_NAME);
      await store.set("contextAwareEnabled", enabled);
      await store.save();
      set({ isContextAwareEnabled: enabled });

      const payload: SettingsUpdatedPayload = {
        key: "contextAwareEnabled",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      logInfo("settings", `contextAwareEnabled saved: ${enabled}`);
    } catch (err) {
      logError(
        "settings",
        "[settingsStore] saveContextAwareEnabled failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-context-aware",
      });
      throw err;
    }
  },

  saveRecordingRetentionPolicy: async (policy: RecordingRetentionPolicy) => {
    try {
      const store = await load(STORE_NAME);
      await store.set("recordingRetentionPolicy", policy);
      await store.save();

      set({ recordingRetentionPolicy: policy });

      logInfo("settings", `Recording retention policy saved: ${policy}`);
    } catch (err) {
      logError(
        "settings",
        "[settingsStore] saveRecordingRetentionPolicy failed:",
        extractErrorMessage(err),
      );
      captureError(err, {
        source: "settings",
        step: "save-recording-retention-policy",
      });
      throw err;
    }
  },

  getRecordingsStorageInfo: async () => {
    return invoke<RecordingsStorageInfo>("get_recordings_storage_info");
  },

  openRecordingsFolder: async () => {
    await invoke("open_recordings_folder");
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

      logInfo("settings", `Audio input device saved: "${deviceName || "(system default)"}"`);
    } catch (err) {
      logError(
        "settings",
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

  saveCopyResultToClipboard: async (enabled: boolean) => {
    try {
      const store = await load(STORE_NAME);
      await store.set("copyResultToClipboard", enabled);
      await store.save();
      set({ isCopyResultToClipboard: enabled });

      const payload: SettingsUpdatedPayload = {
        key: "copyResultToClipboard" as SettingsUpdatedPayload["key"],
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      logInfo("settings", `Copy result to clipboard saved: ${String(enabled)}`);
    } catch (err) {
      logError("settings", "saveCopyResultToClipboard failed:", extractErrorMessage(err));
      captureError(err, { source: "settings", step: "save-preserve-clipboard" });
      throw err;
    }
  },

  saveSuccessDisplayDuration: async (sec: SuccessDisplayDurationSec) => {
    try {
      const store = await load(STORE_NAME);
      await store.set("successDisplayDurationSec", sec);
      await store.save();
      set({ successDisplayDurationSec: sec });

      const payload: SettingsUpdatedPayload = {
        key: "successDisplayDuration",
        value: sec,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      logInfo("settings", `Success display duration saved: ${sec}s`);
    } catch (err) {
      logError("settings", "saveSuccessDisplayDuration failed:", extractErrorMessage(err));
      captureError(err, { source: "settings", step: "save-success-display-duration" });
      throw err;
    }
  },

  refreshCrossWindowSettings: async () => {
    try {
      const store = await load(STORE_NAME);
      const savedKey = await store.get<TriggerKey>("hotkeyTriggerKey");
      const savedMode = await store.get<TriggerMode>("hotkeyTriggerMode");
      const savedCustomKey = await store.get<CustomTriggerKey>("customTriggerKey");
      const savedCustomDomCode = await store.get<string>("customTriggerKeyDomCode");
      // Provider
      const cwSavedProviderId = await store.get<string>("selectedProviderId");
      const cwResolvedProviderId: ProviderId =
        cwSavedProviderId && isValidProviderId(cwSavedProviderId)
          ? cwSavedProviderId
          : DEFAULT_PROVIDER_ID;
      const cwGroqApiKey = await store.get<string>("groqApiKey");
      const cwOpenaiApiKey = await store.get<string>("openaiApiKey");
      const cwApiKeys: Record<ProviderId, string> = {
        groq: cwGroqApiKey?.trim() ?? "",
        openai: cwOpenaiApiKey?.trim() ?? "",
      };

      const savedPrompt = await store.get<string>("aiPrompt");
      const savedThresholdEnabled = await store.get<boolean>("enhancementThresholdEnabled");
      const savedThresholdCharCount = await store.get<number>("enhancementThresholdCharCount");
      const savedLlmModelId = await store.get<string>("llmModelId");
      const savedVocabModelId = await store.get<string>("vocabularyAnalysisModelId");
      const savedWhisperModelId = await store.get<string>("whisperModelId");
      const savedMuteOnRecording = await store.get<boolean>("muteOnRecording");
      const savedSoundEffects = await store.get<boolean>("soundEffectsEnabled");
      const savedSmartDictionary = await store.get<boolean>("smartDictionaryEnabled");

      const resolvedCustomKey =
        savedCustomKey && isCustomTriggerKey(savedCustomKey) ? savedCustomKey : null;
      const resolvedCustomDomCode =
        savedCustomKey && isCustomTriggerKey(savedCustomKey) ? (savedCustomDomCode ?? "") : "";

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
        savedPromptMode && (PROMPT_MODE_VALUES as readonly string[]).includes(savedPromptMode)
          ? (savedPromptMode as PromptMode)
          : DEFAULT_PROMPT_MODE;

      // Effective prompt locale for fallback
      const effectivePromptLocale =
        resolvedTranscriptionLocale === "auto" ? resolvedLocale : resolvedTranscriptionLocale;

      const savedRetentionPolicy = await store.get<RecordingRetentionPolicy>("recordingRetentionPolicy");
      const savedAudioDevice = await store.get<string>("audioInputDeviceName");
      const savedCopyResultToClipboard = await store.get<boolean>("copyResultToClipboard");
      const savedSuccessDisplayDurationSec = await store.get<number>("successDisplayDurationSec");

      set({
        hotkeyConfig: {
          triggerKey: savedKey ?? getDefaultTriggerKey(),
          triggerMode: savedMode ?? "toggle",
        },
        selectedProviderId: cwResolvedProviderId,
        apiKeys: cwApiKeys,
        apiKey: cwApiKeys[cwResolvedProviderId],
        customTriggerKey: resolvedCustomKey,
        customTriggerKeyDomCode: resolvedCustomDomCode,
        selectedLocale: resolvedLocale,
        selectedTranscriptionLocale: resolvedTranscriptionLocale,
        promptMode: resolvedPromptMode,
        aiPrompt: savedPrompt?.trim() || getMinimalPromptForLocale(effectivePromptLocale),
        isEnhancementThresholdEnabled:
          savedThresholdEnabled ?? DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED,
        enhancementThresholdCharCount:
          savedThresholdCharCount ?? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
        selectedLlmModelId: getEffectiveLlmModelId(savedLlmModelId ?? null),
        selectedVocabularyAnalysisModelId: getEffectiveVocabularyAnalysisModelId(
          savedVocabModelId ?? null,
        ),
        selectedWhisperModelId: getEffectiveWhisperModelId(savedWhisperModelId ?? null),
        isMuteOnRecordingEnabled: savedMuteOnRecording ?? DEFAULT_MUTE_ON_RECORDING,
        isSoundEffectsEnabled: savedSoundEffects ?? DEFAULT_SOUND_EFFECTS_ENABLED,
        isSmartDictionaryEnabled: savedSmartDictionary ?? DEFAULT_SMART_DICTIONARY_ENABLED,
        recordingRetentionPolicy: savedRetentionPolicy ?? DEFAULT_RECORDING_RETENTION_POLICY,
        selectedAudioInputDeviceName: savedAudioDevice ?? "",
        isCopyResultToClipboard: savedCopyResultToClipboard ?? false,
        successDisplayDurationSec: (savedSuccessDisplayDurationSec ?? DEFAULT_SUCCESS_DISPLAY_DURATION_SEC) as SuccessDisplayDurationSec,
      });
    } catch (err) {
      logError(
        "settings",
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
        logInfo("settings", "Auto-start enabled on first launch");
      } else {
        await get().loadAutoStartStatus();
      }
    } catch (err) {
      logError("settings", "[settingsStore] initializeAutoStart failed:", extractErrorMessage(err));
    }
  },
}));
