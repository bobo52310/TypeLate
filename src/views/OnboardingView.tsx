import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { load as loadStore } from "@tauri-apps/plugin-store";
import { useSettingsStore } from "@/stores/settingsStore";
import { logError } from "@/lib/logger";
import { useAudioWaveform } from "@/hooks/useAudioWaveform";
import {
  getProviderConfig,
  type TranscriptionProviderId,
} from "@/lib/providerConfig";
import { CheckCircle2, Loader2 } from "lucide-react";

const DEFAULT_PROVIDER: TranscriptionProviderId = "groq";

type Step = 1 | 2 | 3;

interface OnboardingViewProps {
  onComplete: () => void;
}

export default function OnboardingView({ onComplete }: OnboardingViewProps) {
  const { t } = useTranslation();
  const providerConfig = getProviderConfig(DEFAULT_PROVIDER);

  const saveApiKey = useSettingsStore((s) => s.saveApiKey);
  const saveTranscriptionProviderId = useSettingsStore(
    (s) => s.saveTranscriptionProviderId,
  );
  const saveLlmProviderId = useSettingsStore((s) => s.saveLlmProviderId);
  const hasTranscriptionApiKey = useSettingsStore((s) => s.hasTranscriptionApiKey());

  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [micTestPassed, setMicTestPassed] = useState(false);

  // Auto-sync step: if key already configured skip to step 2
  useEffect(() => {
    if (hasTranscriptionApiKey && currentStep === 1) setCurrentStep(2);
  }, [hasTranscriptionApiKey, currentStep]);

  // Pick the active provider once at start
  useEffect(() => {
    void saveTranscriptionProviderId(DEFAULT_PROVIDER).catch(() => {});
    void saveLlmProviderId(DEFAULT_PROVIDER).catch(() => {});
  }, [saveTranscriptionProviderId, saveLlmProviderId]);

  const handleOpenConsole = useCallback(() => {
    void open(providerConfig.consoleUrl);
  }, [providerConfig.consoleUrl]);

  const handleSaveKey = useCallback(async () => {
    if (!apiKeyInput.trim()) return;
    setIsSubmitting(true);
    setSaveError("");
    try {
      await saveApiKey(DEFAULT_PROVIDER, apiKeyInput.trim());
      setCurrentStep(2);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }, [apiKeyInput, saveApiKey]);

  // ── Mic test (Step 2) ──
  const { waveformLevelList, startWaveformAnimation, stopWaveformAnimation } =
    useAudioWaveform();
  const isRecordingForTestRef = useRef(false);
  const MIC_THRESHOLD = 0.15;

  const stopMicTest = useCallback(async () => {
    if (!isRecordingForTestRef.current) return;
    isRecordingForTestRef.current = false;
    stopWaveformAnimation();
    try {
      await invoke("stop_recording");
    } catch {
      // ignore
    }
  }, [stopWaveformAnimation]);

  const startMicTest = useCallback(async () => {
    if (isRecordingForTestRef.current) return;
    try {
      await invoke("start_recording", { deviceName: "" });
      isRecordingForTestRef.current = true;
      await startWaveformAnimation();
    } catch (err) {
      logError("Onboarding", "Mic test start failed", err);
    }
  }, [startWaveformAnimation]);

  useEffect(() => {
    if (currentStep === 2) {
      void startMicTest();
    } else {
      void stopMicTest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  useEffect(() => {
    if (currentStep !== 2 || micTestPassed || !isRecordingForTestRef.current) return;
    if (waveformLevelList.some((l) => l > MIC_THRESHOLD)) setMicTestPassed(true);
  }, [waveformLevelList, currentStep, micTestPassed]);

  // ── Permission probe (Step 3) ──
  const [hasMicPermission, setHasMicPermission] = useState(false);
  const [hasAccessibilityPermission, setHasAccessibilityPermission] = useState(false);
  useEffect(() => {
    if (currentStep !== 3) return;
    // Mic is granted implicitly if mic test succeeded
    setHasMicPermission(micTestPassed);
    // Query accessibility
    invoke<boolean>("check_accessibility_permission_command")
      .then(setHasAccessibilityPermission)
      .catch(() => setHasAccessibilityPermission(false));
  }, [currentStep, micTestPassed]);

  useEffect(() => {
    return () => {
      void stopMicTest();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleComplete = useCallback(() => {
    onComplete();
    loadStore("settings.json")
      .then(async (store) => {
        await store.set("onboardingCompleted", true);
        const { APP_VERSION } = await import("@/lib/version");
        await store.set("lastSeenVersion", APP_VERSION);
        await store.save();
      })
      .catch((err) =>
        logError("Onboarding", "Failed to save onboarding status", err),
      );
  }, [onComplete]);

  // ── Render ──

  const stepMet = (step: Step) => step < currentStep;

  return (
    <div
      className="v1-paper flex h-screen flex-col overflow-hidden pt-9"
      style={{ color: "var(--v1-ink)" }}
    >
      <section className="flex-1 overflow-auto px-7 pt-5 pb-6">
        {/* Header */}
        <div className="mb-1 flex flex-wrap items-baseline gap-3">
          <div
            className="font-hand"
            style={{ fontSize: 24, fontWeight: 700 }}
          >
            {t("onboarding.v1.headline")}
          </div>
          <div
            className="font-scribble"
            style={{ fontSize: 18, color: "var(--v1-ink-3)" }}
          >
            {t("onboarding.v1.duration")}
          </div>
          <div className="flex-1" />
          <button
            onClick={handleComplete}
            style={{ fontSize: 11, color: "var(--v1-ink-4)" }}
            className="transition-colors hover:opacity-80"
          >
            {t("onboarding.v1.skip")} →
          </button>
        </div>

        {/* Progress dots */}
        <div className="mb-4 flex items-center gap-2">
          {[1, 2, 3].map((n, i) => {
            const step = n as Step;
            const isActive = step === currentStep;
            const isDone = stepMet(step);
            return (
              <span key={n} className="flex items-center gap-2">
                <div
                  className="grid place-items-center"
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    border: "1.5px solid var(--v1-line)",
                    background: isActive || isDone ? "var(--v1-ink)" : "#fff",
                    color:
                      isActive || isDone ? "var(--v1-accent)" : "var(--v1-ink-3)",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {isDone ? "✓" : n}
                </div>
                {i < 2 && (
                  <div
                    style={{
                      width: 48,
                      height: 0,
                      borderTop: "1.5px dashed var(--v1-ink-4)",
                    }}
                  />
                )}
              </span>
            );
          })}
        </div>

        {/* Three cards */}
        <div className="grid gap-3.5" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          {/* ── STEP 1: Connect AI engine ── */}
          <StepCard
            number="01"
            title={t("onboarding.v1.step1Title")}
            dimmed={currentStep !== 1}
            sticky={{ tone: "yellow", text: t("onboarding.v1.step1Sticky") }}
          >
            <p
              style={{
                fontSize: 11.5,
                color: "var(--v1-ink-3)",
                lineHeight: 1.5,
              }}
            >
              {t("onboarding.v1.step1Desc")}
            </p>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSaveKey();
              }}
              placeholder={providerConfig.keyPlaceholder}
              disabled={currentStep !== 1}
              className="font-mono-code v1-rough"
              style={{
                padding: "8px 10px",
                background: "var(--v1-paper-2)",
                fontSize: 11,
                color: "var(--v1-ink)",
                outline: "none",
              }}
            />
            {saveError && (
              <p style={{ fontSize: 11, color: "var(--v1-accent-2)" }}>
                {saveError}
              </p>
            )}
            <button
              onClick={handleOpenConsole}
              disabled={currentStep !== 1}
              className="v1-rough text-left"
              style={{
                padding: "7px 10px",
                fontSize: 11.5,
                background: "var(--v1-ink)",
                color: "var(--v1-paper)",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              🔗 {t("onboarding.v1.step1OpenConsole")} →
            </button>
            <button
              onClick={() => void handleSaveKey()}
              disabled={!apiKeyInput.trim() || isSubmitting || currentStep !== 1}
              className="v1-rough inline-flex items-center justify-center gap-1.5 text-left"
              style={{
                padding: "7px 10px",
                fontSize: 11.5,
                background: "var(--v1-accent)",
                color: "var(--v1-ink)",
                fontWeight: 600,
                cursor: "pointer",
                opacity:
                  apiKeyInput.trim() && !isSubmitting && currentStep === 1
                    ? 1
                    : 0.5,
              }}
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("onboarding.v1.step1Save")}
            </button>
            <div
              className="font-hand"
              style={{ fontSize: 12, color: "var(--v1-accent-2)" }}
            >
              {t("onboarding.v1.step1Or")}{" "}
              <button
                onClick={handleComplete}
                style={{
                  textDecoration: "underline",
                  color: "var(--v1-accent-2)",
                  cursor: "pointer",
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  fontFamily: "inherit",
                  fontSize: "inherit",
                }}
              >
                {t("onboarding.v1.step1SandboxLink")}
              </button>
            </div>
          </StepCard>

          {/* ── STEP 2: Hotkey + mic test ── */}
          <StepCard
            number="02"
            title={t("onboarding.v1.step2Title")}
            dimmed={currentStep !== 2}
            sticky={{ tone: "pink", text: t("onboarding.v1.step2Sticky") }}
          >
            <p
              style={{
                fontSize: 11.5,
                color: "var(--v1-ink-3)",
                lineHeight: 1.5,
              }}
            >
              {t("onboarding.v1.step2DescPrefix")}{" "}
              <span className="v1-kbd">Fn</span>
              {t("onboarding.v1.step2DescSuffix")}
            </p>
            <div
              className="v1-rough flex items-center gap-2"
              style={{ padding: "10px 12px", background: "var(--v1-paper-2)" }}
            >
              <div
                className="grid place-items-center"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  background: "var(--v1-accent-2)",
                  color: "#fff",
                  fontSize: 11,
                }}
              >
                ●
              </div>
              <div className="flex flex-1 items-center gap-[3px]" style={{ height: 22 }}>
                {(waveformLevelList.length > 0
                  ? waveformLevelList.slice(0, 14)
                  : new Array(14).fill(0.2)
                ).map((lvl: number, i: number) => (
                  <div
                    key={i}
                    className="v1-wf-bar"
                    style={{
                      height: `${Math.max(15, Math.min(100, lvl * 100))}%`,
                      opacity: 0.55 + lvl * 0.45,
                    }}
                  />
                ))}
              </div>
              <span style={{ fontSize: 10, color: "var(--v1-ink-3)" }}>REC</span>
            </div>
            <div
              className="v1-rough-dash"
              style={{
                padding: "8px 10px",
                fontSize: 11,
                color: "var(--v1-ink-3)",
                lineHeight: 1.4,
              }}
            >
              <span
                className="font-hand"
                style={{ color: "var(--v1-ink-2)", fontSize: 12 }}
              >
                {t("onboarding.v1.step2TryPrefix")}
              </span>
              <br />
              {t("onboarding.v1.step2TryPhrase")}
            </div>
            {micTestPassed && (
              <div
                className="inline-flex items-center gap-1.5"
                style={{
                  fontSize: 11,
                  color: "var(--v1-accent-4)",
                  fontWeight: 500,
                }}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t("onboarding.v1.step2Passed")}
              </div>
            )}
            <button
              onClick={() => setCurrentStep(3)}
              disabled={currentStep !== 2}
              className="v1-rough"
              style={{
                padding: "7px 10px",
                fontSize: 11.5,
                background: micTestPassed ? "var(--v1-accent)" : "var(--v1-ink)",
                color: micTestPassed ? "var(--v1-ink)" : "var(--v1-paper)",
                fontWeight: 600,
                textAlign: "left",
                cursor: "pointer",
                opacity: currentStep === 2 ? 1 : 0.5,
              }}
            >
              {micTestPassed
                ? t("onboarding.v1.step2Next")
                : t("onboarding.v1.step2Skip")}{" "}
              →
            </button>
          </StepCard>

          {/* ── STEP 3: Real-world try ── */}
          <StepCard
            number="03"
            title={t("onboarding.v1.step3Title")}
            dimmed={currentStep !== 3}
          >
            <p
              style={{
                fontSize: 11.5,
                color: "var(--v1-ink-3)",
                lineHeight: 1.5,
              }}
            >
              {t("onboarding.v1.step3DescPrefix")}{" "}
              <span className="v1-kbd">Fn</span>
              {t("onboarding.v1.step3DescSuffix")}
            </p>
            <div
              className="v1-rough flex flex-col gap-1"
              style={{ padding: 8, background: "var(--v1-paper-2)", fontSize: 11 }}
            >
              <div className="flex items-center gap-1.5">
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    background: "var(--v1-accent-3)",
                  }}
                />
                <span style={{ fontWeight: 500 }}>#general</span>
              </div>
              <div
                className="v1-rough"
                style={{
                  padding: "6px 8px",
                  background: "#fff",
                  fontSize: 10.5,
                  color: "var(--v1-ink-3)",
                }}
              >
                {t("onboarding.v1.step3InputHint")}{" "}
                <span style={{ color: "var(--v1-accent-2)" }}>|</span>
              </div>
            </div>

            <PermissionRow
              ok={hasMicPermission}
              label={t("onboarding.v1.step3MicPermission")}
            />
            <PermissionRow
              ok={hasAccessibilityPermission}
              label={t("onboarding.v1.step3A11yPermission")}
            />

            <div style={{ flex: 1 }} />
            <button
              onClick={handleComplete}
              className="v1-rough"
              style={{
                padding: 8,
                fontSize: 12,
                background: "var(--v1-accent)",
                color: "var(--v1-ink)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("onboarding.v1.step3Cta")} →
            </button>
          </StepCard>
        </div>

        {/* Footer meta */}
        <div
          className="mt-4 flex flex-wrap items-center gap-2.5"
          style={{ fontSize: 11, color: "var(--v1-ink-3)" }}
        >
          <span className="font-hand" style={{ fontSize: 13 }}>
            ↑ {t("onboarding.v1.improvementsLabel")}：
          </span>
          {[
            t("onboarding.v1.improvement1"),
            t("onboarding.v1.improvement2"),
            t("onboarding.v1.improvement3"),
            t("onboarding.v1.improvement4"),
          ].map((tag, i) => (
            <span
              key={i}
              className="inline-flex items-center"
              style={{
                padding: "3px 9px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 500,
                border: "1.5px solid var(--v1-line)",
                color: "var(--v1-ink)",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

// ── StepCard ──

function StepCard({
  number,
  title,
  dimmed,
  sticky,
  children,
}: {
  number: string;
  title: string;
  dimmed: boolean;
  sticky?: { tone: "yellow" | "pink"; text: string };
  children: React.ReactNode;
}) {
  return (
    <div
      className="v1-rough-2 flex flex-col gap-2.5"
      style={{
        padding: 16,
        background: "#fff",
        opacity: dimmed ? 0.55 : 1,
        transition: "opacity 180ms",
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center"
          style={{
            padding: "3px 9px",
            borderRadius: 999,
            background: "var(--v1-ink)",
            color: "var(--v1-paper)",
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1,
          }}
        >
          {number}
        </span>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
      </div>
      {children}
      {sticky && (
        <div style={{ flex: 1 }} />
      )}
      {sticky && (
        <div
          className="v1-sticky font-hand"
          style={{
            background: sticky.tone === "yellow" ? "#fff3a8" : "#ffd0c9",
            fontSize: 11,
            transform: `rotate(${sticky.tone === "yellow" ? -2 : 2}deg)`,
            maxWidth: "none",
          }}
        >
          {sticky.text}
        </div>
      )}
    </div>
  );
}

function PermissionRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div
      className="flex items-center gap-1.5"
      style={{
        fontSize: 11,
        color: ok ? "var(--v1-accent-4)" : "var(--v1-ink-3)",
        fontWeight: ok ? 500 : 400,
      }}
    >
      <span style={{ width: 14, textAlign: "center" }}>{ok ? "✓" : "○"}</span>
      {label}
      {!ok && (
        <span style={{ marginLeft: 4, color: "var(--v1-ink-3)", fontSize: 10 }}>
          (待授權)
        </span>
      )}
    </div>
  );
}
