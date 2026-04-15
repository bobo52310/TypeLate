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
import { getCircuitBreaker } from "@/lib/circuitBreaker";
import { enhanceText } from "@/lib/enhancer";
import { getProviderConfig } from "@/lib/providerConfig";
import { detectHallucination, detectEnhancementAnomaly } from "@/lib/hallucinationDetector";
import { calculateWhisperCostCeiling, calculateChatCostCeiling } from "@/lib/apiPricing";
import { retryWithBackoff } from "@/lib/retryWithBackoff";
import { getPromptForModeAndLocale } from "@/i18n/prompts";
import type { StopRecordingResult, TranscriptionResult, FrontmostAppInfo } from "@/types/audio";
import type {
  TranscriptionRecord,
  ChatUsageData,
  QueuedRecording,
} from "@/types/transcription";
import type { TranscriptionCompletedPayload } from "@/types/events";
import type { HudStatus } from "@/types";
import type { PromptMode } from "@/types/settings";
import { emitToWindow, TRANSCRIPTION_COMPLETED } from "@/hooks/useTauriEvent";
import { getSettingsStore, getHistoryStore, getVocabularyStore } from "./storeAccessors";
import { useRateLimitStore } from "@/stores/rateLimitStore";
import { enqueuePaste } from "@/lib/pasteQueue";
import {
  setQueueAbortController,
  deleteQueueAbortController,
} from "./queueAbortControllers";
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

// ── Per-recording pipeline context ──

/**
 * Holds all per-recording state for a single pipeline invocation. When the
 * user chains recordings, each one has its own `PipelineContext`. The `seat`
 * field says whether this pipeline currently owns the notch ("primary") or
 * has been demoted to a queue card ("queue") because a newer recording took
 * over.
 */
interface PipelineContext {
  id: string;
  abortController: AbortController;
  bundleId: string | null;
  surroundingText: string | null;
  wavData: number[];
  recordingDurationMs: number;
  peakEnergyLevel: number;
  rmsEnergyLevel: number;
  audioFilePath: string | null;
  seat: "primary" | "queue";
  startedAt: number;
}

/**
 * The pipeline currently displayed in the notch. Becomes null when the primary
 * pipeline completes (success or error) or is demoted by a newer recording.
 */
let currentPrimaryContext: PipelineContext | null = null;

/**
 * Context-aware capture for the mic currently being opened. Gets moved onto
 * the PipelineContext when the recording stops. Only one recording's mic can
 * be open at a time, so a single module-level slot is enough.
 */
let pendingBundleId: string | null = null;
let pendingSurroundingText: string | null = null;

/**
 * The retry-from-file flow (retryFlow.ts) registers its AbortController here
 * so ESC can cancel a retry in progress. Retry and a primary pipeline are
 * never live at the same time (retry only starts from the error state).
 */
let retryAbortController: AbortController | null = null;

export function registerRetryAbortController(controller: AbortController | null): void {
  retryAbortController = controller;
}

export function getPrimaryAbortController(): AbortController | null {
  return currentPrimaryContext?.abortController ?? retryAbortController;
}

// ── Store actions injection (avoids circular import with voiceFlowStore) ──

interface VoiceFlowStoreActions {
  enqueueRecording: (rec: QueuedRecording) => void;
  updateQueueItem: (id: string, patch: Partial<QueuedRecording>) => void;
  dismissQueueItem: (id: string) => void;
}

interface VoiceFlowActions {
  getState: () => {
    status: HudStatus;
    message: string;
    isRecording: boolean;
    _isAborted: boolean;
    lastWasModified: boolean | null;
    _lastSuccessRawText: string | null;
    _lastSuccessTranscriptionId: string | null;
    queue: QueuedRecording[];
  } & VoiceFlowStoreActions;
  setState: (partial: Record<string, unknown>) => void;
  transitionTo: (status: HudStatus, message?: string) => void;
  playSoundIfEnabled: (slot: "start" | "stop" | "error" | "learned") => void;
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

// ── Pipeline routing helpers ──

/**
 * Route a status transition to the right place based on the pipeline's seat.
 * Primary pipelines update the notch (and global state); demoted pipelines
 * only update their own queue card.
 */
function pipelineTransitionTo(
  ctx: PipelineContext,
  status: "transcribing" | "enhancing" | "success" | "error",
  message: string,
): void {
  if (ctx.seat === "primary") {
    actions().transitionTo(status as HudStatus, message);
  } else {
    actions().getState().updateQueueItem(ctx.id, { status, message });
  }
}

/**
 * Report a failure from the pipeline. Primary pipelines go through the
 * existing `failRecordingFlow` (which updates global state and plays the
 * error sound). Demoted pipelines only mark their queue card as errored.
 */
function pipelineFailRecording(
  ctx: PipelineContext,
  errorMessage: string,
  logMessage: string,
  error?: unknown,
  canRetry = false,
): void {
  if (ctx.seat === "primary") {
    actions().failRecordingFlow(errorMessage, logMessage, error);
    currentPrimaryContext = null;
  } else {
    actions().getState().updateQueueItem(ctx.id, {
      status: "error",
      message: errorMessage,
      errorMessage,
      canRetry,
    });
    actions().playSoundIfEnabled("error");
    if (error) {
      captureError(error, { userMessage: errorMessage, source: "voice-flow" });
    }
    writeErrorLog(logMessage);
  }
  deleteQueueAbortController(ctx.id);
}

/**
 * When a newer recording starts, demote the currently-primary pipeline
 * (if any and if still in-flight) into the queue. Its pipeline continues
 * running but further state updates go to its queue card instead of the
 * notch. The notch is left free for the new recording.
 */
function demoteCurrentPrimaryIfActive(): void {
  const prev = currentPrimaryContext;
  if (!prev) return;
  if (prev.abortController.signal.aborted) {
    currentPrimaryContext = null;
    return;
  }

  // At this point the previous pipeline is still in flight. Snapshot its
  // current state into a queue card. If the notch hasn't yet transitioned
  // to a pipeline state (can happen when the user presses the next hotkey
  // during the tiny window between `stop_recording` returning and the
  // pipeline's first `transitionTo("transcribing")`), fall back to
  // "transcribing" — the pipeline is about to be there anyway.
  const gState = actions().getState();
  const mapped = mapHudStatusToQueueStatus(gState.status);
  const status = mapped ?? "transcribing";
  const message =
    mapped && gState.message ? gState.message : t("voiceFlow.transcribing");

  const snapshot: QueuedRecording = {
    id: prev.id,
    status,
    message,
    rawText: null,
    processedText: null,
    errorMessage: null,
    audioFilePath: prev.audioFilePath,
    recordingDurationMs: prev.recordingDurationMs,
    transcriptionDurationMs: 0,
    enhancementDurationMs: null,
    peakEnergyLevel: prev.peakEnergyLevel,
    rmsEnergyLevel: prev.rmsEnergyLevel,
    startedAt: prev.startedAt,
    canRetry: false,
  };
  prev.seat = "queue";
  gState.enqueueRecording(snapshot);
  currentPrimaryContext = null;
  writeInfoLog(
    `voiceFlowStore: demoted primary pipeline ${prev.id} to queue (status=${status}, fromNotch=${gState.status})`,
  );
}

function mapHudStatusToQueueStatus(
  status: HudStatus,
): "transcribing" | "enhancing" | "success" | "error" | null {
  if (status === "transcribing") return "transcribing";
  if (status === "enhancing") return "enhancing";
  if (status === "success") return "success";
  if (status === "error") return "error";
  return null;
}

function getSuccessMessage(enhanced: boolean): string {
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
    promptMode: settingsStore.promptMode,
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

async function saveTranscriptionRecord(
  record: TranscriptionRecord,
  options?: { skipEmit?: boolean },
): Promise<void> {
  const historyStore = getHistoryStore();
  try {
    await historyStore.addTranscription(record, options);
  } catch (err) {
    writeErrorLog(`voiceFlowStore: addTranscription failed: ${extractErrorMessage(err)}`);
    captureError(err, { source: "voice-flow", step: "save-transcription" });
  }
}

export async function saveApiUsageRecordList(
  record: TranscriptionRecord,
  chatUsage: ChatUsageData | null,
): Promise<void> {
  const historyStore = getHistoryStore();
  const settingsStore = getSettingsStore();
  const roundedAudioMs = record.recordingDurationMs;

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
      audioDurationMs: roundedAudioMs,
      estimatedCostCeiling: calculateWhisperCostCeiling(
        roundedAudioMs,
        settingsStore.selectedWhisperModelId,
      ),
    });
  } catch (err) {
    writeErrorLog(
      `voiceFlowStore: addApiUsage(whisper) failed: ${extractErrorMessage(err)}`,
    );
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
      writeErrorLog(
        `voiceFlowStore: addApiUsage(chat) failed: ${extractErrorMessage(err)}`,
      );
    }
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

async function completePasteFlow(
  ctx: PipelineContext,
  params: {
    text: string;
    successMessage: string;
    record: TranscriptionRecord;
    chatUsage: ChatUsageData | null;
    skipRecordSaving?: boolean;
  },
): Promise<void> {
  try {
    const settingsStore = getSettingsStore();
    const preserveClipboard = !settingsStore.isCopyResultToClipboard;
    // Serialize paste invocations so chained pipelines don't race Cmd/Ctrl+V.
    await enqueuePaste({ text: params.text, preserveClipboard });

    // Show text preview in success message (truncate to ~30 chars)
    const preview =
      params.text.trim().length > 30 ? params.text.trim().slice(0, 30) + "…" : params.text.trim();
    const successWithPreview = preview
      ? `${params.successMessage} · ${preview}`
      : params.successMessage;

    if (ctx.seat === "primary") {
      // Primary seat: notch goes to "success", action bar state is set so the
      // user can copy original / re-enhance.
      actions().setState({
        lastSuccessWasEnhanced: params.record.wasEnhanced,
        lastSuccessPromptMode: settingsStore.promptMode,
        _lastSuccessRawText: params.record.rawText,
        _lastSuccessTranscriptionId: params.record.id,
      });
      actions().transitionTo("success", successWithPreview);
      startQualityMonitorAfterPaste();
      // Primary pipeline is done — vacate the slot for the next recording.
      currentPrimaryContext = null;
    } else {
      // Demoted queue card: show success, then auto-dismiss.
      // Stage 1 MVP testing: auto-dismiss disabled so users can confirm
      // multiple cards accumulate. Click the X to dismiss manually.
      // Stage 3 will restore a reasonable auto-dismiss (~1–2s fade).
      actions().getState().updateQueueItem(ctx.id, {
        status: "success",
        message: successWithPreview,
        rawText: params.record.rawText,
        processedText: params.record.processedText,
      });
    }

    // Save records then emit event — api_usage must be committed before
    // the dashboard refreshes so daily quota reads up-to-date data.
    if (!params.skipRecordSaving) {
      void (async () => {
        await saveTranscriptionRecord(params.record, { skipEmit: true });
        await saveApiUsageRecordList(params.record, params.chatUsage);
        try {
          const payload: TranscriptionCompletedPayload = {
            id: params.record.id,
            rawText: params.record.rawText,
            processedText: params.record.processedText,
            recordingDurationMs: params.record.recordingDurationMs,
            transcriptionDurationMs: params.record.transcriptionDurationMs,
            enhancementDurationMs: params.record.enhancementDurationMs,
            charCount: params.record.charCount,
            wasEnhanced: params.record.wasEnhanced,
          };
          await emitToWindow("main-window", TRANSCRIPTION_COMPLETED, payload);
        } catch (emitErr) {
          writeErrorLog("voiceFlowStore: emitToWindow failed (records saved)");
          captureError(emitErr, { source: "voice-flow", step: "complete-paste-emit" });
        }
      })();
    }

    // Weight update (fire-and-forget)
    const finalText = params.record.processedText ?? params.record.rawText;
    updateVocabularyWeightsAfterPaste(finalText);

    // Correction detection (fire-and-forget) — only for the primary pipeline.
    // Demoted queue pastes happen in the background; the user isn't watching
    // the notch for them so correction-monitor isn't meaningful.
    if (ctx.seat === "primary") {
      writeInfoLog(`[correction] starting flow (text=${String(params.text.length)} chars)`);
      startCorrectionDetectionFlow(
        params.text,
        params.record.id,
        "",
        () => actions().getState().status,
        () => actions().getState().lastWasModified,
      );
    }

    deleteQueueAbortController(ctx.id);
  } catch (pasteError) {
    if (ctx.seat === "primary") {
      actions().failRecordingFlow(
        t("voiceFlow.pasteFailed"),
        `voiceFlowStore: paste_text failed: ${extractErrorMessage(pasteError)}`,
        pasteError,
      );
      currentPrimaryContext = null;
    } else {
      actions().getState().updateQueueItem(ctx.id, {
        status: "error",
        message: t("voiceFlow.pasteFailed"),
        errorMessage: t("voiceFlow.pasteFailed"),
        canRetry: true,
      });
      actions().playSoundIfEnabled("error");
      captureError(pasteError, { source: "voice-flow", step: "queue-paste" });
      writeErrorLog(
        `voiceFlowStore: queue paste_text failed: ${extractErrorMessage(pasteError)}`,
      );
    }
    deleteQueueAbortController(ctx.id);
  }
}

// ── Start recording ──

export async function handleStartRecording(): Promise<void> {
  const { getState, setState, transitionTo, playSoundIfEnabled, failRecordingFlow } = actions();
  if (getState().isRecording) return;

  // If a previous recording's pipeline is still running, demote it to the
  // queue so the notch is free for this new recording.
  demoteCurrentPrimaryIfActive();

  setState({
    isRecording: true,
    lastWasModified: null,
    _isAborted: false,
    // Clear post-success action bar state
    lastSuccessWasEnhanced: false,
    lastSuccessPromptMode: null,
    _lastSuccessRawText: null,
    _lastSuccessTranscriptionId: null,
    _lastFailedTranscriptionId: null,
    _lastFailedAudioFilePath: null,
    _lastFailedRecordingDurationMs: 0,
    _lastFailedPeakEnergyLevel: 0,
    _lastFailedRmsEnergyLevel: 0,
    _isRetryAttempt: false,
  });

  try {
    // Capture frontmost app + surrounding text in parallel before HUD takes focus
    {
      const isContextAware = getSettingsStore().isContextAwareEnabled;
      const appInfoPromise = invoke<FrontmostAppInfo | null>("get_frontmost_app_info").catch(
        () => null,
      );
      // Surrounding text is captured in Rust at hotkey-press time (before HUD activation)
      // and cached there. We just retrieve the cached value here.
      const textFieldPromise = isContextAware
        ? invoke<string | null>("get_cached_surrounding_text").catch(() => null)
        : Promise.resolve(null);

      const [appInfo, surroundingText] = await Promise.all([appInfoPromise, textFieldPromise]);

      pendingBundleId = appInfo?.bundleId ?? null;
      pendingSurroundingText = surroundingText;
      setState({
        frontmostAppName: appInfo?.name ?? null,
        frontmostAppIconBase64: appInfo?.iconBase64 ?? null,
      });

      if (isContextAware) {
        writeInfoLog(
          `voiceFlowStore: context-aware capture — app=${appInfo?.name ?? "none"}, surroundingText=${surroundingText ? `"${surroundingText.slice(0, 40)}..."` : "null"}`,
        );
      }
    }

    playSoundIfEnabled("start");
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

// ── Stop recording (mic release only; pipeline runs in background) ──

export async function handleStopRecording(): Promise<void> {
  const { getState, setState, playSoundIfEnabled, failRecordingFlow } = actions();
  if (!getState().isRecording) return;
  if (getState()._isAborted) return;

  clearDelayedMuteTimer();
  clearRecordingTimeoutTimer();
  await restoreSystemAudio();
  playSoundIfEnabled("stop");
  stopElapsedTimer();

  let stopResult: StopRecordingResult;
  try {
    stopResult = await invoke<StopRecordingResult>("stop_recording");
  } catch (error) {
    setState({ isRecording: false });
    const userMessage = getTranscriptionErrorMessage(error);
    const technicalMessage = extractErrorMessage(error);
    failRecordingFlow(
      userMessage,
      `voiceFlowStore: stop recording failed: ${technicalMessage}`,
      error,
    );
    return;
  }

  // Mic is released — free the next recording immediately.
  setState({ isRecording: false });
  if (getState()._isAborted) return;

  const ctx: PipelineContext = {
    id: crypto.randomUUID(),
    abortController: new AbortController(),
    bundleId: pendingBundleId,
    surroundingText: pendingSurroundingText,
    wavData: stopResult.wavData,
    recordingDurationMs: stopResult.recordingDurationMs,
    peakEnergyLevel: stopResult.peakEnergyLevel,
    rmsEnergyLevel: stopResult.rmsEnergyLevel,
    audioFilePath: null,
    seat: "primary",
    startedAt: performance.now(),
  };
  pendingBundleId = null;
  pendingSurroundingText = null;

  setQueueAbortController(ctx.id, ctx.abortController);
  currentPrimaryContext = ctx;

  // Persist audio so retry-from-file works (fast, synchronous to caller).
  const retentionPolicy = getSettingsStore().recordingRetentionPolicy;
  if (retentionPolicy !== "none") {
    try {
      ctx.audioFilePath = await invoke<string>("save_recording_file", {
        id: ctx.id,
        wavData: ctx.wavData,
      });
      writeInfoLog(`voiceFlowStore: recording saved: ${ctx.audioFilePath}`);
    } catch (saveErr) {
      writeErrorLog(
        `voiceFlowStore: save_recording_file failed (non-blocking): ${extractErrorMessage(saveErr)}`,
      );
      captureError(saveErr, { source: "voice-flow", step: "save-recording-file" });
    }
  } else {
    writeInfoLog("voiceFlowStore: skipping recording save (retention=none)");
  }

  // Fire-and-forget: the pipeline runs independently so a new recording
  // can start immediately.
  void runTranscriptionFor(ctx);
}

// ── Transcription pipeline ──

async function runTranscriptionFor(ctx: PipelineContext): Promise<void> {
  const { setState } = actions();
  const transcriptionId = ctx.id;
  const recordingDurationMs = ctx.recordingDurationMs;
  const peakEnergyLevel = ctx.peakEnergyLevel;
  const rmsEnergyLevel = ctx.rmsEnergyLevel;

  // Route-aware local wrappers so the existing pipeline body can remain
  // mostly untouched. `transitionTo` writes either to the notch (primary seat)
  // or to this pipeline's queue card (demoted seat).
  const transitionTo = (
    status: "transcribing" | "enhancing" | "success" | "error",
    message: string,
  ): void => {
    pipelineTransitionTo(ctx, status, message);
  };

  const failRecordingFlow = (errorMessage: string, logMessage: string, error?: unknown): void => {
    if (ctx.seat === "primary" && ctx.audioFilePath) {
      // Preserve existing retry UI: global "_lastFailed*" fields drive the
      // notch's retry button. Only set these for the primary pipeline.
      setState({
        _lastFailedTranscriptionId: ctx.id,
        _lastFailedAudioFilePath: ctx.audioFilePath,
        _lastFailedRecordingDurationMs: ctx.recordingDurationMs,
        _lastFailedPeakEnergyLevel: ctx.peakEnergyLevel,
        _lastFailedRmsEnergyLevel: ctx.rmsEnergyLevel,
      });
    }
    pipelineFailRecording(ctx, errorMessage, logMessage, error, ctx.audioFilePath !== null);
  };

  // For the pipeline body below, we use `ctx.audioFilePath` indirectly; keep
  // a local alias so the existing references stay readable.
  const audioFilePath = ctx.audioFilePath;

  try {
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

    const settingsStore = getSettingsStore();

    // Circuit breaker: skip API call if recent failures indicate service is down
    const providerCircuitBreaker = getCircuitBreaker(
      settingsStore.selectedTranscriptionProviderId,
    );
    if (!providerCircuitBreaker.canExecute()) {
      const cooldownSec = Math.ceil(providerCircuitBreaker.getRemainingCooldownMs() / 1000);
      failRecordingFlow(
        t("errors.transcription.serviceUnavailable"),
        `voiceFlowStore: circuit breaker open (cooldown ${cooldownSec}s)`,
      );
      return;
    }

    transitionTo("transcribing", t("voiceFlow.transcribing"));
    let apiKey = settingsStore.getTranscriptionApiKey();

    if (!apiKey) {
      await settingsStore.refreshApiKey(settingsStore.selectedTranscriptionProviderId);
      apiKey = settingsStore.getTranscriptionApiKey();
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
    const providerConfig = getProviderConfig(settingsStore.selectedTranscriptionProviderId);

    let result: TranscriptionResult;
    try {
      result = await retryWithBackoff(
        () =>
          invoke<TranscriptionResult>("transcribe_audio", {
            wavData: ctx.wavData,
            apiUrl: providerConfig.transcriptionBaseUrl,
            apiKey,
            vocabularyTermList: hasVocabulary ? whisperTermList : null,
            modelId: settingsStore.selectedWhisperModelId,
            language: settingsStore.getWhisperLanguageCode(),
          }),
        { maxRetries: 2, signal: ctx.abortController.signal },
      );
      providerCircuitBreaker.recordSuccess();
    } catch (apiErr) {
      providerCircuitBreaker.recordFailure();
      throw apiErr;
    }
    if (ctx.abortController.signal.aborted) return;

    // Store whisper rate limit from API response headers
    if (result.rateLimit) {
      useRateLimitStore.getState().updateWhisper(result.rateLimit);
    }

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

      failRecordingFlow(
        t("voiceFlow.noSpeechDetected"),
        `voiceFlowStore: hallucination intercepted (reason=${String(hallucinationResult.reason)})`,
      );
      return;
    }

    // ── Enhancement ──
    if (
      settingsStore.promptMode !== "none" &&
      (!settingsStore.isEnhancementThresholdEnabled ||
        result.rawText.length >= settingsStore.enhancementThresholdCharCount)
    ) {
      transitionTo("enhancing", t("voiceFlow.enhancing"));
      const enhancementStartTime = performance.now();

      try {
        const llmProviderConfig = getProviderConfig(settingsStore.selectedLlmProviderId);
        let llmApiKey = settingsStore.getLlmApiKey();
        if (!llmApiKey) {
          await settingsStore.refreshApiKey(settingsStore.selectedLlmProviderId);
          llmApiKey = settingsStore.getLlmApiKey();
        }
        if (!llmApiKey) {
          throw new Error(t("errors.apiKeyMissing"));
        }

        const enhancementTermList = await vocabularyStore.getTopTermListByWeight(50);
        const enhanceOptions = {
          systemPrompt: settingsStore.isContextAwareEnabled
            ? settingsStore.getContextAwarePrompt(ctx.bundleId)
            : settingsStore.getAiPrompt(),
          vocabularyTermList: enhancementTermList.length > 0 ? enhancementTermList : undefined,
          surroundingText: ctx.surroundingText ?? undefined,
          modelId: settingsStore.selectedLlmModelId,
          chatApiUrl: llmProviderConfig.chatBaseUrl,
          extraHeaders: llmProviderConfig.extraHeaders,
          signal: ctx.abortController.signal,
        };

        let enhanceResult = await retryWithBackoff(
          () => enhanceText(result.rawText, llmApiKey, enhanceOptions),
          { maxRetries: 1, signal: ctx.abortController.signal },
        );
        if (ctx.abortController.signal.aborted) return;

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
            () => enhanceText(result.rawText, llmApiKey, enhanceOptions),
            { maxRetries: 1, signal: ctx.abortController.signal },
          );
          if (ctx.abortController.signal.aborted) return;
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

        // Store chat rate limit from API response headers
        if (enhanceResult.rateLimit) {
          useRateLimitStore.getState().updateChat(enhanceResult.rateLimit);
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

        await completePasteFlow(ctx, {
          text: enhanceResult.text,
          successMessage: getSuccessMessage(true),
          record,
          chatUsage: enhanceResult.usage,
        });

        writeInfoLog(
          `voiceFlowStore: pasted enhanced text, recordingDurationMs=${String(Math.round(recordingDurationMs))}, transcriptionDurationMs=${String(Math.round(result.transcriptionDurationMs))}, enhancementDurationMs=${String(Math.round(enhancementDurationMs))}${retryCount > 0 ? `, enhancementRetryCount=${String(retryCount)}` : ""}`,
        );
      } catch (enhanceError) {
        if (ctx.abortController.signal.aborted) return;
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

        await completePasteFlow(ctx, {
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

      await completePasteFlow(ctx, {
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
    if (ctx.abortController.signal.aborted) return;
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

// ── Re-enhance with a different mode ──

export async function handleReEnhanceWithMode(targetMode: PromptMode): Promise<void> {
  const { getState, setState, transitionTo, failRecordingFlow } = actions();
  const rawText = getState()._lastSuccessRawText;
  const transcriptionId = getState()._lastSuccessTranscriptionId;
  if (!rawText || !transcriptionId) return;

  transitionTo("enhancing", t("voiceFlow.enhancing"));

  try {
    const settingsStore = getSettingsStore();
    let apiKey = settingsStore.getLlmApiKey();

    if (!apiKey) {
      await settingsStore.refreshApiKey(settingsStore.selectedLlmProviderId);
      apiKey = settingsStore.getLlmApiKey();
    }

    if (!apiKey) {
      failRecordingFlow(
        t("errors.apiKeyMissing"),
        "voiceFlowStore: missing API key during re-enhancement",
      );
      return;
    }

    const providerConfig = getProviderConfig(settingsStore.selectedLlmProviderId);
    const vocabularyStore = getVocabularyStore();
    const enhancementTermList = await vocabularyStore.getTopTermListByWeight(50);

    // Build prompt for target mode
    let systemPrompt: string;
    if (targetMode === "none") {
      systemPrompt = "";
    } else if (targetMode === "custom") {
      systemPrompt = settingsStore.aiPrompt || settingsStore.getAiPrompt();
    } else {
      const locale = settingsStore.getEffectivePromptLocale();
      systemPrompt = getPromptForModeAndLocale(targetMode, locale);
    }

    const enhanceResult = await enhanceText(rawText, apiKey, {
      systemPrompt,
      vocabularyTermList: enhancementTermList.length > 0 ? enhancementTermList : undefined,
      modelId: settingsStore.selectedLlmModelId,
      chatApiUrl: providerConfig.chatBaseUrl,
      extraHeaders: providerConfig.extraHeaders,
    });

    // Paste new result
    const preserveClipboard = !settingsStore.isCopyResultToClipboard;
    await invoke("paste_text", { text: enhanceResult.text, preserveClipboard });

    // Update state for action bar (allow further re-enhancement)
    setState({
      lastSuccessWasEnhanced: true,
      lastSuccessPromptMode: targetMode,
      _lastSuccessRawText: rawText,
      _lastSuccessTranscriptionId: transcriptionId,
    });

    const preview =
      enhanceResult.text.trim().length > 30
        ? enhanceResult.text.trim().slice(0, 30) + "…"
        : enhanceResult.text.trim();
    transitionTo("success", `${t("voiceFlow.pasteSuccess")} · ${preview}`);

    writeInfoLog(`voiceFlowStore: re-enhanced with mode=${targetMode}`);

    // Update DB record (fire-and-forget)
    void (async () => {
      try {
        const historyStore = getHistoryStore();
        await historyStore.updateTranscriptionOnRetrySuccess(
          {
            id: transcriptionId,
            rawText,
            processedText: enhanceResult.text,
            transcriptionDurationMs: 0,
            enhancementDurationMs: 0,
            wasEnhanced: true,
            charCount: rawText.length,
          },
          { skipEmit: true },
        );
        const payload: TranscriptionCompletedPayload = {
          id: transcriptionId,
          rawText,
          processedText: enhanceResult.text,
          recordingDurationMs: 0,
          transcriptionDurationMs: 0,
          enhancementDurationMs: 0,
          charCount: rawText.length,
          wasEnhanced: true,
        };
        await emitToWindow("main-window", TRANSCRIPTION_COMPLETED, payload);
      } catch (dbErr) {
        writeErrorLog(
          `voiceFlowStore: re-enhance DB update failed: ${extractErrorMessage(dbErr)}`,
        );
      }
    })();
  } catch (error) {
    const errorDetail = getEnhancementErrorMessage(error);
    writeErrorLog(`voiceFlowStore: re-enhancement failed: ${errorDetail}`);
    captureError(error, { source: "voice-flow", step: "re-enhance" });
    failRecordingFlow(
      t("errors.enhancementTimeout"),
      `voiceFlowStore: re-enhancement failed: ${errorDetail}`,
      error,
    );
  }
}
