/**
 * Retry a failed transcription record from the History view.
 *
 * Unlike the HUD `handleRetryTranscription` flow (which pastes, runs quality
 * monitor, hallucination detection, etc.), this is a passive retry: it only
 * re-runs Whisper + optional LLM enhancement and updates the DB record. No
 * paste, no clipboard side-effects, no monitors.
 *
 * Used when the API key is fixed after a previous failure (expired token,
 * network outage, etc.) and the user wants to recover saved audio.
 */

import { invoke } from "@tauri-apps/api/core";
import { useHistoryStore } from "@/stores/historyStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useVocabularyStore } from "@/stores/vocabularyStore";
import { enhanceText } from "@/lib/enhancer";
import { getProviderConfig } from "@/lib/providerConfig";
import { extractErrorMessage, getTranscriptionErrorMessage } from "@/lib/errorUtils";
import { calculateWhisperCostCeiling, calculateChatCostCeiling } from "@/lib/apiPricing";
import { captureError } from "@/lib/sentry";
import type { TranscriptionResult } from "@/types/audio";
import type { ChatUsageData, TranscriptionRecord } from "@/types/transcription";

export type RetryFailedRecordErrorKind =
  | "noAudioFile"
  | "apiKeyMissing"
  | "emptyResult"
  | "transcriptionFailed";

export interface RetryFailedRecordResult {
  ok: boolean;
  error?: RetryFailedRecordErrorKind;
  errorMessage?: string;
}

export async function retryFailedRecord(
  record: TranscriptionRecord,
): Promise<RetryFailedRecordResult> {
  if (!record.audioFilePath) {
    return { ok: false, error: "noAudioFile" };
  }

  const settingsStore = useSettingsStore.getState();
  const historyStore = useHistoryStore.getState();
  const vocabularyStore = useVocabularyStore.getState();

  let apiKey = settingsStore.getApiKey();
  if (!apiKey) {
    await settingsStore.refreshApiKey();
    apiKey = useSettingsStore.getState().getApiKey();
  }
  if (!apiKey) {
    return { ok: false, error: "apiKeyMissing" };
  }

  const providerConfig = getProviderConfig(settingsStore.selectedProviderId);

  let result: TranscriptionResult;
  try {
    const whisperTermList = await vocabularyStore.getTopTermListByWeight(50);
    result = await invoke<TranscriptionResult>("retranscribe_from_file", {
      filePath: record.audioFilePath,
      apiUrl: providerConfig.transcriptionBaseUrl,
      apiKey,
      vocabularyTermList: whisperTermList.length > 0 ? whisperTermList : null,
      modelId: settingsStore.selectedWhisperModelId,
      language: settingsStore.getWhisperLanguageCode(),
    });
  } catch (err) {
    captureError(err, { source: "history-retry", step: "retranscribe" });
    return {
      ok: false,
      error: "transcriptionFailed",
      errorMessage: getTranscriptionErrorMessage(err),
    };
  }

  if (!result.rawText || !result.rawText.trim()) {
    return { ok: false, error: "emptyResult" };
  }

  let processedText: string | null = null;
  let enhancementDurationMs: number | null = null;
  let wasEnhanced = false;
  let chatUsage: ChatUsageData | null = null;

  const shouldEnhance =
    !settingsStore.isEnhancementThresholdEnabled ||
    result.rawText.length >= settingsStore.enhancementThresholdCharCount;

  if (shouldEnhance) {
    const startTime = performance.now();
    try {
      const enhancementTermList = await vocabularyStore.getTopTermListByWeight(50);
      const enhanceResult = await enhanceText(result.rawText, apiKey, {
        systemPrompt: settingsStore.getAiPrompt(),
        vocabularyTermList:
          enhancementTermList.length > 0 ? enhancementTermList : undefined,
        modelId: settingsStore.selectedLlmModelId,
        chatApiUrl: providerConfig.chatBaseUrl,
      });
      processedText = enhanceResult.text;
      wasEnhanced = true;
      chatUsage = enhanceResult.usage;
      enhancementDurationMs = performance.now() - startTime;
    } catch (enhanceErr) {
      captureError(enhanceErr, { source: "history-retry", step: "enhance" });
      enhancementDurationMs = performance.now() - startTime;
    }
  }

  const charCount = result.rawText.length;

  try {
    await historyStore.updateTranscriptionOnRetrySuccess({
      id: record.id,
      rawText: result.rawText,
      processedText,
      transcriptionDurationMs: Math.round(result.transcriptionDurationMs),
      enhancementDurationMs:
        enhancementDurationMs !== null ? Math.round(enhancementDurationMs) : null,
      wasEnhanced,
      charCount,
    });
  } catch (err) {
    return {
      ok: false,
      error: "transcriptionFailed",
      errorMessage: extractErrorMessage(err),
    };
  }

  void saveRetryApiUsage(record, chatUsage);

  return { ok: true };
}

async function saveRetryApiUsage(
  record: TranscriptionRecord,
  chatUsage: ChatUsageData | null,
): Promise<void> {
  const historyStore = useHistoryStore.getState();
  const settingsStore = useSettingsStore.getState();

  try {
    await historyStore.addApiUsage({
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
      audioDurationMs: record.recordingDurationMs,
      estimatedCostCeiling: calculateWhisperCostCeiling(
        record.recordingDurationMs,
        settingsStore.selectedWhisperModelId,
      ),
    });
  } catch (err) {
    captureError(err, { source: "history-retry", step: "api-usage-whisper" });
  }

  if (chatUsage) {
    try {
      await historyStore.addApiUsage({
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
    } catch (err) {
      captureError(err, { source: "history-retry", step: "api-usage-chat" });
    }
  }
}
