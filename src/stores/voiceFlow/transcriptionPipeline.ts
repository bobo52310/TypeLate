/**
 * Transcription pipeline -- the core recording/transcribe/enhance/paste flow.
 *
 * Handles:
 * - handleStartRecording: start audio capture
 * - handleStopRecording: stop -> transcribe -> hallucination check -> enhance -> paste
 * - Helper functions: completePasteFlow, buildTranscriptionRecord, etc.
 *
 * Uses storeAccessors for sibling stores and receives VoiceFlow store actions
 * via callbacks to avoid circular imports.
 */

import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import {
  extractErrorMessage,
  getEnhancementErrorMessage,
  getMicrophoneErrorMessage,
  getTranscriptionErrorMessage,
} from "@/lib/errorUtils";
import { captureError } from "@/lib/sentry";
import { groqCircuitBreaker } from "@/lib/circuitBreaker";
import { enhanceText } from "@/lib/enhancer";
import { detectHallucination, detectEnhancementAnomaly } from "@/lib/hallucinationDetector";
import { calculateWhisperCostCeiling, calculateChatCostCeiling } from "@/lib/apiPricing";
import { retryWithBackoff } from "@/lib/retryWithBackoff";
import type { StopRecordingResult, TranscriptionResult } from "@/types/audio";
import type { TranscriptionRecord, ChatUsageData, ApiUsageRecord } from "@/types/transcription";
import type { HudStatus } from "@/types";
import { getSettingsStore, getHistoryStore, getVocabularyStore } from "./storeAccessors";
import {
  startElapsedTimer,
  stopElapsedTimer,
  clearDelayedMuteTimer,
  setDelayedMuteTimer,
  startRecordingTimeoutTimer,
  clearRecordingTimeoutTimer,
} from "./timers";
import { startCorrectionDetectionFlow } from "./correctionDetection";

// ── Constants ──

const MAX_ENHANCEMENT_RETRY_COUNT = 3;
const START_SOUND_DURATION_MS = 400;
const MINIMUM_RECORDING_DURATION_MS = 300;

// ── Module-level abort state ──

let abortController: AbortController | null = null;

export function getAbortController(): AbortController | null {
  return abortController;
}

export function setAbortController(controller: AbortController | null): void {
  abortController = controller;
}

// ── Store actions injection (avoids circular import with voiceFlowStore) ──

interface VoiceFlowActions {
  getState: () => {
    status: HudStatus;
    isRecording: boolean;
    _isAborted: boolean;
  };
  setState: (partial: Record<string, unknown>) => void;
  transitionTo: (status: HudStatus, message?: string) => void;
  playSoundIfEnabled: (command: string) => void;
  failRecordingFlow: (errorMessage: string, logMessage: string, error?: unknown) => void;
}

let _actions: VoiceFlowActions | null = null;

export function setVoiceFlowActions(actions: VoiceFlowActions): void {
  _actions = actions;
}

function actions(): VoiceFlowActions {
  if (!_actions) throw new Error("voiceFlow: actions not registered");
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

function getSuccessMessage(enhanced: boolean): string {
  const isCopyOnly = getSettingsStore().pasteMode === "copy-only";
  if (isCopyOnly) {
    return enhanced ? t("voiceFlow.copiedToClipboard") : t("voiceFlow.copiedToClipboardUnenhanced");
  }
  return enhanced ? t("voiceFlow.pasteSuccess") : t("voiceFlow.pasteSuccessUnenhanced");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Audio helpers ──

async function muteSystemAudioIfEnabled(): Promise<void> {
  const settingsStore = getSettingsStore();
  if (!settingsStore.isMuteOnRecordingEnabled) return;
  try {
    await invoke("mute_system_audio");
  } catch (err) {
    writeErrorLog(
      `voiceFlowStore: mute_system_audio failed (non-blocking): ${extractErrorMessage(err)}`,
    );
    captureError(err, { source: "voice-flow", step: "mute-audio" });
  }
}

export async function restoreSystemAudio(): Promise<void> {
  try {
    await invoke("restore_system_audio");
  } catch (err) {
    writeErrorLog(`voiceFlowStore: restore_system_audio failed: ${extractErrorMessage(err)}`);
    captureError(err, { source: "voice-flow", step: "restore-audio" });
  }
}

// ── Quality monitor ──

function startQualityMonitorAfterPaste(): void {
  void invoke("start_quality_monitor").catch((err: unknown) => {
    writeErrorLog(`voiceFlowStore: start_quality_monitor failed: ${extractErrorMessage(err)}`);
    captureError(err, { source: "voice-flow", step: "quality-monitor" });
  });
}

// ── Record building ──

export function buildTranscriptionRecord(params: {
  id: string;
  rawText: string;
  processedText: string | null;
  recordingDurationMs: number;
  transcriptionDurationMs: number;
  enhancementDurationMs: number | null;
  wasEnhanced: boolean;
  audioFilePath: string | null;
  status: "success" | "failed";
}): TranscriptionRecord {
  const settingsStore = getSettingsStore();
  return {
    id: params.id,
    timestamp: Date.now(),
    rawText: params.rawText,
    processedText: params.processedText,
    recordingDurationMs: Math.round(params.recordingDurationMs),
    transcriptionDurationMs: Math.round(params.transcriptionDurationMs),
    enhancementDurationMs:
      params.enhancementDurationMs !== null ? Math.round(params.enhancementDurationMs) : null,
    charCount: params.rawText.length,
    triggerMode: settingsStore.triggerMode(),
    wasEnhanced: params.wasEnhanced,
    wasModified: null,
    createdAt: "",
    audioFilePath: params.audioFilePath,
    status: params.status,
    whisperModelId: settingsStore.selectedWhisperModelId,
    llmModelId: params.wasEnhanced ? settingsStore.selectedLlmModelId : null,
  };
}

// ── Save helpers ──

async function saveTranscriptionRecord(record: TranscriptionRecord): Promise<void> {
  const historyStore = getHistoryStore();
  try {
    await historyStore.addTranscription(record);
  } catch (err) {
    writeErrorLog(`voiceFlowStore: addTranscription failed: ${extractErrorMessage(err)}`);
    captureError(err, { source: "voice-flow", step: "save-transcription" });
  }
}

export function saveApiUsageRecordList(
  record: TranscriptionRecord,
  chatUsage: ChatUsageData | null,
): void {
  const historyStore = getHistoryStore();
  const settingsStore = getSettingsStore();
  const roundedAudioMs = record.recordingDurationMs;

  function fireAndForget(usageRecord: ApiUsageRecord): void {
    historyStore
      .addApiUsage(usageRecord)
      .catch((err: unknown) =>
        writeErrorLog(
          `voiceFlowStore: addApiUsage(${usageRecord.apiType}) failed: ${extractErrorMessage(err)}`,
        ),
      );
  }

  fireAndForget({
    id: crypto.randomUUID(),
    transcriptionId: record.id,
    apiType: "whisper",
    model: settingsStore.selectedWhisperModelId,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    promptTimeMs: null,
    completionTimeMs: null,
    totalTimeMs: null,
    audioDurationMs: roundedAudioMs,
    estimatedCostCeiling: calculateWhisperCostCeiling(
      roundedAudioMs,
      settingsStore.selectedWhisperModelId,
    ),
  });

  if (chatUsage) {
    fireAndForget({
      id: crypto.randomUUID(),
      transcriptionId: record.id,
      apiType: "chat",
      model: settingsStore.selectedLlmModelId,
      promptTokens: chatUsage.promptTokens,
      completionTokens: chatUsage.completionTokens,
      totalTokens: chatUsage.totalTokens,
      promptTimeMs: chatUsage.promptTimeMs,
      completionTimeMs: chatUsage.completionTimeMs,
      totalTimeMs: chatUsage.totalTimeMs,
      audioDurationMs: null,
      estimatedCostCeiling: calculateChatCostCeiling(
        chatUsage.totalTokens,
        settingsStore.selectedLlmModelId,
      ),
    });
  }
}

// ── Vocabulary weight update ──

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
        writeInfoLog(
          `voiceFlowStore: vocabulary weights updated for ${String(matchedIdList.length)} terms`,
        );
      }
    } catch (err) {
      writeErrorLog(`voiceFlowStore: vocabulary weight update failed: ${extractErrorMessage(err)}`);
      captureError(err, {
        source: "voice-flow",
        step: "vocabulary-weight-update",
      });
    }
  })();
}

// ── Complete paste flow ──

async function completePasteFlow(params: {
  text: string;
  successMessage: string;
  record: TranscriptionRecord;
  chatUsage: ChatUsageData | null;
  skipRecordSaving?: boolean;
}): Promise<void> {
  const { transitionTo, failRecordingFlow } = actions();
  try {
    // Paste mode: auto-paste (default) or copy-only (preserves clipboard)
    const pasteMode = getSettingsStore().pasteMode;
    if (pasteMode === "copy-only") {
      await invoke("copy_to_clipboard", { text: params.text });
    } else {
      await invoke("paste_text", { text: params.text });
    }
    actions().setState({ isRecording: false });

    // Show text preview in success message (truncate to ~30 chars)
    const preview =
      params.text.trim().length > 30 ? params.text.trim().slice(0, 30) + "…" : params.text.trim();
    const successWithPreview = preview
      ? `${params.successMessage} · ${preview}`
      : params.successMessage;
    transitionTo("success", successWithPreview);
    startQualityMonitorAfterPaste();

    // api_usage FK depends on transcriptions -- must wait for transcription write
    if (!params.skipRecordSaving) {
      void saveTranscriptionRecord(params.record).then(() => {
        saveApiUsageRecordList(params.record, params.chatUsage);
      });
    }

    // Weight update (fire-and-forget)
    const finalText = params.record.processedText ?? params.record.rawText;
    updateVocabularyWeightsAfterPaste(finalText);

    // Correction detection (fire-and-forget, requires API key)
    const settingsStore = getSettingsStore();
    const apiKey = settingsStore.getApiKey();
    if (apiKey) {
      startCorrectionDetectionFlow(
        params.text,
        params.record.id,
        apiKey,
        () => actions().getState().status,
      );
    }

    // Cleanup: release abort controller reference
    abortController = null;
  } catch (pasteError) {
    actions().setState({ isRecording: false });
    failRecordingFlow(
      t("voiceFlow.pasteFailed"),
      `voiceFlowStore: paste_text failed: ${extractErrorMessage(pasteError)}`,
      pasteError,
    );
  }
}

// ── Start recording ──

export async function handleStartRecording(): Promise<void> {
  const { getState, setState, transitionTo, playSoundIfEnabled, failRecordingFlow } = actions();
  if (getState().isRecording) return;

  setState({
    isRecording: true,
    lastWasModified: null,
    _isAborted: false,
    _lastFailedTranscriptionId: null,
    _lastFailedAudioFilePath: null,
    _lastFailedRecordingDurationMs: 0,
    _lastFailedPeakEnergyLevel: 0,
    _lastFailedRmsEnergyLevel: 0,
    _isRetryAttempt: false,
  });
  abortController = new AbortController();

  try {
    playSoundIfEnabled("play_start_sound");
    setDelayedMuteTimer(() => {
      void muteSystemAudioIfEnabled();
    }, START_SOUND_DURATION_MS);
    await invoke("start_recording", {
      deviceName: getSettingsStore().selectedAudioInputDeviceName,
    });
    if (getState()._isAborted) return;
    startElapsedTimer();
    startRecordingTimeoutTimer(() => {
      writeInfoLog("voiceFlowStore: recording safety timeout reached, auto-stopping");
      void handleStopRecording();
    });
    transitionTo("recording", t("voiceFlow.recording"));
    writeInfoLog("voiceFlowStore: recording started");
  } catch (error) {
    const errorMessage = getMicrophoneErrorMessage(error);
    const technicalErrorMessage = extractErrorMessage(error);
    failRecordingFlow(
      errorMessage,
      `voiceFlowStore: start recording failed: ${technicalErrorMessage}`,
      error,
    );
  }
}

// ── Stop recording (main pipeline) ──

export async function handleStopRecording(): Promise<void> {
  const { getState, setState, transitionTo, playSoundIfEnabled, failRecordingFlow } = actions();
  if (!getState().isRecording) return;
  if (getState()._isAborted) return;

  clearDelayedMuteTimer();
  clearRecordingTimeoutTimer();
  await restoreSystemAudio();
  playSoundIfEnabled("play_stop_sound");
  stopElapsedTimer();

  const transcriptionId = crypto.randomUUID();
  let audioFilePath: string | null = null;
  let recordingDurationMs = 0;
  let peakEnergyLevel = 0;
  let rmsEnergyLevel = 0;

  try {
    const stopResult = await invoke<StopRecordingResult>("stop_recording");
    if (getState()._isAborted) return;
    recordingDurationMs = stopResult.recordingDurationMs;
    peakEnergyLevel = stopResult.peakEnergyLevel;
    rmsEnergyLevel = stopResult.rmsEnergyLevel;

    // Save audio file (non-blocking)
    try {
      audioFilePath = await invoke<string>("save_recording_file", {
        id: transcriptionId,
      });
      writeInfoLog(`voiceFlowStore: recording saved: ${audioFilePath}`);
    } catch (saveErr) {
      writeErrorLog(
        `voiceFlowStore: save_recording_file failed (non-blocking): ${extractErrorMessage(saveErr)}`,
      );
      captureError(saveErr, {
        source: "voice-flow",
        step: "save-recording-file",
      });
    }

    if (recordingDurationMs < MINIMUM_RECORDING_DURATION_MS) {
      const failedRecord = buildTranscriptionRecord({
        id: transcriptionId,
        rawText: "",
        processedText: null,
        recordingDurationMs,
        transcriptionDurationMs: 0,
        enhancementDurationMs: null,
        wasEnhanced: false,
        audioFilePath,
        status: "failed",
      });
      void saveTranscriptionRecord(failedRecord);

      failRecordingFlow(
        t("voiceFlow.recordingTooShort"),
        `voiceFlowStore: recording too short (${String(Math.round(recordingDurationMs))}ms)`,
      );
      return;
    }

    // Network pre-check: fail fast with a clear message instead of waiting for timeout
    if (!navigator.onLine) {
      failRecordingFlow(t("errors.network"), "voiceFlowStore: offline — skipping transcription");
      return;
    }

    // Circuit breaker: skip API call if recent failures indicate service is down
    if (!groqCircuitBreaker.canExecute()) {
      const cooldownSec = Math.ceil(groqCircuitBreaker.getRemainingCooldownMs() / 1000);
      failRecordingFlow(
        t("errors.transcription.serviceUnavailable"),
        `voiceFlowStore: circuit breaker open (cooldown ${cooldownSec}s)`,
      );
      return;
    }

    transitionTo("transcribing", t("voiceFlow.transcribing"));
    const settingsStore = getSettingsStore();
    let apiKey = settingsStore.getApiKey();

    if (!apiKey) {
      await settingsStore.refreshApiKey();
      apiKey = settingsStore.getApiKey();
    }

    if (!apiKey) {
      failRecordingFlow(
        t("errors.apiKeyMissing"),
        "voiceFlowStore: missing API key while transcribing",
      );
      return;
    }

    const vocabularyStore = getVocabularyStore();
    const whisperTermList = await vocabularyStore.getTopTermListByWeight(50);
    const hasVocabulary = whisperTermList.length > 0;

    let result: TranscriptionResult;
    try {
      result = await retryWithBackoff(
        () =>
          invoke<TranscriptionResult>("transcribe_audio", {
            apiKey,
            vocabularyTermList: hasVocabulary ? whisperTermList : null,
            modelId: settingsStore.selectedWhisperModelId,
            language: settingsStore.getWhisperLanguageCode(),
          }),
        { maxRetries: 2, signal: abortController?.signal ?? undefined },
      );
      groqCircuitBreaker.recordSuccess();
    } catch (apiErr) {
      groqCircuitBreaker.recordFailure();
      throw apiErr;
    }
    if (getState()._isAborted) return;

    writeInfoLog(`Transcription raw: "${result.rawText}"`);

    if (isEmptyTranscription(result.rawText)) {
      const failedRecord = buildTranscriptionRecord({
        id: transcriptionId,
        rawText: result.rawText || "",
        processedText: null,
        recordingDurationMs,
        transcriptionDurationMs: result.transcriptionDurationMs,
        enhancementDurationMs: null,
        wasEnhanced: false,
        audioFilePath,
        status: "failed",
      });
      void saveTranscriptionRecord(failedRecord);

      if (audioFilePath) {
        setState({
          _lastFailedTranscriptionId: transcriptionId,
          _lastFailedAudioFilePath: audioFilePath,
          _lastFailedRecordingDurationMs: recordingDurationMs,
          _lastFailedPeakEnergyLevel: peakEnergyLevel,
          _lastFailedRmsEnergyLevel: rmsEnergyLevel,
        });
      }

      failRecordingFlow(
        t("voiceFlow.noSpeechDetected"),
        `voiceFlowStore: empty transcription (noSpeechProb=${result.noSpeechProbability.toFixed(3)})`,
      );
      return;
    }

    // ── Hallucination detection ──
    writeInfoLog(
      `voiceFlowStore: hallucination detection input: peakEnergy=${peakEnergyLevel.toFixed(4)}, rmsEnergy=${rmsEnergyLevel.toFixed(4)}, nsp=${result.noSpeechProbability.toFixed(3)}, rawText="${result.rawText}", durationMs=${String(Math.round(recordingDurationMs))}`,
    );

    const hallucinationResult = detectHallucination({
      rawText: result.rawText,
      recordingDurationMs,
      peakEnergyLevel,
      rmsEnergyLevel,
      noSpeechProbability: result.noSpeechProbability,
    });

    writeInfoLog(
      `voiceFlowStore: hallucination detection result: isHallucination=${String(hallucinationResult.isHallucination)}, reason=${String(hallucinationResult.reason)}`,
    );

    if (hallucinationResult.isHallucination) {
      const failedRecord = buildTranscriptionRecord({
        id: transcriptionId,
        rawText: result.rawText,
        processedText: null,
        recordingDurationMs,
        transcriptionDurationMs: result.transcriptionDurationMs,
        enhancementDurationMs: null,
        wasEnhanced: false,
        audioFilePath,
        status: "failed",
      });
      void saveTranscriptionRecord(failedRecord);

      if (audioFilePath) {
        setState({
          _lastFailedTranscriptionId: transcriptionId,
          _lastFailedAudioFilePath: audioFilePath,
          _lastFailedRecordingDurationMs: recordingDurationMs,
          _lastFailedPeakEnergyLevel: peakEnergyLevel,
          _lastFailedRmsEnergyLevel: rmsEnergyLevel,
        });
      }

      failRecordingFlow(
        t("voiceFlow.noSpeechDetected"),
        `voiceFlowStore: hallucination intercepted (reason=${String(hallucinationResult.reason)})`,
      );
      return;
    }

    // ── Enhancement ──
    if (
      !settingsStore.isEnhancementThresholdEnabled ||
      result.rawText.length >= settingsStore.enhancementThresholdCharCount
    ) {
      transitionTo("enhancing", t("voiceFlow.enhancing"));
      const enhancementStartTime = performance.now();

      try {
        const enhancementTermList = await vocabularyStore.getTopTermListByWeight(50);
        const enhanceOptions = {
          systemPrompt: settingsStore.getAiPrompt(),
          vocabularyTermList: enhancementTermList.length > 0 ? enhancementTermList : undefined,
          modelId: settingsStore.selectedLlmModelId,
          signal: abortController?.signal,
        };

        let enhanceResult = await retryWithBackoff(
          () => enhanceText(result.rawText, apiKey, enhanceOptions),
          { maxRetries: 1, signal: abortController?.signal ?? undefined },
        );
        if (getState()._isAborted) return;

        // Enhancement anomaly detection (with retry)
        let retryCount = 0;
        while (
          retryCount < MAX_ENHANCEMENT_RETRY_COUNT &&
          detectEnhancementAnomaly({
            rawText: result.rawText,
            enhancedText: enhanceResult.text,
          }).isAnomaly
        ) {
          retryCount++;
          writeInfoLog(
            `voiceFlowStore: enhancement anomaly detected (attempt ${String(retryCount)}/${String(MAX_ENHANCEMENT_RETRY_COUNT)}), retrying`,
          );
          enhanceResult = await retryWithBackoff(
            () => enhanceText(result.rawText, apiKey, enhanceOptions),
            { maxRetries: 1, signal: abortController?.signal ?? undefined },
          );
          if (getState()._isAborted) return;
        }

        const finalAnomaly = detectEnhancementAnomaly({
          rawText: result.rawText,
          enhancedText: enhanceResult.text,
        });
        if (finalAnomaly.isAnomaly) {
          writeErrorLog(
            `voiceFlowStore: enhancement failed after ${String(MAX_ENHANCEMENT_RETRY_COUNT)} retries (reason=${String(finalAnomaly.reason)}), falling back to raw text`,
          );
          enhanceResult = { ...enhanceResult, text: result.rawText };
        }

        const enhancementDurationMs = performance.now() - enhancementStartTime;

        const record = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: result.rawText,
          processedText: enhanceResult.text,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs,
          wasEnhanced: !finalAnomaly.isAnomaly,
          audioFilePath,
          status: "success",
        });

        writeInfoLog(`AI enhanced: "${enhanceResult.text}"`);

        await completePasteFlow({
          text: enhanceResult.text,
          successMessage: getSuccessMessage(true),
          record,
          chatUsage: enhanceResult.usage,
        });

        writeInfoLog(
          `voiceFlowStore: pasted enhanced text, recordingDurationMs=${String(Math.round(recordingDurationMs))}, transcriptionDurationMs=${String(Math.round(result.transcriptionDurationMs))}, enhancementDurationMs=${String(Math.round(enhancementDurationMs))}${retryCount > 0 ? `, enhancementRetryCount=${String(retryCount)}` : ""}`,
        );
      } catch (enhanceError) {
        if (getState()._isAborted) return;
        const fallbackEnhancementDurationMs = performance.now() - enhancementStartTime;
        const enhanceErrorDetail = getEnhancementErrorMessage(enhanceError);
        writeErrorLog(`voiceFlowStore: AI enhancement failed: ${enhanceErrorDetail}`);
        captureError(enhanceError, {
          source: "voice-flow",
          step: "enhancement",
        });

        const fallbackRecord = buildTranscriptionRecord({
          id: transcriptionId,
          rawText: result.rawText,
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs: fallbackEnhancementDurationMs,
          wasEnhanced: false,
          audioFilePath,
          status: "success",
        });

        await completePasteFlow({
          text: result.rawText,
          successMessage: getSuccessMessage(false),
          record: fallbackRecord,
          chatUsage: null,
        });
      }
    } else {
      // Skip enhancement (below threshold)
      const record = buildTranscriptionRecord({
        id: transcriptionId,
        rawText: result.rawText,
        processedText: null,
        recordingDurationMs,
        transcriptionDurationMs: result.transcriptionDurationMs,
        enhancementDurationMs: null,
        wasEnhanced: false,
        audioFilePath,
        status: "success",
      });

      await completePasteFlow({
        text: result.rawText,
        successMessage: getSuccessMessage(false),
        record,
        chatUsage: null,
      });

      writeInfoLog(
        `voiceFlowStore: pasted text (skipped enhancement, length=${String(result.rawText.length)}), recordingDurationMs=${String(Math.round(recordingDurationMs))}, transcriptionDurationMs=${String(Math.round(result.transcriptionDurationMs))}`,
      );
    }
  } catch (error) {
    if (getState()._isAborted) return;
    // AC2: API error -- still write failed record if we have audioFilePath
    if (audioFilePath) {
      const failedRecord = buildTranscriptionRecord({
        id: transcriptionId,
        rawText: "",
        processedText: null,
        recordingDurationMs,
        transcriptionDurationMs: 0,
        enhancementDurationMs: null,
        wasEnhanced: false,
        audioFilePath,
        status: "failed",
      });
      void saveTranscriptionRecord(failedRecord);

      setState({
        _lastFailedTranscriptionId: transcriptionId,
        _lastFailedAudioFilePath: audioFilePath,
        _lastFailedRecordingDurationMs: recordingDurationMs,
        _lastFailedPeakEnergyLevel: peakEnergyLevel,
      });
    }

    const userMessage = getTranscriptionErrorMessage(error);
    const technicalMessage = extractErrorMessage(error);
    failRecordingFlow(
      userMessage,
      `voiceFlowStore: stop recording failed: ${technicalMessage}`,
      error,
    );
  }
}
