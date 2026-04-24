import { useCallback, useEffect, useRef } from "react";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useVoiceFlowStore } from "@/stores/voiceFlowStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useVocabularyStore } from "@/stores/vocabularyStore";
import { useHistoryStore } from "@/stores/historyStore";
import { connectToDatabase } from "@/lib/database";
import { initSentryForHud } from "@/lib/sentry";
import { SETTINGS_UPDATED, VOCABULARY_CHANGED, TRAY_CYCLE_PROMPT_MODE } from "@/hooks/useTauriEvent";
import { logInfo, logError } from "@/lib/logger";
import { NotchHud } from "@/components/NotchHud";
import { TranscriptionQueueList } from "@/components/TranscriptionQueueList";
import type { PromptMode } from "@/types/settings";
import "@/i18n";

export function HudApp() {
  const status = useVoiceFlowStore((s) => s.status);
  const message = useVoiceFlowStore((s) => s.message);
  const queueLength = useVoiceFlowStore((s) => s.queue.length);
  const recordingElapsedSeconds = useVoiceFlowStore((s) => s.recordingElapsedSeconds);
  const canRetry = useVoiceFlowStore((s) => s.canRetry);
  const handleRetryTranscription = useVoiceFlowStore((s) => s.handleRetryTranscription);
  const frontmostAppName = useVoiceFlowStore((s) => s.frontmostAppName);
  const frontmostAppIconBase64 = useVoiceFlowStore((s) => s.frontmostAppIconBase64);
  const lastSuccessWasEnhanced = useVoiceFlowStore((s) => s.lastSuccessWasEnhanced);
  const lastSuccessPromptMode = useVoiceFlowStore((s) => s.lastSuccessPromptMode);
  const handleCopyOriginal = useVoiceFlowStore((s) => s.handleCopyOriginal);
  const handleReEnhance = useVoiceFlowStore((s) => s.handleReEnhance);
  const pauseAutoHide = useVoiceFlowStore((s) => s.pauseAutoHide);
  const resumeAutoHide = useVoiceFlowStore((s) => s.resumeAutoHide);

  const initializedRef = useRef(false);

  const handleRetry = useCallback(() => {
    void handleRetryTranscription();
  }, [handleRetryTranscription]);

  const onCopyOriginal = useCallback(() => {
    void handleCopyOriginal();
  }, [handleCopyOriginal]);

  const onReEnhance = useCallback(
    (mode: PromptMode) => {
      void handleReEnhance(mode);
    },
    [handleReEnhance],
  );

  const onPauseAutoHide = useCallback(() => {
    pauseAutoHide();
  }, [pauseAutoHide]);

  const onResumeAutoHide = useCallback(() => {
    resumeAutoHide();
  }, [resumeAutoHide]);

  // The HUD window is fixed at 400x520 (transparent below the notch, so empty
  // space is invisible). Just toggle cursor-events so queue cards can receive
  // clicks while click-through behaviour is preserved when no cards are visible.
  useEffect(() => {
    void getCurrentWindow().setIgnoreCursorEvents(queueLength === 0);
  }, [queueLength]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    initSentryForHud();

    const unlistenFns: UnlistenFn[] = [];

    void (async () => {
      logInfo("HudApp", "Mounted, initializing voice flow...");

      // Phase 1: Run DB, settings, and event listeners in parallel
      const dbPromise = connectToDatabase().catch((err) => {
        logError("HudApp", "Database init failed", err);
      });

      const settingsPromise = useSettingsStore.getState().loadSettings();

      const listenersPromise = Promise.all([
        listen(SETTINGS_UPDATED, () => {
          void useSettingsStore.getState().refreshCrossWindowSettings();
        }),
        listen(VOCABULARY_CHANGED, () => {
          void useVocabularyStore.getState().fetchTermList();
        }),
        listen(TRAY_CYCLE_PROMPT_MODE, () => {
          const current = useSettingsStore.getState().promptMode;
          const next = current === "minimal" ? "active" : "minimal";
          void useSettingsStore.getState().savePromptMode(next);
        }),
      ]).then(([unlistenSettings, unlistenVocabulary, unlistenCycleMode]) => {
        unlistenFns.push(unlistenSettings, unlistenVocabulary, unlistenCycleMode);
      });

      // Wait for ALL parallel tasks — DB is required for history/vocabulary
      await Promise.all([dbPromise, settingsPromise, listenersPromise]);

      // Phase 2: Initialize voice flow (needs settings + DB)
      const appWindow = getCurrentWindow();
      await appWindow.show();
      await useVoiceFlowStore.getState().initialize({
        getSettingsStore: () => useSettingsStore.getState(),
        getHistoryStore: () => useHistoryStore.getState(),
        getVocabularyStore: () => useVocabularyStore.getState(),
      });

      // Phase 3: Show dashboard, hide HUD
      try {
        const mainWindow = await Window.getByLabel("main-window");
        if (mainWindow) {
          await mainWindow.show();
          await mainWindow.setFocus();
        }
      } catch (err) {
        logError("HudApp", "Show main-window failed", err);
      }
      await appWindow.hide();

      // Phase 4: Vocabulary fetch + prune stale AI terms (non-blocking)
      void useVocabularyStore
        .getState()
        .fetchTermList()
        .then(() => useVocabularyStore.getState().pruneStaleTerms())
        .then((pruned) => {
          if (pruned > 0) logInfo("HudApp", `Pruned ${pruned} stale AI vocabulary terms`);
        })
        .catch((err) => {
          logError("HudApp", "Vocabulary fetch/prune failed", err);
        });
    })();

    return () => {
      for (const unlisten of unlistenFns) {
        unlisten();
      }
      useVoiceFlowStore.getState().cleanup();
    };
  }, []);

  return (
    <div className="h-screen w-screen bg-transparent">
      <NotchHud
        status={status}
        message={message}
        recordingElapsedSeconds={recordingElapsedSeconds}
        canRetry={canRetry}
        onRetry={handleRetry}
        appName={frontmostAppName}
        appIconBase64={frontmostAppIconBase64}
        lastSuccessWasEnhanced={lastSuccessWasEnhanced}
        lastSuccessPromptMode={lastSuccessPromptMode}
        onCopyOriginal={onCopyOriginal}
        onReEnhance={onReEnhance}
        onPauseAutoHide={onPauseAutoHide}
        onResumeAutoHide={onResumeAutoHide}
      />
      <TranscriptionQueueList />
    </div>
  );
}
