import { useCallback, useEffect, useRef } from "react";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useVoiceFlowStore } from "@/stores/voiceFlowStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useVocabularyStore } from "@/stores/vocabularyStore";
import { useHistoryStore } from "@/stores/historyStore";
import { connectToDatabase } from "@/lib/database";
import { initSentryForHud } from "@/lib/sentry";
import { SETTINGS_UPDATED, VOCABULARY_CHANGED } from "@/hooks/useTauriEvent";
import { logInfo, logError } from "@/lib/logger";
import { NotchHud } from "@/components/NotchHud";
import "@/i18n";

export function HudApp() {
  const status = useVoiceFlowStore((s) => s.status);
  const message = useVoiceFlowStore((s) => s.message);
  const recordingElapsedSeconds = useVoiceFlowStore((s) => s.recordingElapsedSeconds);
  const canRetry = useVoiceFlowStore((s) => s.canRetry);
  const handleRetryTranscription = useVoiceFlowStore((s) => s.handleRetryTranscription);
  const frontmostAppName = useVoiceFlowStore((s) => s.frontmostAppName);
  const frontmostAppIconBase64 = useVoiceFlowStore((s) => s.frontmostAppIconBase64);

  const initializedRef = useRef(false);

  const handleRetry = useCallback(() => {
    void handleRetryTranscription();
  }, [handleRetryTranscription]);

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
      ]).then(([unlistenSettings, unlistenVocabulary]) => {
        unlistenFns.push(unlistenSettings, unlistenVocabulary);
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
      />
    </div>
  );
}
