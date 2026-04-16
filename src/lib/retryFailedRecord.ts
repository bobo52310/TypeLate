/**
 * Re-transcribe a record from the History view.
 *
 * Unlike the HUD `handleRetryTranscription` flow (which pastes, runs quality
 * monitor, hallucination detection, etc.), this is a passive retry: it only
 * re-runs Whisper + optional LLM enhancement and updates the DB record. No
 * paste, no clipboard side-effects, no monitors.
 *
 * Works for any record with a saved audio file — both failed records
 * (recovering after API fix) and successful records (re-transcribing with
 * updated model/vocabulary/prompt settings).
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

export type RetranscribeErrorKind =
  | "noAudioFile"
  | "apiKeyMissing"
  | "emptyResult"
  | "transcriptionFailed";

/** @deprecated Use {@link RetranscribeErrorKind} */
export type RetryFailedRecordErrorKind = RetranscribeErrorKind;

export interface RetranscribeResult {
  ok: boolean;
  error?: RetranscribeErrorKind;
  errorMessage?: string;
}

/** @deprecated Use {@link RetranscribeResult} */
export type RetryFailedRecordResult = RetranscribeResult;

/**
 * Re-transcribe any record that has a saved audio file.
 * Works for both failed and successful records.
 */
export async function retranscribeRecord(
  record: TranscriptionRecord,
): Promise<RetranscribeResult> {
  if (!record.audioFilePath) {
    return { ok: false, error: "noAudioFile" };
  }

  const settingsStore = useSettingsStore.getState();
  const historyStore = useHistoryStore.getState();
  const vocabularyStore = useVocabularyStore.getState();

  let transcriptionApiKey = settingsStore.getTranscriptionApiKey();
  if (!transcriptionApiKey) {
    await settingsStore.refreshApiKey(settingsStore.selectedTranscriptionProviderId);
    transcriptionApiKey = useSettingsStore.getState().getTranscriptionApiKey();
  }
  if (!transcriptionApiKey) {
    return { ok: false, error: "apiKeyMissing" };
  }

  const transcriptionProviderConfig = getProviderConfig(
    settingsStore.selectedTranscriptionProviderId,
  );

  let result: TranscriptionResult;
  try {
    const whisperTermList = await vocabularyStore.getTopTermListByWeight(50);
    result = await invoke<TranscriptionResult>("retranscribe_from_file", {
      filePath: record.audioFilePath,
      apiUrl: transcriptionProviderConfig.transcriptionBaseUrl,
      apiKey: transcriptionApiKey,
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
      let llmApiKey = settingsStore.getLlmApiKey();
      if (!llmApiKey) {
        await settingsStore.refreshApiKey(settingsStore.selectedLlmProviderId);
        llmApiKey = useSettingsStore.getState().getLlmApiKey();
      }
      if (!llmApiKey) {
        throw new Error("LLM API key not configured");
      }

      const llmProviderConfig = getProviderConfig(settingsStore.selectedLlmProviderId);
      const enhancementTermList = await vocabularyStore.getTopTermListByWeight(50);
      const enhanceResult = await enhanceText(result.rawText, llmApiKey, {
        systemPrompt: settingsStore.getAiPrompt(),
        vocabularyTermList:
          enhancementTermList.length > 0 ? enhancementTermList : undefined,
        modelId: settingsStore.selectedLlmModelId,
        chatApiUrl: llmProviderConfig.chatBaseUrl,
        extraHeaders: llmProviderConfig.extraHeaders,
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
      whisperModelId: settingsStore.selectedWhisperModelId,
      llmModelId: wasEnhanced ? settingsStore.selectedLlmModelId : null,
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

/** @deprecated Use {@link retranscribeRecord} */
export const retryFailedRecord = retranscribeRecord;

export interface BulkRetryProgress {
  current: number;
  total: number;
  record: TranscriptionRecord;
}

export interface BulkRetrySummary {
  succeeded: number;
  failed: number;
  stoppedOnApiKeyMissing: boolean;
}

export async function retryAllFailedRecords(
  records: TranscriptionRecord[],
  onProgress?: (progress: BulkRetryProgress) => void,
): Promise<BulkRetrySummary> {
  const summary: BulkRetrySummary = {
    succeeded: 0,
    failed: 0,
    stoppedOnApiKeyMissing: false,
  };

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    onProgress?.({ current: i + 1, total: records.length, record });

    const result = await retranscribeRecord(record);
    if (result.ok) {
      summary.succeeded += 1;
      continue;
    }

    summary.failed += 1;
    if (result.error === "apiKeyMissing") {
      summary.stoppedOnApiKeyMissing = true;
      break;
    }
  }

  return summary;
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
