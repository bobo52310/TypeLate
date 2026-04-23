import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import { load as loadStore } from "@tauri-apps/plugin-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSettingsStore } from "@/stores/settingsStore";
import { logError } from "@/lib/logger";
import { useAudioWaveform } from "@/hooks/useAudioWaveform";
import { getRandomSlogan } from "@/lib/slogans";
import {
  getTranscriptionProviders,
  getProviderConfig,
  type TranscriptionProviderId,
} from "@/lib/providerConfig";
import logoTypeLate from "@/assets/logo-typelate.png";
import {
  Mic,
  KeyRound,
  CheckCircle2,
  ArrowRight,
  Loader2,
  ExternalLink,
  ClipboardPaste,
  Keyboard,
  Sparkles,
} from "lucide-react";

type OnboardingStep =
  | "welcome"
  | "provider-select"
  | "api-key-intro"
  | "api-key-paste"
  | "hotkey"
  | "mic-test";

interface OnboardingViewProps {
  onComplete: () => void;
}

export default function OnboardingView({ onComplete }: OnboardingViewProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [selectedProvider, setSelectedProvider] = useState<TranscriptionProviderId>("groq");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [micTestPassed, setMicTestPassed] = useState(false);
  const [trialText, setTrialText] = useState("");
  const [slogan] = useState(() => getRandomSlogan());

  const saveApiKey = useSettingsStore((s) => s.saveApiKey);
  const saveTranscriptionProviderId = useSettingsStore((s) => s.saveTranscriptionProviderId);
  const saveLlmProviderId = useSettingsStore((s) => s.saveLlmProviderId);

  const providerConfig = getProviderConfig(selectedProvider);

  const handleSelectProvider = useCallback(
    async (id: TranscriptionProviderId) => {
      setSelectedProvider(id);
      try {
        // Set both transcription and LLM providers to the same choice during
        // onboarding; users can differentiate later in Settings.
        await saveTranscriptionProviderId(id);
        await saveLlmProviderId(id);
      } catch {
        // non-blocking
      }
      setStep("api-key-intro");
    },
    [saveTranscriptionProviderId, saveLlmProviderId],
  );

  const handleOpenConsole = useCallback(() => {
    void open(providerConfig.consoleUrl);
    setStep("api-key-paste");
  }, [providerConfig.consoleUrl]);

  const handleSaveApiKey = useCallback(async () => {
    if (!apiKeyInput.trim()) return;
    setIsSubmitting(true);
    setError("");
    try {
      await saveApiKey(selectedProvider, apiKeyInput.trim());
      setStep("mic-test");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }, [apiKeyInput, saveApiKey, selectedProvider]);

  const { waveformLevelList, startWaveformAnimation, stopWaveformAnimation } = useAudioWaveform();
  const isRecordingForTestRef = useRef(false);

  const MIC_DETECT_THRESHOLD = 0.15;

  const stopMicTest = useCallback(async () => {
    if (!isRecordingForTestRef.current) return;
    isRecordingForTestRef.current = false;
    stopWaveformAnimation();
    try {
      await invoke("stop_recording");
    } catch {
      // ignore — might not be recording
    }
  }, [stopWaveformAnimation]);

  const startMicTest = useCallback(async () => {
    if (isRecordingForTestRef.current) return;
    setMicTestPassed(false);
    try {
      await invoke("start_recording", { deviceName: "" });
      isRecordingForTestRef.current = true;
      await startWaveformAnimation();
    } catch (err) {
      logError("Onboarding", "Mic test start failed", err);
    }
  }, [startWaveformAnimation]);

  // Auto-start mic test when entering step; stop when leaving
  useEffect(() => {
    if (step === "mic-test") {
      void startMicTest();
    } else {
      void stopMicTest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Detect sound → mark as passed (keep waveform visible, no auto-advance)
  useEffect(() => {
    if (step !== "mic-test" || micTestPassed || !isRecordingForTestRef.current) return;
    const hasSound = waveformLevelList.some((level) => level > MIC_DETECT_THRESHOLD);
    if (hasSound) {
      setMicTestPassed(true);
    }
  }, [waveformLevelList, step, micTestPassed]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      void stopMicTest();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for transcription results to fill the trial textarea
  useEffect(() => {
    if (step !== "hotkey") return;
    let unlisten: (() => void) | undefined;
    listen<{ processedText: string | null; rawText: string }>(
      "transcription:completed",
      (event) => {
        const text = event.payload.processedText ?? event.payload.rawText;
        if (text) setTrialText(text);
      },
    ).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [step]);

  const handleComplete = useCallback(() => {
    onComplete();
    // Persist in background — don't block UI transition
    loadStore("settings.json")
      .then(async (store) => {
        await store.set("onboardingCompleted", true);
        // Mark current version as seen so the upgrade notice won't fire
        // on the next launch after a fresh install.
        const { APP_VERSION } = await import("@/lib/version");
        await store.set("lastSeenVersion", APP_VERSION);
        await store.save();
      })
      .catch((err) => logError("Onboarding", "Failed to save onboarding status", err));
  }, [onComplete]);

  const currentStepNum =
    step === "provider-select"
      ? 1
      : step === "api-key-intro" || step === "api-key-paste"
        ? 2
        : step === "mic-test"
          ? 3
          : 4;
  const totalSteps = 4;
  const showStepIndicator = step !== "welcome";

  return (
    <div className="relative flex h-screen min-h-0 items-center justify-center overflow-hidden bg-background p-8 pt-14">
      {/* Gradient background — full coverage */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-primary/5" />
      <div className="absolute -top-32 -right-32 h-64 w-64 rounded-full bg-primary/8 blur-3xl" />
      <div className="absolute -bottom-32 -left-32 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />

      {/* Skip button — top right */}
      <button
        onClick={() => handleComplete()}
        className="absolute top-4 right-5 z-20 text-xs text-muted-foreground/50 transition-colors hover:text-muted-foreground"
      >
        {t("onboarding.skipSetup", "Skip setup")} &rarr;
      </button>

      <div className="relative z-10 w-full max-w-md">
        {/* ── Welcome ── */}
        {step === "welcome" && (
          <div className="flex flex-col items-center gap-8 text-center">
            {/* Logo */}
            <div className="relative">
              <div className="absolute inset-0 animate-pulse rounded-3xl bg-primary/20 blur-xl" />
              <img
                src={logoTypeLate}
                alt="TypeLate"
                className="relative h-20 w-20 rounded-2xl drop-shadow-lg"
              />
            </div>

            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">TypeLate</h1>
              {slogan && (
                <p className="mt-3 text-base italic text-primary/70">&ldquo;{slogan}&rdquo;</p>
              )}
            </div>

            <div className="w-full space-y-3">
              <Button
                size="lg"
                className="w-full gap-2 text-base"
                onClick={() => setStep("provider-select")}
              >
                {t("onboarding.getStarted", "Get Started")}
                <ArrowRight className="h-4 w-4" />
              </Button>
              <p className="text-xs text-muted-foreground/60">
                {t("onboarding.setupTime", "Setup takes about 1 minute")}
              </p>
            </div>
          </div>
        )}

        {/* ── Step cards (shared card wrapper) ── */}
        {step !== "welcome" && (
          <div className="rounded-xl border border-border/50 bg-card/80 p-6 shadow-lg backdrop-blur-sm">
            {/* ── Step 1: Provider selection ── */}
            {step === "provider-select" && (
              <div className="flex flex-col gap-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Sparkles className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">
                      {t("onboarding.providerSelectTitle", "Choose Your AI Provider")}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {t(
                        "onboarding.providerSelectDescription",
                        "You can change this later in Settings.",
                      )}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  {getTranscriptionProviders().map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => void handleSelectProvider(provider.id as TranscriptionProviderId)}
                      className="flex w-full items-center gap-4 rounded-lg border border-border/50 p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {provider.displayName}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t(`settings.provider.${provider.id}Description`)}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>

                <Button variant="ghost" onClick={() => setStep("welcome")}>
                  {t("common.back", "Back")}
                </Button>
              </div>
            )}

            {/* ── Step 2a: API Key intro ── */}
            {step === "api-key-intro" && (
              <div className="flex flex-col gap-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <KeyRound className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">
                      {t("onboarding.apiKeyTitleTemplate", {
                        provider: providerConfig.displayName,
                        defaultValue: `Step 2: Get a ${providerConfig.displayName} API Key`,
                      })}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {t("onboarding.apiKeyIntroSubtitle", "Free, takes about 30 seconds")}
                    </p>
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border border-border/50 bg-muted/20 p-4">
                  {[
                    t("onboarding.apiKeyStep1", "Click the button below to open Groq Console"),
                    t("onboarding.apiKeyStep2", "Sign up or log in (Google account works)"),
                    t(
                      "onboarding.apiKeyStep3",
                      'Click "Create API Key", copy the key starting with gsk_',
                    ),
                    t("onboarding.apiKeyStep4", "Come back here and paste it in the next step"),
                  ].map((text, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
                        {i + 1}
                      </span>
                      <p className="text-sm text-muted-foreground">{text}</p>
                    </div>
                  ))}
                </div>

                <Button
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                  onClick={handleOpenConsole}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {t("onboarding.openConsoleTemplate", {
                    provider: providerConfig.displayName,
                    defaultValue: `Open ${providerConfig.displayName} Console`,
                  })}
                </Button>

                <div className="flex items-center justify-between">
                  <Button variant="ghost" onClick={() => setStep("provider-select")}>
                    {t("common.back", "Back")}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {t("onboarding.alreadyHaveKey", "Already have a key?")}{" "}
                    <button
                      className="text-primary hover:underline"
                      onClick={() => setStep("api-key-paste")}
                    >
                      {t("onboarding.pasteItNow", "Paste it now")}
                    </button>
                  </p>
                </div>
              </div>
            )}

            {/* ── Step 2b: Paste API Key ── */}
            {step === "api-key-paste" && (
              <div className="flex flex-col gap-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <ClipboardPaste className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">
                      {t("onboarding.pasteKeyTitle", "Paste your API Key")}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {t(
                        "onboarding.pasteKeyDescription",
                        "Paste the key you copied from Groq Console",
                      )}
                    </p>
                  </div>
                </div>

                <Input
                  type="password"
                  placeholder={providerConfig.keyPlaceholder}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveApiKey();
                  }}
                  className="border-border/50"
                  autoFocus
                />
                {error && <p className="text-sm text-destructive">{error}</p>}

                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep("api-key-intro")}>
                    {t("common.back", "Back")}
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={!apiKeyInput.trim() || isSubmitting}
                    onClick={() => void handleSaveApiKey()}
                  >
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t("onboarding.saveAndContinue", "Save & Continue")}
                  </Button>
                </div>

                <p className="text-center text-xs text-muted-foreground">
                  {t("onboarding.needKey", "Don't have a key yet?")}{" "}
                  <button
                    className="text-primary hover:underline"
                    onClick={() => setStep("api-key-intro")}
                  >
                    {t("onboarding.getOneNow", "Get one now")}
                  </button>
                </p>
              </div>
            )}

            {/* ── Step 4: Hotkey — try it now ── */}
            {step === "hotkey" && (
              <div className="flex flex-col gap-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Keyboard className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">
                      {t("onboarding.hotkeyTitle", "Step 4: Hotkey")}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {t("onboarding.hotkeyCustomize", "You can customize this later in Settings.")}
                    </p>
                  </div>
                </div>

                {/* Trial area — combined hotkey hint + input */}
                <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <p className="text-center text-sm text-muted-foreground">
                    {t(
                      "onboarding.trialInstruction",
                      "Click the box, press Fn to start recording, press again to stop.",
                    )}
                  </p>

                  <Textarea
                    placeholder={t(
                      "onboarding.trialPlaceholder",
                      "Press Fn and speak — text will appear here...",
                    )}
                    value={trialText}
                    onChange={(e) => setTrialText(e.target.value)}
                    className="min-h-20 resize-none border-primary/30 bg-background/60"
                  />

                  {trialText.trim() ? (
                    <div className="flex items-center justify-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      <span className="text-sm font-medium text-primary">
                        {t("onboarding.trialSuccess", "It works! You've got the hang of it.")}
                      </span>
                    </div>
                  ) : (
                    <p className="text-center text-xs text-muted-foreground/60">
                      {t("onboarding.trialExample", 'Try saying "The weather is nice today"')}
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep("mic-test")}>
                    {t("common.back", "Back")}
                  </Button>
                  <Button className="flex-1" onClick={() => handleComplete()}>
                    {trialText.trim()
                      ? t("common.next", "Next")
                      : t("onboarding.skip", "Skip")}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* ── Step 3: Mic test ── */}
            {step === "mic-test" && (
              <div className="flex flex-col gap-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Mic className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">
                      {t("onboarding.micTitle", "Step 3: Microphone")}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {t(
                        "onboarding.micDescription",
                        "Let's make sure your microphone is working.",
                      )}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  {/* Waveform bars — always visible while on this step */}
                  <div className="flex w-full items-end justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 p-5">
                    {waveformLevelList.map((level, i) => (
                      <div
                        key={i}
                        className="w-3 rounded-full bg-primary transition-all duration-75"
                        style={{
                          height: `${Math.max(4, Math.round(level * 48))}px`,
                        }}
                      />
                    ))}
                    <p className="ml-3 text-sm text-muted-foreground">
                      {t("onboarding.micListening", "Listening...")}
                    </p>
                  </div>
                  {micTestPassed ? (
                    <div className="flex items-center justify-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      <p className="text-center text-sm font-medium text-primary">
                        {t("onboarding.micSuccess", "Microphone detected!")}
                      </p>
                    </div>
                  ) : (
                    <p className="text-center text-xs text-muted-foreground">
                      {t("onboarding.micSpeakNow", "Say something to test your microphone")}
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep("api-key-paste")}>
                    {t("common.back", "Back")}
                  </Button>
                  <Button className="flex-1" onClick={() => setStep("hotkey")}>
                    {micTestPassed ? t("common.next", "Next") : t("onboarding.skip", "Skip")}
                  </Button>
                </div>
              </div>
            )}

            {/* Step indicator */}
            {showStepIndicator && (
              <div className="mt-6 flex items-center justify-center gap-1.5">
                {Array.from({ length: totalSteps }, (_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${
                      i + 1 === currentStepNum ? "w-8 bg-primary" : "w-4 bg-muted"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
