/**
 * Correction detection flow — clipboard-based vocabulary capture.
 *
 * After pasting text, monitors for user corrections (backspace/delete).
 * When corrections are detected, shows a HUD prompt asking the user
 * to copy the corrected term. Monitors clipboard for changes and
 * automatically adds captured terms to the vocabulary dictionary.
 *
 * Flow:
 * 1. Start correction monitor (Rust keyboard watcher)
 * 2. Wait for quality-monitor wasModified=true + user done editing
 * 3. Show HUD correction prompt
 * 4. Poll clipboard for changes (15 seconds)
 * 5. On clipboard change → add term to vocabulary
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import { extractErrorMessage } from "@/lib/errorUtils";
import { captureError } from "@/lib/sentry";
import {
  CORRECTION_MONITOR_RESULT,
  CORRECTION_PROMPT,
  VOCABULARY_LEARNED,
} from "@/hooks/useTauriEvent";
import type { CorrectionMonitorResultPayload, VocabularyLearnedPayload } from "@/types/events";
import { getSettingsStore, getVocabularyStore } from "./storeAccessors";
import { getAppWindow, hideHud } from "./hudWindow";
import { clearLearnedHideTimer, setLearnedHideTimer } from "./timers";

// ── Module-level state ──

const CLIPBOARD_POLL_INTERVAL_MS = 500;
const CLIPBOARD_POLL_DURATION_MS = 15000;
let clipboardPollTimer: ReturnType<typeof setInterval> | null = null;
let correctionMonitorUnlisten: UnlistenFn | null = null;

// ── Helpers ──

function writeInfoLog(logMessage: string): void {
  void invoke("debug_log", { level: "info", message: logMessage });
}

function writeErrorLog(logMessage: string): void {
  void invoke("debug_log", { level: "error", message: logMessage });
}

// ── Cleanup ──

export function stopClipboardPolling(): void {
  if (clipboardPollTimer) {
    clearInterval(clipboardPollTimer);
    clipboardPollTimer = null;
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
 * @param getWasModified - callback to read quality monitor's wasModified flag
 */
export function startCorrectionDetectionFlow(
  pastedText: string,
  _transcriptionId: string,
  _apiKey: string,
  getVoiceFlowStatus: () => string,
  getWasModified: () => boolean | null,
): void {
  void (async () => {
    try {
      const settingsStore = getSettingsStore();
      if (!settingsStore.isSmartDictionaryEnabled) {
        writeInfoLog("[correction] skipped: Smart Dictionary disabled");
        return;
      }

      // Clear previous listener to avoid accumulation
      cleanupCorrectionMonitorListener();
      stopClipboardPolling();

      // Start correction monitor (Rust keyboard watcher)
      await invoke("start_correction_monitor");

      // Listen for correction-monitor:result (user done editing)
      correctionMonitorUnlisten = await listen<CorrectionMonitorResultPayload>(
        CORRECTION_MONITOR_RESULT,
        (event) => {
          cleanupCorrectionMonitorListener();

          void (async () => {
            try {
              const result = event.payload;

              if (!result.anyKeyPressed) {
                writeInfoLog("[correction] no key pressed -- skipping");
                return;
              }

              // Check if user actually corrected (backspace/delete detected)
              const wasModified = getWasModified();
              if (!wasModified) {
                writeInfoLog(
                  `[correction] keys pressed but no backspace/delete (wasModified=${String(wasModified)}) -- skipping`,
                );
                return;
              }

              writeInfoLog("[correction] user corrected text -- starting clipboard capture");

              // Read current clipboard as baseline
              let clipboardBaseline: string | null = null;
              try {
                clipboardBaseline = await invoke<string | null>("read_clipboard");
              } catch {
                // ignore — baseline stays null
              }
              writeInfoLog(
                `[correction] clipboard baseline: ${clipboardBaseline ? `${String(clipboardBaseline.length)} chars` : "null"}`,
              );

              // Show HUD correction prompt
              await emit(CORRECTION_PROMPT, {});
              const appWindow = getAppWindow();
              await appWindow.show();
              await appWindow.setIgnoreCursorEvents(true);

              // Poll clipboard for changes
              const pollStart = Date.now();
              clipboardPollTimer = setInterval(() => {
                void (async () => {
                  // Timeout check
                  if (Date.now() - pollStart >= CLIPBOARD_POLL_DURATION_MS) {
                    writeInfoLog("[correction] clipboard poll timeout -- dismissing");
                    stopClipboardPolling();
                    if (getVoiceFlowStatus() === "idle") {
                      hideHud().catch((err: unknown) =>
                        writeErrorLog(
                          `correctionDetection: hideHud failed: ${extractErrorMessage(err)}`,
                        ),
                      );
                    }
                    return;
                  }

                  try {
                    const currentClipboard = await invoke<string | null>("read_clipboard");
                    if (!currentClipboard || !currentClipboard.trim()) return;

                    // Check if clipboard changed from baseline
                    if (currentClipboard === clipboardBaseline) return;

                    // Check it's not just the pasted text being copied back
                    const trimmed = currentClipboard.trim();
                    if (trimmed === pastedText.trim()) {
                      writeInfoLog("[correction] clipboard same as pasted text -- ignoring");
                      return;
                    }

                    // Clipboard changed! Capture as vocabulary term
                    writeInfoLog(`[correction] clipboard captured: "${trimmed}"`);
                    stopClipboardPolling();

                    // Add to vocabulary
                    const vocabularyStore = getVocabularyStore();
                    const newTermList: string[] = [];

                    if (vocabularyStore.isDuplicateTerm(trimmed)) {
                      const existingEntry = vocabularyStore.termList.find(
                        (e) => e.term.trim().toLowerCase() === trimmed.toLowerCase(),
                      );
                      if (existingEntry) {
                        await vocabularyStore.batchIncrementWeights([existingEntry.id]);
                        writeInfoLog(`[correction] incremented weight for existing term: "${trimmed}"`);
                      }
                    } else {
                      await vocabularyStore.addAiSuggestedTerm(trimmed);
                      newTermList.push(trimmed);
                      writeInfoLog(`[correction] added new term: "${trimmed}"`);
                    }

                    // Show learned notification
                    if (newTermList.length > 0) {
                      try {
                        await emit(VOCABULARY_LEARNED, {
                          termList: newTermList,
                        } satisfies VocabularyLearnedPayload);
                        clearLearnedHideTimer();
                        setLearnedHideTimer(() => {
                          if (getVoiceFlowStatus() === "idle") {
                            hideHud().catch((err: unknown) =>
                              writeErrorLog(
                                `correctionDetection: learned hideHud failed: ${extractErrorMessage(err)}`,
                              ),
                            );
                          }
                        });
                      } catch (emitErr) {
                        writeErrorLog(
                          `correctionDetection: VOCABULARY_LEARNED emit failed: ${extractErrorMessage(emitErr)}`,
                        );
                      }
                    } else {
                      // Existing term — just dismiss after brief delay
                      setTimeout(() => {
                        if (getVoiceFlowStatus() === "idle") {
                          hideHud().catch((err: unknown) =>
                            writeErrorLog(
                              `correctionDetection: hideHud failed: ${extractErrorMessage(err)}`,
                            ),
                          );
                        }
                      }, 1500);
                    }
                  } catch (err) {
                    writeErrorLog(
                      `correctionDetection: clipboard read failed: ${extractErrorMessage(err)}`,
                    );
                  }
                })();
              }, CLIPBOARD_POLL_INTERVAL_MS);
            } catch (err) {
              writeErrorLog(
                `correctionDetection: correction flow failed: ${extractErrorMessage(err)}`,
              );
              captureError(err, {
                source: "voice-flow",
                step: "correction-clipboard",
              });
            }
          })();
        },
      );
    } catch (err) {
      stopClipboardPolling();
      cleanupCorrectionMonitorListener();
      writeErrorLog(`correctionDetection: start failed: ${extractErrorMessage(err)}`);
      captureError(err, {
        source: "voice-flow",
        step: "correction-detection",
      });
    }
  })();
}
