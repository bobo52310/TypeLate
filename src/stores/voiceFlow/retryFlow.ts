/**
 * Retry transcription flow — re-transcribe from a saved audio file.
 *
 * When transcription fails (empty result, hallucination, or API error),
 * the audio file is saved and the user can retry. This module handles
 * the re-transcription, re-enhancement, and paste flow for retries.
 */

import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { extractErrorMessage, getEnhancementErrorMessage } from "@/lib/errorUtils";
import { captureError } from "@/lib/sentry";
import { enhanceText } from "@/lib/enhancer";
import { detectHallucination } from "@/lib/hallucinationDetector";
import type { TranscriptionResult } from "@/types/audio";
import type { ChatUsageData, TranscriptionRecord, ApiUsageRecord } from "@/types/transcription";
import { useVoiceFlowStore } from "../voiceFlowStore";
import { transitionTo, playSoundIfEnabled } from "../voiceFlowStore";
import { clearAutoHideTimer } from "./timers";
import {
  buildTranscriptionRecord,
  saveApiUsageRecordList,
  setAbortController,
  restoreSystemAudio,
} from "./transcriptionPipeline";

// ── Helpers ──

function t(key: string, params?: Record<string, unknown>): string {
  return i18n.t(key, params ?? {});
}

function writeInfoLog(logMessage: string): void {
  void invoke("debug_log", { level: "info", message: logMessage });
}

function writeErrorLog(logMessage: string): void {
  void invoke("debug_log", { level: "error", message: logMessage });
}

function isEmptyTranscription(rawText: string): boolean {
  return !rawText || !rawText.trim();
}

// ── Settings/Store accessor helpers ──

function getSettingsStore(): {
  selectedWhisperModelId: string;
  selectedLlmModelId: string;
  isEnhancementThresholdEnabled: boolean;
  enhancementThresholdCharCount: number;
  getApiKey: () => string | null;
  refreshApiKey: () => Promise<void>;
  getAiPrompt: () => string;
  getWhisperLanguageCode: () => string | null;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../settingsStore") as { useSettingsStore: { getState: () => ReturnType<typeof getSettingsStore> } };
  return mod.useSettingsStore.getState();
}

function getHistoryStore(): {
  addApiUsage: (record: ApiUsageRecord) => Promise<void>;
  updateTranscriptionOnRetrySuccess: (params: {
    id: string;
    rawText: string;
    processedText: string | null;
    transcriptionDurationMs: number;
    enhancementDurationMs: number | null;
    wasEnhanced: boolean;
    charCount: number;
  }) => Promise<void>;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../historyStore") as { useHistoryStore: { getState: () => ReturnType<typeof getHistoryStore> } };
  return mod.useHistoryStore.getState();
}

function getVocabularyStore(): {
  termList: Array<{ id: string; term: string }>;
  getTopTermListByWeight: (limit: number) => Promise<string[]>;
  batchIncrementWeights: (idList: string[]) => Promise<void>;
  isDuplicateTerm: (term: string) => boolean;
  addAiSuggestedTerm: (term: string) => Promise<void>;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../vocabularyStore") as { useVocabularyStore: { getState: () => ReturnType<typeof getVocabularyStore> } };
  return mod.useVocabularyStore.getState();
}

// ── Paste flow for retry ──

async function completePasteFlowForRetry(params: {
  text: string;
  successMessage: string;
  record: TranscriptionRecord;
  chatUsage: ChatUsageData | null;
}): Promise<void> {
  try {
    await invoke("paste_text", { text: params.text });
    useVoiceFlowStore.setState({ isRecording: false });
    transitionTo("success", params.successMessage);

    // Quality monitor
    void invoke("start_quality_monitor").catch((err: unknown) => {
      writeErrorLog(
        `voiceFlowStore: start_quality_monitor failed: ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "quality-monitor" });
    });

    // Weight update (fire-and-forget)
    const finalText = params.record.processedText ?? params.record.rawText;
    void updateVocabularyWeightsForRetry(finalText);

    // Correction detection for retry
    const settingsStore = getSettingsStore();
    const apiKey = settingsStore.getApiKey();
    if (apiKey) {
      const { startCorrectionDetectionFlow } = await import("./correctionDetection");
      const vocabularyStore = getVocabularyStore();
      const historyStore = getHistoryStore();
      startCorrectionDetectionFlow(
        params.text,
        params.record.id,
        apiKey,
        {
          isSmartDictionaryEnabled: true, // Must be enabled to reach here
          selectedVocabularyAnalysisModelId: settingsStore.selectedLlmModelId,
          selectedLlmModelId: settingsStore.selectedLlmModelId,
        },
        vocabularyStore,
        historyStore,
      );
    }
  } catch (pasteError) {
    useVoiceFlowStore.setState({ isRecording: false });
    transitionTo("error", t("voiceFlow.pasteFailed"));
    playSoundIfEnabled("play_error_sound");
    writeErrorLog(
      `voiceFlowStore: paste_text failed: ${extractErrorMessage(pasteError)}`,
    );
    captureError(pasteError, { source: "voice-flow", step: "paste" });
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function updateVocabularyWeightsForRetry(finalText: string): Promise<void> {
  try {
    const vocabularyStore = getVocabularyStore();
    const matchedIdList: string[] = [];

    for (const entry of vocabularyStore.termList) {
      const isEnglish = /^[a-zA-Z]/.test(entry.term);
      if (isEnglish) {
        const regex = new RegExp(
          "\\b" + escapeRegex(entry.term) + "\\b",
          "i",
        );
        if (regex.test(finalText)) {
          matchedIdList.push(entry.id);
        }
      } else {
        if (finalText.includes(entry.term)) {
          matchedIdList.push(entry.id);
        }
      }
    }

    if (matchedIdList.length > 0) {
      await vocabularyStore.batchIncrementWeights(matchedIdList);
    }
  } catch (err) {
    writeErrorLog(
      `voiceFlowStore: retry vocabulary weight update failed: ${extractErrorMessage(err)}`,
    );
  }
}

// ── Main retry flow ──

export async function handleRetryTranscription(): Promise<void> {
  const state = useVoiceFlowStore.getState();
  if (!state._lastFailedAudioFilePath || !state._lastFailedTranscriptionId) {
    return;
  }

  useVoiceFlowStore.setState({
    _isAborted: false,
    _isRetryAttempt: true,
  });
  const newAbortController = new AbortController();
  setAbortController(newAbortController);
  clearAutoHideTimer();
  transitionTo("transcribing", t("voiceFlow.transcribing"));

  const filePath = state._lastFailedAudioFilePath;
  const transcriptionId = state._lastFailedTranscriptionId;
  const recordingDurationMs = state._lastFailedRecordingDurationMs;

  try {
    const settingsStore = getSettingsStore();
    let apiKey = settingsStore.getApiKey();

    if (!apiKey) {
      await settingsStore.refreshApiKey();
      apiKey = settingsStore.getApiKey();
    }

    if (!apiKey) {
      transitionTo("error", t("errors.apiKeyMissing"));
      playSoundIfEnabled("play_error_sound");
      useVoiceFlowStore.setState({
        _lastFailedAudioFilePath: null,
        _isRetryAttempt: false,
      });
      return;
    }

    const vocabularyStore = getVocabularyStore();
    const whisperTermList = await vocabularyStore.getTopTermListByWeight(50);
    const hasVocabulary = whisperTermList.length > 0;

    const result = await invoke<TranscriptionResult>(
      "retranscribe_from_file",
      {
        filePath,
        apiKey,
        vocabularyTermList: hasVocabulary ? whisperTermList : null,
        modelId: settingsStore.selectedWhisperModelId,
        language: settingsStore.getWhisperLanguageCode(),
      },
    );
    if (useVoiceFlowStore.getState()._isAborted) return;

    writeInfoLog(`Retry transcription raw: "${result.rawText}"`);

    if (isEmptyTranscription(result.rawText)) {
      // Retry also failed — no more retries
      transitionTo("error", t("voiceFlow.retryFailed"));
      playSoundIfEnabled("play_error_sound");
      useVoiceFlowStore.setState({
        _lastFailedAudioFilePath: null,
        _isRetryAttempt: false,
      });
      return;
    }

    // ── Retry also needs hallucination detection (using original recording energy levels) ──
    const retryHallucinationResult = detectHallucination({
      rawText: result.rawText,
      recordingDurationMs,
      peakEnergyLevel: state._lastFailedPeakEnergyLevel,
      rmsEnergyLevel: state._lastFailedRmsEnergyLevel,
      noSpeechProbability: result.noSpeechProbability,
    });

    if (retryHallucinationResult.isHallucination) {
      writeInfoLog(
        `voiceFlowStore: retry hallucination detected (reason=${String(retryHallucinationResult.reason)})`,
      );
      transitionTo("error", t("voiceFlow.retryFailed"));
      playSoundIfEnabled("play_error_sound");
      useVoiceFlowStore.setState({
        _lastFailedAudioFilePath: null,
        _isRetryAttempt: false,
      });
      return;
    }

    // Retry success → enter AI enhancement → paste flow
    if (
      !settingsStore.isEnhancementThresholdEnabled ||
      result.rawText.length >= settingsStore.enhancementThresholdCharCount
    ) {
      transitionTo("enhancing", t("voiceFlow.enhancing"));
      const enhancementStartTime = performance.now();

      try {
        const enhancementTermList =
          await vocabularyStore.getTopTermListByWeight(50);
        const enhanceResult = await enhanceText(result.rawText, apiKey, {
          systemPrompt: settingsStore.getAiPrompt(),
          vocabularyTermList:
            enhancementTermList.length > 0 ? enhancementTermList : undefined,
          modelId: settingsStore.selectedLlmModelId,
          signal: newAbortController.signal,
        });
        if (useVoiceFlowStore.getState()._isAborted) return;

        const enhancementDurationMs =
          performance.now() - enhancementStartTime;

        const record = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: result.rawText,
          processedText: enhanceResult.text,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs,
          wasEnhanced: true,
          audioFilePath: filePath,
          status: "success",
        });

        writeInfoLog(`Retry AI enhanced: "${enhanceResult.text}"`);

        await completePasteFlowForRetry({
          text: enhanceResult.text,
          successMessage: t("voiceFlow.pasteSuccess"),
          record,
          chatUsage: enhanceResult.usage,
        });

        // Update DB status (UPDATE not INSERT) → record API usage after (FK dependency)
        const historyStore = getHistoryStore();
        void historyStore
          .updateTranscriptionOnRetrySuccess({
            id: transcriptionId,
            rawText: result.rawText,
            processedText: enhanceResult.text,
            transcriptionDurationMs: Math.round(
              result.transcriptionDurationMs,
            ),
            enhancementDurationMs: Math.round(enhancementDurationMs),
            wasEnhanced: true,
            charCount: result.rawText.length,
          })
          .then(() => {
            saveApiUsageRecordList(record, enhanceResult.usage);
          })
          .catch((err: unknown) =>
            writeErrorLog(
              `voiceFlowStore: updateTranscriptionOnRetrySuccess failed: ${extractErrorMessage(err)}`,
            ),
          );
      } catch (enhanceError) {
        if (useVoiceFlowStore.getState()._isAborted) return;
        const fallbackEnhancementDurationMs =
          performance.now() - enhancementStartTime;
        writeErrorLog(
          `voiceFlowStore: retry AI enhancement failed: ${getEnhancementErrorMessage(enhanceError)}`,
        );
        captureError(enhanceError, {
          source: "voice-flow",
          step: "retry-enhancement",
        });

        const fallbackRecord = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: result.rawText,
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs: fallbackEnhancementDurationMs,
          wasEnhanced: false,
          audioFilePath: filePath,
          status: "success",
        });

        await completePasteFlowForRetry({
          text: result.rawText,
          successMessage: t("voiceFlow.pasteSuccessUnenhanced"),
          record: fallbackRecord,
          chatUsage: null,
        });

        const historyStore = getHistoryStore();
        void historyStore
          .updateTranscriptionOnRetrySuccess({
            id: transcriptionId,
            rawText: result.rawText,
            processedText: null,
            transcriptionDurationMs: Math.round(
              result.transcriptionDurationMs,
            ),
            enhancementDurationMs: Math.round(fallbackEnhancementDurationMs),
            wasEnhanced: false,
            charCount: result.rawText.length,
          })
          .then(() => {
            saveApiUsageRecordList(fallbackRecord, null);
          })
          .catch((err: unknown) =>
            writeErrorLog(
              `voiceFlowStore: updateTranscriptionOnRetrySuccess failed: ${extractErrorMessage(err)}`,
            ),
          );
      }
    } else {
      // No enhancement needed
      const record = buildTranscriptionRecord({
        id: transcriptionId,
        rawText: result.rawText,
        processedText: null,
        recordingDurationMs,
        transcriptionDurationMs: result.transcriptionDurationMs,
        enhancementDurationMs: null,
        wasEnhanced: false,
        audioFilePath: filePath,
        status: "success",
      });

      await completePasteFlowForRetry({
        text: result.rawText,
        successMessage: t("voiceFlow.pasteSuccess"),
        record,
        chatUsage: null,
      });

      const historyStore = getHistoryStore();
      void historyStore
        .updateTranscriptionOnRetrySuccess({
          id: transcriptionId,
          rawText: result.rawText,
          processedText: null,
          transcriptionDurationMs: Math.round(result.transcriptionDurationMs),
          enhancementDurationMs: null,
          wasEnhanced: false,
          charCount: result.rawText.length,
        })
        .then(() => {
          saveApiUsageRecordList(record, null);
        })
        .catch((err: unknown) =>
          writeErrorLog(
            `voiceFlowStore: updateTranscriptionOnRetrySuccess failed: ${extractErrorMessage(err)}`,
          ),
        );
    }

    // Retry success → reset all retry state
    useVoiceFlowStore.setState({
      _lastFailedTranscriptionId: null,
      _lastFailedAudioFilePath: null,
      _lastFailedRecordingDurationMs: 0,
      _isRetryAttempt: false,
    });
  } catch (error) {
    if (useVoiceFlowStore.getState()._isAborted) return;
    // Retry also failed (API error etc.) — no more retries
    transitionTo("error", t("voiceFlow.retryFailed"));
    playSoundIfEnabled("play_error_sound");
    useVoiceFlowStore.setState({
      _lastFailedAudioFilePath: null,
      _isRetryAttempt: false,
    });
    writeErrorLog(
      `voiceFlowStore: retry transcription failed: ${extractErrorMessage(error)}`,
    );
    captureError(error, {
      source: "voice-flow",
      step: "retry-transcription",
    });
  }
}
