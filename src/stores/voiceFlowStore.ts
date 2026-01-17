import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import type { HudStatus } from "@/types";
import type {
  HotkeyEventPayload,
  HotkeyErrorPayload,
  QualityMonitorResultPayload,
  VoiceFlowStateChangedPayload,
} from "@/types/events";
import { extractErrorMessage, getHotkeyErrorMessage } from "@/lib/errorUtils";
import { captureError } from "@/lib/sentry";
import {
  HOTKEY_PRESSED,
  HOTKEY_RELEASED,
  HOTKEY_TOGGLED,
  HOTKEY_ERROR,
  QUALITY_MONITOR_RESULT,
  VOICE_FLOW_STATE_CHANGED,
} from "@/hooks/useTauriEvent";

import {
  clearAutoHideTimer,
  clearCollapseHideTimer,
  clearDelayedMuteTimer,
  setAutoHideTimer,
  setCollapseHideTimer,
  startElapsedTimer,
  stopElapsedTimer,
  cleanupAllTimers,
  setStoreRef,
} from "./voiceFlow/timers";
import {
  showHud,
  hideHud,
  enableCursorEvents,
  stopMonitorPolling,
  resetHudWindowState,
} from "./voiceFlow/hudWindow";
import { handleStartRecording, handleStopRecording } from "./voiceFlow/transcriptionPipeline";
import { handleRetryTranscriptionFlow } from "./voiceFlow/retryFlow";
import { registerStoreAccessors } from "./voiceFlow/storeAccessors";
import { useSettingsStore } from "./settingsStore";
import { useHistoryStore } from "./historyStore";
import { useVocabularyStore } from "./vocabularyStore";

// ── Constants ──

const SUCCESS_DISPLAY_DURATION_MS = 1000;
const ERROR_DISPLAY_DURATION_MS = 3000;
const ERROR_WITH_RETRY_DISPLAY_DURATION_MS = 6000;
const CANCELLED_DISPLAY_DURATION_MS = 1000;

// ── ESCAPE_PRESSED event (defined here since not all windows use it) ──

const ESCAPE_PRESSED = "escape:pressed" as const;

// ── Store type ──

export interface VoiceFlowState {
  status: HudStatus;
  message: string;
  isRecording: boolean;
  recordingElapsedSeconds: number;
  lastWasModified: boolean | null;
  lastFailedTranscriptionId: string | null;
  lastFailedAudioFilePath: string | null;
  lastFailedRecordingDurationMs: number;
  lastFailedPeakEnergyLevel: number;
  lastFailedRmsEnergyLevel: number;
  isAborted: boolean;
  isRetryAttempt: boolean;

  // Derived
  canRetry: () => boolean;

  // Actions
  initialize: () => Promise<void>;
  cleanup: () => void;
  transitionTo: (nextStatus: HudStatus, nextMessage?: string) => void;
  handleRetryTranscription: () => Promise<void>;
}

// ── Module-level state ──

let unlistenFunctions: UnlistenFn[] = [];
let abortController: AbortController | null = null;

// ── Helpers ──

function writeInfoLog(logMessage: string): void {
  void invoke("debug_log", { level: "info", message: logMessage });
}

function writeErrorLog(logMessage: string): void {
  void invoke("debug_log", { level: "error", message: logMessage });
}

export function playSoundIfEnabled(command: string): void {
  const settings = useSettingsStore.getState();
  if (settings.isSoundEffectsEnabled) {
    void invoke(command).catch(() => {});
  }
}

export function getAbortController(): AbortController | null {
  return abortController;
}

export function setAbortController(controller: AbortController | null): void {
  abortController = controller;
}

// ── Store ──

export const useVoiceFlowStore = create<VoiceFlowState>()((set, get) => ({
  status: "idle",
  message: "",
  isRecording: false,
  recordingElapsedSeconds: 0,
  lastWasModified: null,
  lastFailedTranscriptionId: null,
  lastFailedAudioFilePath: null,
  lastFailedRecordingDurationMs: 0,
  lastFailedPeakEnergyLevel: 0,
  lastFailedRmsEnergyLevel: 0,
  isAborted: false,
  isRetryAttempt: false,

  canRetry: () => {
    const state = get();
    return (
      state.status === "error" &&
      state.lastFailedAudioFilePath !== null &&
      !state.isRetryAttempt
    );
  },

  transitionTo: (nextStatus: HudStatus, nextMessage = "") => {
    clearAutoHideTimer();
    clearCollapseHideTimer();
    set({ status: nextStatus, message: nextMessage });

    // Emit state change event for cross-window sync
    const payload: VoiceFlowStateChangedPayload = {
      status: nextStatus,
      message: nextMessage,
    };
    void emit(VOICE_FLOW_STATE_CHANGED, payload);

    if (nextStatus === "idle") {
      stopMonitorPolling();
      setCollapseHideTimer(() => {
        hideHud().catch((err) => {
          writeErrorLog(`voiceFlowStore: hideHud failed: ${extractErrorMessage(err)}`);
          captureError(err, { source: "voice-flow", step: "hideHud" });
        });
      });
      return;
    }

    if (
      nextStatus === "recording" ||
      nextStatus === "transcribing" ||
      nextStatus === "enhancing"
    ) {
      showHud().catch((err) => {
        writeErrorLog(`voiceFlowStore: showHud failed: ${extractErrorMessage(err)}`);
        captureError(err, { source: "voice-flow", step: "showHud" });
      });
      return;
    }

    if (nextStatus === "success") {
      showHud().catch((err) => {
        writeErrorLog(`voiceFlowStore: showHud failed: ${extractErrorMessage(err)}`);
        captureError(err, { source: "voice-flow", step: "showHud" });
      });
      setAutoHideTimer(() => {
        get().transitionTo("idle");
      }, SUCCESS_DISPLAY_DURATION_MS);
      return;
    }

    if (nextStatus === "cancelled") {
      showHud().catch((err) => {
        writeErrorLog(`voiceFlowStore: showHud failed: ${extractErrorMessage(err)}`);
        captureError(err, { source: "voice-flow", step: "showHud" });
      });
      setAutoHideTimer(() => {
        get().transitionTo("idle");
      }, CANCELLED_DISPLAY_DURATION_MS);
      return;
    }

    if (nextStatus === "error") {
      showHud()
        .then(() => enableCursorEvents())
        .catch((err) => {
          writeErrorLog(
            `voiceFlowStore: showHud/enableCursor failed: ${extractErrorMessage(err)}`,
          );
          captureError(err, { source: "voice-flow", step: "showHud-enableCursor" });
        });
      const canRetryNow = get().canRetry();
      const errorDuration = canRetryNow
        ? ERROR_WITH_RETRY_DISPLAY_DURATION_MS
        : ERROR_DISPLAY_DURATION_MS;
      setAutoHideTimer(() => {
        get().transitionTo("idle");
      }, errorDuration);
    }
  },

  handleRetryTranscription: async () => {
    await handleRetryTranscriptionFlow();
  },

  initialize: async () => {
    // Register store accessors for sub-modules (breaks circular deps)
    registerStoreAccessors({
      settings: () => useSettingsStore.getState(),
      history: () => useHistoryStore.getState(),
      vocabulary: () => useVocabularyStore.getState(),
    });

    // Inject store ref into timers module
    setStoreRef(useVoiceFlowStore);

    // ── Hotkey listeners ──

    const unlistenPressed = await listen<HotkeyEventPayload>(
      HOTKEY_PRESSED,
      () => {
        const state = get();
        if (state.status !== "idle" && state.status !== "error") return;

        set({ isAborted: false, isRetryAttempt: false });
        abortController = new AbortController();

        void handleStartRecording();
      },
    );
    unlistenFunctions.push(unlistenPressed);

    const unlistenReleased = await listen<HotkeyEventPayload>(
      HOTKEY_RELEASED,
      () => {
        const state = get();
        if (!state.isRecording) return;

        void handleStopRecording();
      },
    );
    unlistenFunctions.push(unlistenReleased);

    const unlistenToggled = await listen<HotkeyEventPayload>(
      HOTKEY_TOGGLED,
      (event) => {
        const action = event.payload.action;
        const state = get();

        if (action === "start") {
          if (state.status !== "idle" && state.status !== "error") return;
          set({ isAborted: false, isRetryAttempt: false });
          abortController = new AbortController();
          void handleStartRecording();
        } else {
          if (!state.isRecording) return;
          void handleStopRecording();
        }
      },
    );
    unlistenFunctions.push(unlistenToggled);

    const unlistenError = await listen<HotkeyErrorPayload>(
      HOTKEY_ERROR,
      (event) => {
        const errorMessage = getHotkeyErrorMessage(
          event.payload.error,
          event.payload.message,
        );
        get().transitionTo("error", errorMessage);
        writeErrorLog(`voiceFlowStore: hotkey error: ${event.payload.message}`);
      },
    );
    unlistenFunctions.push(unlistenError);

    const unlistenQuality = await listen<QualityMonitorResultPayload>(
      QUALITY_MONITOR_RESULT,
      (event) => {
        set({ lastWasModified: event.payload.wasModified });
        writeInfoLog(
          `voiceFlowStore: quality monitor result: wasModified=${event.payload.wasModified}`,
        );
      },
    );
    unlistenFunctions.push(unlistenQuality);

    const unlistenEscape = await listen(ESCAPE_PRESSED, () => {
      const state = get();
      if (state.isRecording || state.status === "transcribing" || state.status === "enhancing") {
        set({ isAborted: true });
        abortController?.abort();

        if (state.isRecording) {
          // Stop recording and discard
          void invoke("stop_recording").catch(() => {});
          void invoke("restore_system_audio").catch(() => {});
          clearDelayedMuteTimer();
          stopElapsedTimer();
          set({ isRecording: false });
        }

        get().transitionTo("cancelled", "");
        writeInfoLog("voiceFlowStore: recording/transcription aborted by Escape");
      }
    });
    unlistenFunctions.push(unlistenEscape);
  },

  cleanup: () => {
    for (const unlisten of unlistenFunctions) {
      unlisten();
    }
    unlistenFunctions = [];
    cleanupAllTimers();
    resetHudWindowState();
    abortController = null;
  },
}));
