/**
 * VoiceFlow Zustand store -- the central state machine for recording/transcription.
 *
 * Manages HUD status transitions, event listener setup, and delegates
 * to sub-modules for specific concerns:
 *   - hudWindow: HUD window show/hide/repositioning
 *   - timers: all setTimeout/setInterval management
 *   - transcriptionPipeline: recording -> transcribe -> enhance -> paste
 *   - correctionDetection: post-paste correction monitoring
 *   - retryFlow: re-transcribe from saved audio
 *   - storeAccessors: lazy sibling store access (breaks circular deps)
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import { Window } from "@tauri-apps/api/window";
import i18n from "@/i18n";
import { extractErrorMessage, getHotkeyErrorMessage } from "@/lib/errorUtils";
import { captureError } from "@/lib/sentry";
import type { HudStatus } from "@/types";
import type {
  HotkeyEventPayload,
  HotkeyErrorPayload,
  QualityMonitorResultPayload,
  VoiceFlowStateChangedPayload,
} from "@/types/events";
import { HOTKEY_ERROR_CODES } from "@/types/events";
import {
  HOTKEY_PRESSED,
  HOTKEY_RELEASED,
  HOTKEY_TOGGLED,
  HOTKEY_ERROR,
  QUALITY_MONITOR_RESULT,
  VOICE_FLOW_STATE_CHANGED,
  ESCAPE_PRESSED,
} from "@/hooks/useTauriEvent";

// Sub-modules
import {
  showHud,
  hideHud,
  enableCursorEvents,
  stopMonitorPolling,
  resetHudWindowState,
} from "./voiceFlow/hudWindow";
import {
  clearAutoHideTimer,
  clearCollapseHideTimer,
  setAutoHideTimer,
  setCollapseHideTimer,
  cleanupAllTimers,
  stopElapsedTimer,
  clearDelayedMuteTimer,
  setStoreRef,
} from "./voiceFlow/timers";
import {
  stopCorrectionSnapshotPolling,
  cleanupCorrectionMonitorListener,
} from "./voiceFlow/correctionDetection";
import {
  handleStartRecording,
  handleStopRecording,
  restoreSystemAudio,
  getAbortController,
  setVoiceFlowActions,
} from "./voiceFlow/transcriptionPipeline";
import {
  handleRetryTranscription as retryTranscription,
  setRetryFlowActions,
} from "./voiceFlow/retryFlow";
import {
  registerStoreAccessors,
  getSettingsStore as getSettingsStoreFromAccessors,
  type SettingsStoreAccessor,
  type HistoryStoreAccessor,
  type VocabularyStoreAccessor,
} from "./voiceFlow/storeAccessors";

// ── Constants ──

const SUCCESS_DISPLAY_DURATION_MS = 1000;
const ERROR_DISPLAY_DURATION_MS = 3000;
const ERROR_WITH_RETRY_DISPLAY_DURATION_MS = 6000;
const CANCELLED_DISPLAY_DURATION_MS = 1000;

// ── Module-level state ──

const unlistenFunctions: UnlistenFn[] = [];

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

// ── Store interface ──

export interface VoiceFlowState {
  // Public state (consumed by React components)
  status: HudStatus;
  message: string;
  isRecording: boolean;
  recordingElapsedSeconds: number;
  canRetry: boolean;
  lastWasModified: boolean | null;

  // Internal state (used by sub-modules, prefixed with _ to indicate internal)
  /** @internal */ _isAborted: boolean;
  /** @internal */ _isRetryAttempt: boolean;
  /** @internal */ _lastFailedTranscriptionId: string | null;
  /** @internal */ _lastFailedAudioFilePath: string | null;
  /** @internal */ _lastFailedRecordingDurationMs: number;
  /** @internal */ _lastFailedPeakEnergyLevel: number;
  /** @internal */ _lastFailedRmsEnergyLevel: number;

  // Actions
  initialize: (stores: VoiceFlowInitStores) => Promise<void>;
  cleanup: () => void;
  handleRetryTranscription: () => Promise<void>;
}

/**
 * Sibling store getters passed to initialize() to avoid circular imports.
 * The caller (e.g. main.tsx or an init hook) imports all stores and passes them in.
 */
export interface VoiceFlowInitStores {
  getSettingsStore: () => SettingsStoreAccessor;
  getHistoryStore: () => HistoryStoreAccessor;
  getVocabularyStore: () => VocabularyStoreAccessor;
}

// ── Core state machine function ──

/**
 * Central state machine coordinator.
 * 1. Clears timers
 * 2. Sets status + message
 * 3. Emits VOICE_FLOW_STATE_CHANGED event
 * 4. Based on nextStatus: shows/hides HUD, sets auto-hide timers,
 *    enables/disables cursor events
 */
export function transitionTo(nextStatus: HudStatus, nextMessage = ""): void {
  clearAutoHideTimer();
  clearCollapseHideTimer();

  const state = useVoiceFlowStore.getState();
  const canRetryNext =
    nextStatus === "error" && state._lastFailedAudioFilePath !== null && !state._isRetryAttempt;

  useVoiceFlowStore.setState({
    status: nextStatus,
    message: nextMessage,
    canRetry: canRetryNext,
  });

  // Emit cross-window event
  const payload: VoiceFlowStateChangedPayload = {
    status: nextStatus,
    message: nextMessage,
  };
  void emit(VOICE_FLOW_STATE_CHANGED, payload);

  if (nextStatus === "idle") {
    stopMonitorPolling();
    setCollapseHideTimer(() => {
      hideHud().catch((err: unknown) => {
        writeErrorLog(`voiceFlowStore: hideHud failed: ${extractErrorMessage(err)}`);
        captureError(err, { source: "voice-flow", step: "hideHud" });
      });
    });
    return;
  }

  if (nextStatus === "recording" || nextStatus === "transcribing" || nextStatus === "enhancing") {
    showHud().catch((err: unknown) => {
      writeErrorLog(`voiceFlowStore: showHud failed: ${extractErrorMessage(err)}`);
      captureError(err, { source: "voice-flow", step: "showHud" });
    });
    return;
  }

  if (nextStatus === "success") {
    showHud().catch((err: unknown) => {
      writeErrorLog(`voiceFlowStore: showHud failed: ${extractErrorMessage(err)}`);
      captureError(err, { source: "voice-flow", step: "showHud" });
    });
    setAutoHideTimer(() => {
      transitionTo("idle");
    }, SUCCESS_DISPLAY_DURATION_MS);
    return;
  }

  if (nextStatus === "cancelled") {
    showHud().catch((err: unknown) => {
      writeErrorLog(`voiceFlowStore: showHud failed: ${extractErrorMessage(err)}`);
      captureError(err, { source: "voice-flow", step: "showHud" });
    });
    setAutoHideTimer(() => {
      transitionTo("idle");
    }, CANCELLED_DISPLAY_DURATION_MS);
    return;
  }

  if (nextStatus === "error") {
    showHud()
      .then(() => enableCursorEvents())
      .catch((err: unknown) => {
        writeErrorLog(`voiceFlowStore: showHud/enableCursor failed: ${extractErrorMessage(err)}`);
        captureError(err, {
          source: "voice-flow",
          step: "showHud-enableCursor",
        });
      });
    const errorDuration = canRetryNext
      ? ERROR_WITH_RETRY_DISPLAY_DURATION_MS
      : ERROR_DISPLAY_DURATION_MS;
    setAutoHideTimer(() => {
      transitionTo("idle");
    }, errorDuration);
  }
}

export function playSoundIfEnabled(slot: "start" | "stop" | "error" | "learned"): void {
  try {
    const settings = getSettingsStoreFromAccessors();
    if (!settings.isSoundEffectsEnabled) return;

    const soundName = settings.getSoundForSlot(slot);
    if (!soundName) return;

    void invoke("play_sound", { soundName }).catch((err) => {
      writeErrorLog(`Sound playback failed for ${slot}: ${String(err)}`);
    });
  } catch {
    // Settings store not yet registered -- skip sound
  }
}

export function failRecordingFlow(errorMessage: string, logMessage: string, error?: unknown): void {
  clearDelayedMuteTimer();
  void restoreSystemAudio();
  useVoiceFlowStore.setState({ isRecording: false });
  transitionTo("error", errorMessage);
  playSoundIfEnabled("error");
  writeErrorLog(logMessage);
  if (error) {
    captureError(error, { userMessage: errorMessage, source: "voice-flow" });
  }
}

// ── Escape abort handler ──

function handleEscapeAbort(): void {
  const state = useVoiceFlowStore.getState();
  const currentStatus = state.status;
  if (
    currentStatus === "idle" ||
    currentStatus === "success" ||
    currentStatus === "error" ||
    currentStatus === "cancelled"
  )
    return;

  writeInfoLog(`voiceFlowStore: ESC abort from ${currentStatus}`);
  useVoiceFlowStore.setState({ _isAborted: true, isRecording: false });
  getAbortController()?.abort();

  if (currentStatus === "recording") {
    void invoke("stop_recording").catch((err) => {
      writeErrorLog(`ESC abort: stop_recording failed: ${String(err)}`);
    });
    stopElapsedTimer();
  }

  // Full cleanup of in-progress resources
  clearDelayedMuteTimer();
  stopMonitorPolling();
  stopCorrectionSnapshotPolling();
  cleanupCorrectionMonitorListener();
  void restoreSystemAudio();

  // Reset toggle mode state
  void invoke("reset_hotkey_state").catch((err) => {
    writeErrorLog(`ESC abort: reset_hotkey_state failed: ${String(err)}`);
  });

  transitionTo("cancelled", t("voiceFlow.cancelled"));
}

// ── Zustand store ──

export const useVoiceFlowStore = create<VoiceFlowState>((set, get) => ({
  // Public state
  status: "idle" as HudStatus,
  message: "",
  isRecording: false,
  recordingElapsedSeconds: 0,
  canRetry: false,
  lastWasModified: null,

  // Internal state
  _isAborted: false,
  _isRetryAttempt: false,
  _lastFailedTranscriptionId: null,
  _lastFailedAudioFilePath: null,
  _lastFailedRecordingDurationMs: 0,
  _lastFailedPeakEnergyLevel: 0,
  _lastFailedRmsEnergyLevel: 0,

  // ── Actions ──

  initialize: async (stores: VoiceFlowInitStores) => {
    writeInfoLog("voiceFlowStore: initializing");

    // Inject store ref into timers (breaks circular dep)
    setStoreRef({
      getState: () => ({
        recordingElapsedSeconds: get().recordingElapsedSeconds,
      }),
      setState: (partial) => set(partial),
    });

    // Register sibling store accessors
    registerStoreAccessors({
      settings: stores.getSettingsStore,
      history: stores.getHistoryStore,
      vocabulary: stores.getVocabularyStore,
    });

    // Inject action references into sub-modules
    const sharedActions = {
      getState: () => get(),
      setState: (partial: Record<string, unknown>) => set(partial as Partial<VoiceFlowState>),
      transitionTo,
      playSoundIfEnabled,
      failRecordingFlow,
    };
    setVoiceFlowActions(sharedActions);
    setRetryFlowActions(sharedActions);

    // Load settings
    try {
      await stores.getSettingsStore().loadSettings();
    } catch (err) {
      writeErrorLog(`voiceFlowStore: loadSettings failed: ${extractErrorMessage(err)}`);
    }

    // Set up Tauri event listeners
    const listeners = await Promise.all([
      listen(ESCAPE_PRESSED, () => {
        handleEscapeAbort();
      }),
      listen(HOTKEY_PRESSED, () => {
        void handleStartRecording();
      }),
      listen(HOTKEY_RELEASED, () => {
        void handleStopRecording();
      }),
      listen<HotkeyEventPayload>(HOTKEY_TOGGLED, (event) => {
        if (event.payload.action === "start") {
          void handleStartRecording();
          return;
        }
        if (event.payload.action === "stop") {
          void handleStopRecording();
        }
      }),
      listen<QualityMonitorResultPayload>(QUALITY_MONITOR_RESULT, (event) => {
        set({ lastWasModified: event.payload.wasModified });
        writeInfoLog(
          `voiceFlowStore: quality monitor result: wasModified=${String(event.payload.wasModified)}`,
        );
      }),
      listen<HotkeyErrorPayload>(HOTKEY_ERROR, (event) => {
        const hudMessage = getHotkeyErrorMessage(event.payload.error);
        if (event.payload.error === HOTKEY_ERROR_CODES.ACCESSIBILITY_PERMISSION) {
          void (async () => {
            try {
              const mainWindow = await Window.getByLabel("main-window");
              if (!mainWindow) return;
              await mainWindow.show();
              await mainWindow.setFocus();
            } catch (err) {
              writeErrorLog(
                `voiceFlowStore: show/focus main-window failed: ${extractErrorMessage(err)}`,
              );
            }
          })();
        }
        transitionTo("error", hudMessage);
        playSoundIfEnabled("error");
        writeErrorLog(`voiceFlowStore: hotkey error: ${event.payload.message}`);
      }),
    ]);
    unlistenFunctions.push(...listeners);
  },

  cleanup: () => {
    cleanupAllTimers();
    stopMonitorPolling();
    stopCorrectionSnapshotPolling();
    cleanupCorrectionMonitorListener();
    resetHudWindowState();

    for (const unlisten of unlistenFunctions) {
      unlisten();
    }
    unlistenFunctions.length = 0;
  },

  handleRetryTranscription: async () => {
    await retryTranscription();
  },
}));
