/**
 * Retry transcription flow -- re-transcribe from a saved audio file.
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
import { getProviderConfig } from "@/lib/providerConfig";
import { detectHallucination } from "@/lib/hallucinationDetector";
import type { TranscriptionResult } from "@/types/audio";
import type { ChatUsageData, TranscriptionRecord } from "@/types/transcription";
import type { TranscriptionCompletedPayload } from "@/types/events";
import type { HudStatus } from "@/types";
import { emitToWindow, TRANSCRIPTION_COMPLETED } from "@/hooks/useTauriEvent";
import { getSettingsStore, getHistoryStore, getVocabularyStore } from "./storeAccessors";
import { clearAutoHideTimer } from "./timers";
import {
  buildTranscriptionRecord,
  saveApiUsageRecordList,
  registerRetryAbortController,
} from "./transcriptionPipeline";
import { startCorrectionDetectionFlow } from "./correctionDetection";

// ── Store actions injection (same pattern as transcriptionPipeline) ──

interface VoiceFlowActions {
  getState: () => {
    status: HudStatus;
    isRecording: boolean;
    _isAborted: boolean;
    _lastFailedTranscriptionId: string | null;
    _lastFailedAudioFilePath: string | null;
    _lastFailedRecordingDurationMs: number;
    _lastFailedPeakEnergyLevel: number;
    _lastFailedRmsEnergyLevel: number;
    lastWasModified: boolean | null;
  };
  setState: (partial: Record<string, unknown>) => void;
  transitionTo: (status: HudStatus, message?: string) => void;
  playSoundIfEnabled: (slot: "start" | "stop" | "error" | "learned") => void;
}

let _actions: VoiceFlowActions | null = null;

export function setRetryFlowActions(actions: VoiceFlowActions): void {
  _actions = actions;
}

function actions(): VoiceFlowActions {
  if (!_actions) throw new Error("voiceFlow: retry actions not registered");
  return _actions;
}

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

function buildCompletedPayload(record: TranscriptionRecord): TranscriptionCompletedPayload {
  return {
    id: record.id,
    rawText: record.rawText,
    processedText: record.processedText,
    recordingDurationMs: record.recordingDurationMs,
    transcriptionDurationMs: record.transcriptionDurationMs,
    enhancementDurationMs: record.enhancementDurationMs,
    charCount: record.charCount,
    wasEnhanced: record.wasEnhanced,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Vocabulary weight update for retry ──

function updateVocabularyWeightsAfterPaste(finalText: string): void {
  void (async () => {
    try {
      const vocabularyStore = getVocabularyStore();
      const matchedIdList: string[] = [];

      for (const entry of vocabularyStore.termList) {
        const isEnglish = /^[a-zA-Z]/.test(entry.term);
        if (isEnglish) {
          const regex = new RegExp("\\b" + escapeRegex(entry.term) + "\\b", "i");
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
  })();
}

// ── Paste flow for retry (similar to transcriptionPipeline's completePasteFlow) ──

async function completePasteFlowForRetry(params: {
  text: string;
  successMessage: string;
  record: TranscriptionRecord;
  chatUsage: ChatUsageData | null;
}): Promise<void> {
  const { transitionTo, playSoundIfEnabled, setState, getState } = actions();
  try {
    const preserveClipboard = !getSettingsStore().isCopyResultToClipboard;
    await invoke("paste_text", { text: params.text, preserveClipboard });
    setState({ isRecording: false });
    transitionTo("success", params.successMessage);

    // Quality monitor
    void invoke("start_quality_monitor").catch((err: unknown) => {
      writeErrorLog(`voiceFlowStore: start_quality_monitor failed: ${extractErrorMessage(err)}`);
      captureError(err, { source: "voice-flow", step: "quality-monitor" });
    });

    // Weight update (fire-and-forget)
    const finalText = params.record.processedText ?? params.record.rawText;
    updateVocabularyWeightsAfterPaste(finalText);

    // Correction detection for retry
    startCorrectionDetectionFlow(
      params.text,
      params.record.id,
      "",
      () => getState().status,
      () => getState().lastWasModified,
    );
  } catch (pasteError) {
    setState({ isRecording: false });
    transitionTo("error", t("voiceFlow.pasteFailed"));
    playSoundIfEnabled("error");
    writeErrorLog(`voiceFlowStore: paste_text failed: ${extractErrorMessage(pasteError)}`);
    captureError(pasteError, { source: "voice-flow", step: "paste" });
  }
}

// ── Main retry flow ──

export async function handleRetryTranscription(): Promise<void> {
  const { getState, setState, transitionTo, playSoundIfEnabled } = actions();
  const state = getState();
  if (!state._lastFailedAudioFilePath || !state._lastFailedTranscriptionId) {
    return;
  }

  setState({
    _isAborted: false,
    _isRetryAttempt: true,
  });
  const newAbortController = new AbortController();
  registerRetryAbortController(newAbortController);
  clearAutoHideTimer();
  transitionTo("transcribing", t("voiceFlow.transcribing"));

  const filePath = state._lastFailedAudioFilePath;
  const transcriptionId = state._lastFailedTranscriptionId;
  const recordingDurationMs = state._lastFailedRecordingDurationMs;

  try {
    const settingsStore = getSettingsStore();
    let apiKey = settingsStore.getTranscriptionApiKey();

    if (!apiKey) {
      await settingsStore.refreshApiKey(settingsStore.selectedTranscriptionProviderId);
      apiKey = settingsStore.getTranscriptionApiKey();
    }

    if (!apiKey) {
      transitionTo("error", t("errors.apiKeyMissing"));
      playSoundIfEnabled("error");
      setState({
        _lastFailedAudioFilePath: null,
        _isRetryAttempt: false,
      });
      return;
    }

    const vocabularyStore = getVocabularyStore();
    const whisperTermList = await vocabularyStore.getTopTermListByWeight(50);
    const hasVocabulary = whisperTermList.length > 0;
    const providerConfig = getProviderConfig(settingsStore.selectedTranscriptionProviderId);

    const result = await invoke<TranscriptionResult>("retranscribe_from_file", {
      filePath,
      apiUrl: providerConfig.transcriptionBaseUrl,
      apiKey,
      vocabularyTermList: hasVocabulary ? whisperTermList : null,
      modelId: settingsStore.selectedWhisperModelId,
      language: settingsStore.getWhisperLanguageCode(),
    });
    if (getState()._isAborted) return;

    writeInfoLog(`Retry transcription raw: "${result.rawText}"`);

    if (isEmptyTranscription(result.rawText)) {
      transitionTo("error", t("voiceFlow.retryFailed"));
      playSoundIfEnabled("error");
      setState({
        _lastFailedAudioFilePath: null,
        _isRetryAttempt: false,
      });
      return;
    }

    // ── Retry hallucination detection (using original energy levels) ──
    const retryState = getState();
    const retryHallucinationResult = detectHallucination({
      rawText: result.rawText,
      recordingDurationMs,
      peakEnergyLevel: retryState._lastFailedPeakEnergyLevel,
      rmsEnergyLevel: retryState._lastFailedRmsEnergyLevel,
      noSpeechProbability: result.noSpeechProbability,
    });

    if (retryHallucinationResult.isHallucination) {
      writeInfoLog(
        `voiceFlowStore: retry hallucination detected (reason=${String(retryHallucinationResult.reason)})`,
      );
      transitionTo("error", t("voiceFlow.retryFailed"));
      playSoundIfEnabled("error");
      setState({
        _lastFailedAudioFilePath: null,
        _isRetryAttempt: false,
      });
      return;
    }

    // Retry success -- enter AI enhancement -> paste flow
    if (
      !settingsStore.isEnhancementThresholdEnabled ||
      result.rawText.length >= settingsStore.enhancementThresholdCharCount
    ) {
      transitionTo("enhancing", t("voiceFlow.enhancing"));
      const enhancementStartTime = performance.now();

      try {
        const enhancementTermList = await vocabularyStore.getTopTermListByWeight(50);
        const enhanceResult = await enhanceText(result.rawText, apiKey, {
          systemPrompt: settingsStore.getAiPrompt(),
          vocabularyTermList: enhancementTermList.length > 0 ? enhancementTermList : undefined,
          modelId: settingsStore.selectedLlmModelId,
          chatApiUrl: providerConfig.chatBaseUrl,
          signal: newAbortController.signal,
        });
        if (getState()._isAborted) return;

        const enhancementDurationMs = performance.now() - enhancementStartTime;

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

        // Update DB, save api_usage, then emit event so dashboard gets fresh quota data
        const historyStore = getHistoryStore();
        void (async () => {
          try {
            await historyStore.updateTranscriptionOnRetrySuccess(
              {
                id: transcriptionId,
                rawText: result.rawText,
                processedText: enhanceResult.text,
                transcriptionDurationMs: Math.round(result.transcriptionDurationMs),
                enhancementDurationMs: Math.round(enhancementDurationMs),
                wasEnhanced: true,
                charCount: result.rawText.length,
              },
              { skipEmit: true },
            );
            await saveApiUsageRecordList(record, enhanceResult.usage);
            await emitToWindow("main-window", TRANSCRIPTION_COMPLETED, buildCompletedPayload(record));
          } catch (err) {
            writeErrorLog(
              `voiceFlowStore: updateTranscriptionOnRetrySuccess failed: ${extractErrorMessage(err)}`,
            );
          }
        })();
      } catch (enhanceError) {
        if (getState()._isAborted) return;
        const fallbackEnhancementDurationMs = performance.now() - enhancementStartTime;
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
        void (async () => {
          try {
            await historyStore.updateTranscriptionOnRetrySuccess(
              {
                id: transcriptionId,
                rawText: result.rawText,
                processedText: null,
                transcriptionDurationMs: Math.round(result.transcriptionDurationMs),
                enhancementDurationMs: Math.round(fallbackEnhancementDurationMs),
                wasEnhanced: false,
                charCount: result.rawText.length,
              },
              { skipEmit: true },
            );
            await saveApiUsageRecordList(fallbackRecord, null);
            await emitToWindow("main-window", TRANSCRIPTION_COMPLETED, buildCompletedPayload(fallbackRecord));
          } catch (err) {
            writeErrorLog(
              `voiceFlowStore: updateTranscriptionOnRetrySuccess failed: ${extractErrorMessage(err)}`,
            );
          }
        })();
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
      void (async () => {
        try {
          await historyStore.updateTranscriptionOnRetrySuccess(
            {
              id: transcriptionId,
              rawText: result.rawText,
              processedText: null,
              transcriptionDurationMs: Math.round(result.transcriptionDurationMs),
              enhancementDurationMs: null,
              wasEnhanced: false,
              charCount: result.rawText.length,
            },
            { skipEmit: true },
          );
          await saveApiUsageRecordList(record, null);
          await emitToWindow("main-window", TRANSCRIPTION_COMPLETED, buildCompletedPayload(record));
        } catch (err) {
          writeErrorLog(
            `voiceFlowStore: updateTranscriptionOnRetrySuccess failed: ${extractErrorMessage(err)}`,
          );
        }
      })();
    }

    // Retry success -- reset all retry state
    setState({
      _lastFailedTranscriptionId: null,
      _lastFailedAudioFilePath: null,
      _lastFailedRecordingDurationMs: 0,
      _isRetryAttempt: false,
    });
  } catch (error) {
    if (getState()._isAborted) return;
    transitionTo("error", t("voiceFlow.retryFailed"));
    playSoundIfEnabled("error");
    setState({
      _lastFailedAudioFilePath: null,
      _isRetryAttempt: false,
    });
    writeErrorLog(`voiceFlowStore: retry transcription failed: ${extractErrorMessage(error)}`);
    captureError(error, {
      source: "voice-flow",
      step: "retry-transcription",
    });
  }
}
