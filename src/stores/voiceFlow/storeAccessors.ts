/**
 * Store accessor registry -- breaks circular dependency between voiceFlow sub-modules
 * and the sibling Zustand stores (settings, history, vocabulary).
 *
 * Sub-modules call these lazy accessors instead of importing store modules directly.
 * The actual store references are resolved at call time (not import time),
 * so circular dependency is avoided.
 */

// ── Lazy accessor type definitions ──

export interface SettingsStoreAccessor {
  promptMode: import("@/types/settings").PromptMode;
  aiPrompt: string;
  triggerMode: () => "hold" | "toggle" | "doubleTap";
  selectedTranscriptionProviderId: import("@/lib/providerConfig").TranscriptionProviderId;
  selectedLlmProviderId: import("@/lib/providerConfig").LlmProviderId;
  selectedAudioInputDeviceName: string;
  selectedWhisperModelId: string;
  selectedLlmModelId: string;
  selectedVocabularyAnalysisModelId: string;
  isMuteOnRecordingEnabled: boolean;
  isSoundEffectsEnabled: boolean;
  getSoundForSlot: (slot: "start" | "stop" | "error" | "learned") => string;
  isSmartDictionaryEnabled: boolean;
  isEnhancementThresholdEnabled: boolean;
  enhancementThresholdCharCount: number;
  getTranscriptionApiKey: () => string;
  getLlmApiKey: () => string;
  refreshApiKey: (providerId: import("@/lib/providerConfig").LlmProviderId) => Promise<void>;
  getAiPrompt: () => string;
  isContextAwareEnabled: boolean;
  getContextAwarePrompt: (bundleId: string | null) => string;
  getEffectivePromptLocale: () => import("@/i18n/languageConfig").SupportedLocale;
  getWhisperLanguageCode: () => string | null;
  isCopyResultToClipboard: boolean;
  successDisplayDurationSec: number;
  recordingRetentionPolicy: import("@/stores/settingsStore").RecordingRetentionPolicy;
  loadSettings: () => Promise<void>;
}

export interface HistoryStoreAccessor {
  addTranscription: (
    record: import("@/types/transcription").TranscriptionRecord,
    options?: { skipEmit?: boolean },
  ) => Promise<void>;
  addApiUsage: (record: import("@/types/transcription").ApiUsageRecord) => Promise<void>;
  updateTranscriptionOnRetrySuccess: (
    params: {
      id: string;
      rawText: string;
      processedText: string | null;
      transcriptionDurationMs: number;
      enhancementDurationMs: number | null;
      wasEnhanced: boolean;
      charCount: number;
    },
    options?: { skipEmit?: boolean },
  ) => Promise<void>;
}

export interface VocabularyStoreAccessor {
  termList: Array<{ id: string; term: string }>;
  getTopTermListByWeight: (limit: number) => Promise<string[]>;
  batchIncrementWeights: (idList: string[]) => Promise<void>;
  isDuplicateTerm: (term: string) => boolean;
  addAiSuggestedTerm: (term: string) => Promise<void>;
}

// ── Registry ──

type StoreGetter<T> = () => T;

let _getSettingsStore: StoreGetter<SettingsStoreAccessor> | null = null;
let _getHistoryStore: StoreGetter<HistoryStoreAccessor> | null = null;
let _getVocabularyStore: StoreGetter<VocabularyStoreAccessor> | null = null;

/**
 * Register all sibling store accessors. Must be called once during
 * voiceFlowStore initialization (in the `initialize` action).
 */
export function registerStoreAccessors(accessors: {
  settings: StoreGetter<SettingsStoreAccessor>;
  history: StoreGetter<HistoryStoreAccessor>;
  vocabulary: StoreGetter<VocabularyStoreAccessor>;
}): void {
  _getSettingsStore = accessors.settings;
  _getHistoryStore = accessors.history;
  _getVocabularyStore = accessors.vocabulary;
}

export function getSettingsStore(): SettingsStoreAccessor {
  if (!_getSettingsStore) {
    throw new Error("voiceFlow: settings store accessor not registered");
  }
  return _getSettingsStore();
}

export function getHistoryStore(): HistoryStoreAccessor {
  if (!_getHistoryStore) {
    throw new Error("voiceFlow: history store accessor not registered");
  }
  return _getHistoryStore();
}

export function getVocabularyStore(): VocabularyStoreAccessor {
  if (!_getVocabularyStore) {
    throw new Error("voiceFlow: vocabulary store accessor not registered");
  }
  return _getVocabularyStore();
}
