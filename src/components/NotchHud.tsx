import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { logInfo } from "@/lib/logger";
import type { HudStatus } from "@/types";
import type { VocabularyLearnedPayload } from "@/types/events";
import { useAudioWaveform } from "@/hooks/useAudioWaveform";
import { useTauriEvent, VOCABULARY_LEARNED } from "@/hooks/useTauriEvent";
import { useSettingsStore } from "@/stores/settingsStore";
import { cn } from "@/lib/utils";
import styles from "./NotchHud.module.css";

type VisualMode =
  | "hidden"
  | "recording"
  | "morphing"
  | "transcribing"
  | "success"
  | "error"
  | "cancelled"
  | "collapsing"
  | "learned";

interface NotchHudProps {
  status: HudStatus;
  recordingElapsedSeconds: number;
  message: string;
  canRetry: boolean;
  onRetry: () => void;
}

// --- Constants ---

const WAVEFORM_ELEMENT_COUNT = 6;
const MIN_BAR_HEIGHT = 4;
const MAX_BAR_HEIGHT = 28;
const ERROR_WITH_MESSAGE_HEIGHT = 72;
const COLLAPSE_ANIMATION_DURATION_MS = 400;
const LEARNED_DISPLAY_DURATION_MS = 2000;
const MAX_DISPLAY_TERM_COUNT = 3;

// Pre-computed static styles for waveform bar elements (avoid recreating each frame)
const WAVEFORM_BAR_STYLES: React.CSSProperties[] = Array.from(
  { length: WAVEFORM_ELEMENT_COUNT },
  (_, i) => ({
    height: `var(--bar-h-${i}, ${MIN_BAR_HEIGHT}px)`,
    width: "4px",
    borderRadius: "2px",
  }),
);

// --- Notch shape ---

interface NotchShapeParams {
  width: number;
  height: number;
  topRadius: number;
  bottomRadius: number;
}

const DEFAULT_NOTCH_SHAPE: NotchShapeParams = {
  width: 350,
  height: 42,
  topRadius: 14,
  bottomRadius: 22,
};

const NOTCH_SHAPE_OVERRIDES: Partial<Record<VisualMode, NotchShapeParams>> = {
  collapsing: { width: 200, height: 32, topRadius: 10, bottomRadius: 16 },
};

function buildNotchPath(p: NotchShapeParams): string {
  const { width: w, height: h, topRadius: tr, bottomRadius: br } = p;
  return `path('M 0,0 Q ${tr},0 ${tr},${tr} L ${tr},${h - br} Q ${tr},${h} ${tr + br},${h} L ${w - tr - br},${h} Q ${w - tr},${h} ${w - tr},${h - br} L ${w - tr},${tr} Q ${w - tr},0 ${w},0 Z')`;
}

// --- Waveform element class mapping ---

function getWaveformElementClass(mode: VisualMode): string {
  switch (mode) {
    case "recording":
      return styles.waveformBar;
    case "morphing":
      return styles.waveformMorphing;
    case "transcribing":
      return styles.waveformDot;
    case "success":
      return styles.waveformConverge;
    case "error":
      return styles.waveformScatter;
    default:
      return "";
  }
}

// --- Component ---

export function NotchHud({
  status,
  recordingElapsedSeconds,
  message,
  canRetry,
  onRetry,
}: NotchHudProps) {
  const { t } = useTranslation();

  const [visualMode, setVisualMode] = useState<VisualMode>("hidden");
  const [pendingLearnedTermList, setPendingLearnedTermList] = useState<
    string[][]
  >([]);
  const [learnedDisplayText, setLearnedDisplayText] = useState("");

  // Refs to access latest state inside timers/callbacks without re-subscribing
  const visualModeRef = useRef<VisualMode>(visualMode);
  visualModeRef.current = visualMode;

  const pendingLearnedTermListRef = useRef(pendingLearnedTermList);
  pendingLearnedTermListRef.current = pendingLearnedTermList;

  const morphingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapsingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const learnedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { waveformLevelList, startWaveformAnimation, stopWaveformAnimation } =
    useAudioWaveform();

  // --- Timer helpers ---

  const clearMorphingTimer = useCallback(() => {
    if (morphingTimerRef.current) {
      clearTimeout(morphingTimerRef.current);
      morphingTimerRef.current = null;
    }
  }, []);

  const clearCollapsingTimer = useCallback(() => {
    if (collapsingTimerRef.current) {
      clearTimeout(collapsingTimerRef.current);
      collapsingTimerRef.current = null;
    }
  }, []);

  const clearLearnedTimer = useCallback(() => {
    if (learnedTimerRef.current) {
      clearTimeout(learnedTimerRef.current);
      learnedTimerRef.current = null;
    }
  }, []);

  // --- Derived values ---

  const hasErrorMessage = visualMode === "error" && message !== "";
  const hasSuccessPreview = visualMode === "success" && message !== "" && message.includes("·");
  const isExpandedMode = hasErrorMessage || visualMode === "learned" || hasSuccessPreview;

  const isHighPriorityMode =
    visualMode === "recording" ||
    visualMode === "morphing" ||
    visualMode === "transcribing" ||
    visualMode === "success" ||
    visualMode === "error" ||
    visualMode === "cancelled";

  const isHighPriorityModeRef = useRef(isHighPriorityMode);
  isHighPriorityModeRef.current = isHighPriorityMode;

  const notchStyle = useMemo(() => {
    let params =
      NOTCH_SHAPE_OVERRIDES[visualMode] ?? DEFAULT_NOTCH_SHAPE;
    if (isExpandedMode) {
      params = { ...params, height: ERROR_WITH_MESSAGE_HEIGHT };
    }
    return {
      width: `${params.width}px`,
      height: `${params.height}px`,
      clipPath: buildNotchPath(params),
    };
  }, [visualMode, isExpandedMode]);

  const formattedElapsedTime = useMemo(() => {
    const minutes = Math.floor(recordingElapsedSeconds / 60);
    const seconds = recordingElapsedSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }, [recordingElapsedSeconds]);

  // Use CSS custom properties on the container to avoid per-element style object allocation at 60fps
  const waveformContainerStyle = useMemo(() => {
    if (visualMode !== "recording") return undefined;
    const vars: Record<string, string> = {};
    for (let i = 0; i < WAVEFORM_ELEMENT_COUNT; i++) {
      const level = waveformLevelList[i] ?? 0;
      const height = MIN_BAR_HEIGHT + level * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);
      vars[`--bar-h-${i}`] = `${Math.round(height)}px`;
    }
    return vars as React.CSSProperties;
  }, [visualMode, waveformLevelList]);

  const waveformElementClass = getWaveformElementClass(visualMode);

  // --- Learned notification helpers ---

  const formatLearnedText = useCallback(
    (termList: string[]): string => {
      if (termList.length <= MAX_DISPLAY_TERM_COUNT) {
        return t("voiceFlow.vocabularyLearned", {
          terms: termList.join(", "),
        });
      }
      const displayedTermList = termList.slice(0, MAX_DISPLAY_TERM_COUNT);
      return t("voiceFlow.vocabularyLearnedTruncated", {
        terms: displayedTermList.join(", "),
        count: termList.length - MAX_DISPLAY_TERM_COUNT,
      });
    },
    [t],
  );

  const processNextLearnedNotification = useCallback(() => {
    const pending = pendingLearnedTermListRef.current;
    if (pending.length === 0) return;
    if (isHighPriorityModeRef.current) return;
    const nextTermList = pending[0] ?? [];
    setPendingLearnedTermList((prev) => prev.slice(1));
    setLearnedDisplayText(formatLearnedText(nextTermList));
    setVisualMode("learned");
    if (useSettingsStore.getState().isSoundEffectsEnabled) {
      void invoke("play_learned_sound").catch(() => { /* non-critical sound */ });
    }
    clearLearnedTimer();
    learnedTimerRef.current = setTimeout(() => {
      setVisualMode("collapsing");
      collapsingTimerRef.current = setTimeout(() => {
        setVisualMode("hidden");
        // Recursively process remaining — use ref to get fresh pending list
        const remaining = pendingLearnedTermListRef.current;
        if (remaining.length > 0 && !isHighPriorityModeRef.current) {
          const next = remaining[0];
          setPendingLearnedTermList((prev) => prev.slice(1));
          setLearnedDisplayText(formatLearnedText(next ?? []));
          setVisualMode("learned");
          if (useSettingsStore.getState().isSoundEffectsEnabled) {
            void invoke("play_learned_sound").catch(() => { /* non-critical sound */ });
          }
        }
      }, COLLAPSE_ANIMATION_DURATION_MS);
    }, LEARNED_DISPLAY_DURATION_MS);
  }, [formatLearnedText, clearLearnedTimer]);

  const showLearnedNotification = useCallback(
    (termList: string[]) => {
      setLearnedDisplayText(formatLearnedText(termList));
      setVisualMode("learned");
      if (useSettingsStore.getState().isSoundEffectsEnabled) {
        void invoke("play_learned_sound").catch(() => { /* non-critical sound */ });
      }
      clearLearnedTimer();
      learnedTimerRef.current = setTimeout(() => {
        setVisualMode("collapsing");
        collapsingTimerRef.current = setTimeout(() => {
          setVisualMode("hidden");
          processNextLearnedNotification();
        }, COLLAPSE_ANIMATION_DURATION_MS);
      }, LEARNED_DISPLAY_DURATION_MS);
    },
    [formatLearnedText, clearLearnedTimer, processNextLearnedNotification],
  );

  // --- VOCABULARY_LEARNED event handler ---

  const handleVocabularyLearned = useCallback(
    (payload: VocabularyLearnedPayload) => {
      logInfo(
        "hud",
        `VOCABULARY_LEARNED received: termList=${JSON.stringify(payload.termList)}, visualMode=${visualModeRef.current}, isHighPriority=${isHighPriorityModeRef.current}`,
      );
      if (!payload.termList || payload.termList.length === 0) return;

      if (
        isHighPriorityModeRef.current ||
        visualModeRef.current === "learned"
      ) {
        logInfo(
          "hud",
          "queued (high priority or already showing learned)",
        );
        setPendingLearnedTermList((prev) => [...prev, payload.termList]);
        return;
      }

      logInfo("hud", "showing learned notification now");
      showLearnedNotification(payload.termList);
    },
    [showLearnedNotification],
  );

  useTauriEvent<VocabularyLearnedPayload>(
    VOCABULARY_LEARNED,
    handleVocabularyLearned,
  );

  // --- Status watcher (replaces Vue watch) ---

  const prevStatusRef = useRef<HudStatus | null>(null);

  useEffect(() => {
    // Skip if status hasn't changed (handles strict mode double-invoke)
    if (prevStatusRef.current === status) return;
    prevStatusRef.current = status;

    clearMorphingTimer();
    clearCollapsingTimer();
    clearLearnedTimer();

    if (status === "idle") {
      stopWaveformAnimation();
      if (visualModeRef.current === "learned") return;
      if (visualModeRef.current === "hidden") {
        processNextLearnedNotification();
        return;
      }
      setVisualMode("collapsing");
      collapsingTimerRef.current = setTimeout(() => {
        setVisualMode("hidden");
        processNextLearnedNotification();
      }, COLLAPSE_ANIMATION_DURATION_MS);
      return;
    }

    if (status === "recording") {
      setVisualMode("recording");
      void startWaveformAnimation();
      return;
    }

    if (status === "transcribing" || status === "enhancing") {
      stopWaveformAnimation();
      if (
        visualModeRef.current === "recording" ||
        visualModeRef.current === "morphing"
      ) {
        setVisualMode("morphing");
        morphingTimerRef.current = setTimeout(() => {
          setVisualMode("transcribing");
        }, 300);
      } else {
        setVisualMode("transcribing");
      }
      return;
    }

    if (status === "success") {
      stopWaveformAnimation();
      setVisualMode("success");
      return;
    }

    if (status === "error") {
      stopWaveformAnimation();
      setVisualMode("error");
      return;
    }

    if (status === "cancelled") {
      stopWaveformAnimation();
      setVisualMode("cancelled");
      return;
    }
  }, [
    status,
    clearMorphingTimer,
    clearCollapsingTimer,
    clearLearnedTimer,
    stopWaveformAnimation,
    startWaveformAnimation,
    processNextLearnedNotification,
  ]);

  // --- Cleanup on unmount ---

  useEffect(() => {
    return () => {
      clearMorphingTimer();
      clearCollapsingTimer();
      clearLearnedTimer();
      stopWaveformAnimation();
    };
  }, [
    clearMorphingTimer,
    clearCollapsingTimer,
    clearLearnedTimer,
    stopWaveformAnimation,
  ]);

  // --- Render ---

  if (visualMode === "hidden") return null;

  const renderLeftContent = () => {
    if (visualMode === "cancelled") {
      return (
        <svg
          className={styles.cancelledIconSvg}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(255, 255, 255, 0.6)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    }

    if (visualMode === "learned") {
      return (
        <svg
          className={styles.learnedIconSvg}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(147, 197, 253, 0.95)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      );
    }

    return (
      <>
        <div className={styles.waveformContainer} style={waveformContainerStyle}>
          {WAVEFORM_BAR_STYLES.map((barStyle, index) => (
            <span
              key={index}
              className={cn(styles.waveformElement, waveformElementClass)}
              style={visualMode === "recording" ? barStyle : undefined}
            />
          ))}
        </div>
        {visualMode === "success" && (
          <svg
            className={styles.checkmarkSvg}
            width="18"
            height="18"
            viewBox="0 0 24 24"
          >
            <path
              d="M4 12l6 6L20 6"
              fill="none"
              stroke="#22c55e"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </>
    );
  };

  const renderRightContent = () => {
    if (visualMode === "cancelled") {
      return (
        <span className={styles.cancelledLabel}>
          {t("voiceFlow.cancelled")}
        </span>
      );
    }

    if (visualMode === "learned") {
      return (
        <span className={styles.learnedLabel}>
          {t("voiceFlow.vocabularyLearnedLabel")}
        </span>
      );
    }

    if (visualMode === "recording") {
      return (
        <span className={styles.elapsedTimer}>{formattedElapsedTime}</span>
      );
    }

    if (visualMode === "error" && canRetry) {
      return (
        <button
          type="button"
          className={styles.retryIcon}
          aria-label="Retry"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
        >
          &#x21BB;
        </button>
      );
    }

    return null;
  };

  const ariaLabel = visualMode === "recording"
    ? `${t("voiceFlow.recording")} ${formattedElapsedTime}`
    : message ?? undefined;

  return (
    <div
      role="status"
      aria-live="assertive"
      aria-label={ariaLabel}
      className={cn(styles.notchWrapper, {
        [styles.notchWrapperSuccess]: visualMode === "success",
        [styles.notchWrapperLearned]: visualMode === "learned",
      })}
    >
      <div
        className={cn(styles.notchHud, {
          [styles.notchShake]: visualMode === "error",
          [styles.notchCollapsing]: visualMode === "collapsing",
          [styles.notchHudExpanded]: isExpandedMode,
        })}
        style={notchStyle}
      >
        <div className={styles.notchContent}>
          <div className={styles.notchLeft}>{renderLeftContent()}</div>
          <div className={styles.notchCameraGap} />
          <div className={styles.notchRight}>{renderRightContent()}</div>
        </div>

        {visualMode === "learned" && (
          <div className={styles.learnedTermsRow}>
            <span className={styles.learnedTerms}>{learnedDisplayText}</span>
          </div>
        )}

        {hasSuccessPreview && (
          <div className={styles.errorMessageRow}>
            <span className={styles.errorMessage} style={{ color: "rgba(255,255,255,0.7)" }}>
              {message.split("·").slice(1).join("·").trim()}
            </span>
          </div>
        )}

        {hasErrorMessage && (
          <div className={styles.errorMessageRow}>
            <span className={styles.errorMessage}>{message}</span>
          </div>
        )}
      </div>
    </div>
  );
}
