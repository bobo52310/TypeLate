import { useCallback, useEffect, useRef } from "react";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useVoiceFlowStore } from "@/stores/voiceFlowStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useVocabularyStore } from "@/stores/vocabularyStore";
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

      // Initialize DB (for vocabulary store)
      let isDatabaseReady = false;
      try {
        await connectToDatabase();
        isDatabaseReady = true;
      } catch (err) {
        logError("HudApp", "Database init failed", err);
      }

      // Load vocabulary (for transcriber + enhancer)
      if (isDatabaseReady) {
        try {
          await useVocabularyStore.getState().fetchTermList();
        } catch (err) {
          logError("HudApp", "Vocabulary fetch failed", err);
        }
      }

      // Listen for settings changes (sync from Dashboard → HUD)
      const unlistenSettings = await listen(SETTINGS_UPDATED, () => {
        void useSettingsStore.getState().refreshCrossWindowSettings();
      });
      unlistenFns.push(unlistenSettings);

      // Listen for vocabulary changes (sync from Dashboard → HUD)
      const unlistenVocabulary = await listen(VOCABULARY_CHANGED, () => {
        void useVocabularyStore.getState().fetchTermList();
      });
      unlistenFns.push(unlistenVocabulary);

      // Load settings
      await useSettingsStore.getState().loadSettings();

      // Show HUD briefly, then initialize voice flow
      const appWindow = getCurrentWindow();
      await appWindow.show();
      await useVoiceFlowStore.getState().initialize();

      // Show dashboard on startup, then hide HUD
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
        canRetry={canRetry()}
        onRetry={handleRetry}
      />
    </div>
  );
}
