/**
 * Correction detection flow -- detects when users manually correct transcription output.
 *
 * After pasting text, this monitors the focused text field for user edits.
 * When corrections are detected, it uses AI to analyze what was changed
 * and automatically adds specialized terms to the vocabulary dictionary.
 *
 * Flow:
 * 1. Start correction monitor (Rust keyboard watcher)
 * 2. Poll focused text field snapshots via AX API
 * 3. On correction-monitor:result, compare pasted vs current text
 * 4. If text was modified, send to AI for vocabulary analysis
 * 5. Add new terms to vocabulary, increment weights for existing ones
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import { analyzeCorrections } from "@/lib/vocabularyAnalyzer";
import { extractErrorMessage } from "@/lib/errorUtils";
import { captureError } from "@/lib/sentry";
import { calculateChatCostCeiling } from "@/lib/apiPricing";
import { CORRECTION_MONITOR_RESULT, VOCABULARY_LEARNED } from "@/hooks/useTauriEvent";
import type { CorrectionMonitorResultPayload, VocabularyLearnedPayload } from "@/types/events";
import { getSettingsStore, getHistoryStore, getVocabularyStore } from "./storeAccessors";
import { getAppWindow, hideHud } from "./hudWindow";
import { clearLearnedHideTimer, setLearnedHideTimer } from "./timers";

// ── Module-level state ──

const SNAPSHOT_POLL_INTERVAL_MS = 500;
let correctionSnapshotTimer: ReturnType<typeof setInterval> | null = null;
let correctionMonitorUnlisten: UnlistenFn | null = null;

// ── Helpers ──

function writeInfoLog(logMessage: string): void {
  void invoke("debug_log", { level: "info", message: logMessage });
}

function writeErrorLog(logMessage: string): void {
  void invoke("debug_log", { level: "error", message: logMessage });
}

// ── Cleanup ──

export function stopCorrectionSnapshotPolling(): void {
  if (correctionSnapshotTimer) {
    clearInterval(correctionSnapshotTimer);
    correctionSnapshotTimer = null;
  }
}

export function cleanupCorrectionMonitorListener(): void {
  if (correctionMonitorUnlisten) {
    correctionMonitorUnlisten();
    correctionMonitorUnlisten = null;
  }
}

// ── Main flow ──

/**
 * @param getVoiceFlowStatus - callback to read current VoiceFlow status
 *        (avoids circular import to the main store)
 */
export function startCorrectionDetectionFlow(
  pastedText: string,
  transcriptionId: string,
  apiKey: string,
  getVoiceFlowStatus: () => string,
): void {
  void (async () => {
    try {
      const settingsStore = getSettingsStore();
      if (!settingsStore.isSmartDictionaryEnabled) return;

      // Clear previous listener to avoid accumulation
      cleanupCorrectionMonitorListener();

      // Start correction monitor
      await invoke("start_correction_monitor");

      // Phase 2 snapshot polling
      let latestSnapshot: string | null = null;
      stopCorrectionSnapshotPolling();

      let consecutiveSnapshotErrors = 0;
      correctionSnapshotTimer = setInterval(() => {
        void (async () => {
          try {
            const text = await invoke<string | null>("read_focused_text_field");
            if (text) {
              latestSnapshot = text;
              consecutiveSnapshotErrors = 0;
            }
          } catch (err) {
            consecutiveSnapshotErrors++;
            if (consecutiveSnapshotErrors === 5) {
              writeErrorLog(
                `correctionDetection: read_focused_text_field failed 5 times consecutively: ${String(err)}`,
              );
            }
          }
        })();
      }, SNAPSHOT_POLL_INTERVAL_MS);

      // One-time listen for correction-monitor:result
      correctionMonitorUnlisten = await listen<CorrectionMonitorResultPayload>(
        CORRECTION_MONITOR_RESULT,
        (event) => {
          cleanupCorrectionMonitorListener();
          stopCorrectionSnapshotPolling();

          void (async () => {
            try {
              const result = event.payload;

              if (!result.anyKeyPressed) {
                writeInfoLog("[correction] no key pressed -- skipping analysis");
                return;
              }

              writeInfoLog(
                `[correction] keys detected (enter=${String(result.enterPressed)}) -- reading field text`,
              );

              let fieldText: string | null = null;

              if (result.enterPressed) {
                try {
                  const freshText = await invoke<string | null>("read_focused_text_field");
                  if (freshText && freshText.trim()) {
                    fieldText = freshText;
                  } else {
                    fieldText = latestSnapshot;
                  }
                } catch {
                  fieldText = latestSnapshot;
                }
              } else {
                try {
                  fieldText = await invoke<string | null>("read_focused_text_field");
                } catch {
                  fieldText = latestSnapshot;
                }
              }

              if (!fieldText || !fieldText.trim()) {
                writeInfoLog("[correction] field text is null or empty -- skipping analysis");
                return;
              }
              if (fieldText.includes(pastedText)) {
                writeInfoLog("[correction] text unchanged -- skipping analysis");
                return;
              }

              // Similarity check
              const overlapCharCount = [...pastedText].filter((ch) =>
                fieldText.includes(ch),
              ).length;
              const overlapRatio = overlapCharCount / pastedText.length;
              if (overlapRatio < 0.3) {
                writeInfoLog(
                  `[correction] field text unrelated to original (overlap=${String(Math.round(overlapRatio * 100))}%) -- skipping analysis`,
                );
                return;
              }

              writeInfoLog(
                `[correction] text modified (overlap=${String(Math.round(overlapRatio * 100))}%) -- sending to AI analysis\n  original:  ${pastedText.slice(0, 80)}\n  corrected: ${fieldText.slice(0, 80)}`,
              );

              const analysisResult = await analyzeCorrections(pastedText, fieldText, apiKey, {
                modelId: settingsStore.selectedVocabularyAnalysisModelId,
              });

              writeInfoLog(`[correction] AI raw: ${analysisResult.rawResponse}`);
              writeInfoLog(
                `[correction] AI result: ${JSON.stringify(analysisResult.suggestedTermList)} (tokens: ${String(analysisResult.usage?.totalTokens ?? "??")})`,
              );

              if (analysisResult.suggestedTermList.length === 0) return;

              const vocabularyStore = getVocabularyStore();
              const newTermList: string[] = [];

              for (const term of analysisResult.suggestedTermList) {
                if (vocabularyStore.isDuplicateTerm(term)) {
                  const existingEntry = vocabularyStore.termList.find(
                    (e) => e.term.trim().toLowerCase() === term.trim().toLowerCase(),
                  );
                  if (existingEntry) {
                    void vocabularyStore
                      .batchIncrementWeights([existingEntry.id])
                      .catch((err: unknown) =>
                        writeErrorLog(
                          `voiceFlowStore: batchIncrementWeights failed: ${extractErrorMessage(err)}`,
                        ),
                      );
                  }
                } else {
                  await vocabularyStore.addAiSuggestedTerm(term);
                  newTermList.push(term);
                }
              }

              // Record API usage
              if (analysisResult.usage) {
                const historyStore = getHistoryStore();
                void historyStore
                  .addApiUsage({
                    id: crypto.randomUUID(),
                    transcriptionId,
                    apiType: "vocabulary_analysis",
                    model: settingsStore.selectedVocabularyAnalysisModelId,
                    promptTokens: analysisResult.usage.promptTokens,
                    completionTokens: analysisResult.usage.completionTokens,
                    totalTokens: analysisResult.usage.totalTokens,
                    promptTimeMs: analysisResult.usage.promptTimeMs,
                    completionTimeMs: analysisResult.usage.completionTimeMs,
                    totalTimeMs: analysisResult.usage.totalTimeMs,
                    audioDurationMs: null,
                    estimatedCostCeiling: calculateChatCostCeiling(
                      analysisResult.usage.totalTokens,
                      settingsStore.selectedLlmModelId,
                    ),
                  })
                  .catch((err: unknown) =>
                    writeErrorLog(
                      `voiceFlowStore: addApiUsage(vocabulary_analysis) failed: ${extractErrorMessage(err)}`,
                    ),
                  );
              }

              // Notify HUD of newly learned terms
              if (newTermList.length > 0) {
                writeInfoLog(
                  `voiceFlowStore: emitting VOCABULARY_LEARNED: ${newTermList.join(", ")}`,
                );
                try {
                  await emit(VOCABULARY_LEARNED, {
                    termList: newTermList,
                  } satisfies VocabularyLearnedPayload);
                  writeInfoLog("voiceFlowStore: VOCABULARY_LEARNED emitted successfully");

                  // HUD window was hidden after idle -- re-show for notification
                  clearLearnedHideTimer();
                  const appWindow = getAppWindow();
                  await appWindow.show();
                  await appWindow.setIgnoreCursorEvents(true);
                  setLearnedHideTimer(() => {
                    if (getVoiceFlowStatus() === "idle") {
                      hideHud().catch((err: unknown) =>
                        writeErrorLog(
                          `voiceFlowStore: learned hideHud failed: ${extractErrorMessage(err)}`,
                        ),
                      );
                    }
                  });
                } catch (emitErr) {
                  writeErrorLog(
                    `voiceFlowStore: VOCABULARY_LEARNED emit failed: ${extractErrorMessage(emitErr)}`,
                  );
                }
              }
            } catch (err) {
              writeErrorLog(
                `voiceFlowStore: correction analysis failed: ${extractErrorMessage(err)}`,
              );
              captureError(err, {
                source: "voice-flow",
                step: "correction-analysis",
              });
            }
          })();
        },
      );
    } catch (err) {
      stopCorrectionSnapshotPolling();
      cleanupCorrectionMonitorListener();
      writeErrorLog(`voiceFlowStore: correction detection failed: ${extractErrorMessage(err)}`);
      captureError(err, {
        source: "voice-flow",
        step: "correction-detection",
      });
    }
  })();
}
