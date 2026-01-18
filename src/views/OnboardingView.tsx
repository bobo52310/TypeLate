import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/stores/settingsStore";
import { logError } from "@/lib/logger";
import { getRandomSlogan } from "@/lib/slogans";
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

type OnboardingStep = "welcome" | "api-key-intro" | "api-key-paste" | "hotkey" | "mic-test" | "done";

interface OnboardingViewProps {
  onComplete: () => void;
}

const GROQ_CONSOLE_URL = "https://console.groq.com/keys";

export default function OnboardingView({ onComplete }: OnboardingViewProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [micTestPassed, setMicTestPassed] = useState(false);
  const [isMicTesting, setIsMicTesting] = useState(false);
  const [slogan] = useState(() => getRandomSlogan());

  const saveApiKey = useSettingsStore((s) => s.saveApiKey);
  const hotkeyConfig = useSettingsStore((s) => s.hotkeyConfig);

  const handleOpenGroqConsole = useCallback(() => {
    void open(GROQ_CONSOLE_URL);
    setStep("api-key-paste");
  }, []);

  const handleSaveApiKey = useCallback(async () => {
    if (!apiKeyInput.trim()) return;
    setIsSubmitting(true);
    setError("");
    try {
      await saveApiKey(apiKeyInput.trim());
      setStep("hotkey");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }, [apiKeyInput, saveApiKey]);

  const handleMicTest = useCallback(async () => {
    setIsMicTesting(true);
    try {
      const devices = await invoke<{ name: string }[]>("list_audio_input_devices");
      setMicTestPassed(devices.length > 0);
      if (devices.length > 0) {
        setTimeout(() => setStep("done"), 1000);
      }
    } catch (err) {
      logError("Onboarding", "Mic test failed", err);
      setMicTestPassed(false);
    } finally {
      setIsMicTesting(false);
    }
  }, []);

  const handleComplete = useCallback(async () => {
    try {
      const { load } = await import("@tauri-apps/plugin-store");
      const store = await load("settings.json");
      await store.set("onboardingCompleted", true);
      await store.save();
    } catch (err) {
      logError("Onboarding", "Failed to save onboarding status", err);
    }
    onComplete();
  }, [onComplete]);

  const currentStepNum = step === "api-key-intro" || step === "api-key-paste" ? 1 : step === "hotkey" ? 2 : 3;
  const showStepIndicator = !["welcome", "done"].includes(step);

  return (
    <div className="relative flex h-screen min-h-0 items-center justify-center overflow-hidden bg-background p-8 pt-14">
      {/* Gradient background — full coverage */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-primary/5" />
      <div className="absolute -top-32 -right-32 h-64 w-64 rounded-full bg-primary/8 blur-3xl" />
      <div className="absolute -bottom-32 -left-32 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />

      {/* Skip button — top right */}
      <button
        onClick={() => void handleComplete()}
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
              <img src={logoTypeLate} alt="TypeLate" className="relative h-20 w-20 rounded-2xl drop-shadow-lg" />
            </div>

            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">
                TypeLate
              </h1>
              <p className="mt-3 text-base text-muted-foreground">
                {t("onboarding.welcomeDescription", "Voice-to-text, right where you type.")}
              </p>
              {/* Slogan */}
              {slogan && (
                <p className="mt-2 text-sm italic text-primary/70">
                  &ldquo;{slogan}&rdquo;
                </p>
              )}
            </div>

            <div className="w-full space-y-3">
              <Button
                size="lg"
                className="w-full gap-2 text-base"
                onClick={() => setStep("api-key-intro")}
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
        {step !== "welcome" && step !== "done" && (
          <div className="rounded-xl border border-border/50 bg-card/80 p-6 shadow-lg backdrop-blur-sm">
            {/* ── Step 1a: API Key intro ── */}
            {step === "api-key-intro" && (
              <div className="flex flex-col gap-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <KeyRound className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">
                      {t("onboarding.apiKeyTitle", "Step 1: Get a Groq API Key")}
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
                    t("onboarding.apiKeyStep3", 'Click "Create API Key", copy the key starting with gsk_'),
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

                <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground" onClick={handleOpenGroqConsole}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {t("onboarding.openGroqConsole", "Open Groq Console")}
                </Button>

                <p className="text-center text-xs text-muted-foreground">
                  {t("onboarding.alreadyHaveKey", "Already have a key?")}
                  {" "}
                  <button className="text-primary hover:underline" onClick={() => setStep("api-key-paste")}>
                    {t("onboarding.pasteItNow", "Paste it now")}
                  </button>
                </p>
              </div>
            )}

            {/* ── Step 1b: Paste API Key ── */}
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
                      {t("onboarding.pasteKeyDescription", "Paste the key you copied from Groq Console")}
                    </p>
                  </div>
                </div>

                <Input
                  type="password"
                  placeholder="gsk_..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleSaveApiKey(); }}
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
                  {t("onboarding.needKey", "Don't have a key yet?")}
                  {" "}
                  <button className="text-primary hover:underline" onClick={() => setStep("api-key-intro")}>
                    {t("onboarding.getOneNow", "Get one now")}
                  </button>
                </p>
              </div>
            )}

            {/* ── Step 2: Hotkey ── */}
            {step === "hotkey" && (
              <div className="flex flex-col gap-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Keyboard className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">
                      {t("onboarding.hotkeyTitle", "Step 2: Hotkey")}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {t("onboarding.hotkeyDescription", "Press and hold the hotkey to record, release to transcribe.")}
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-primary/20 bg-primary/5 p-5 text-center">
                  <div className="inline-flex items-center gap-2 rounded-lg bg-primary/10 px-4 py-2">
                    <Keyboard className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium text-primary">Fn</span>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {t("onboarding.hotkeyHint", "Default: Fn key (macOS) / Right Alt (Windows)")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    {t("onboarding.hotkeyCustomize", "You can customize this later in Settings.")}
                  </p>
                </div>

                <Button className="w-full" onClick={() => setStep("mic-test")}>
                  {t("common.next", "Next")}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
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
                      {t("onboarding.micDescription", "Let's make sure your microphone is working.")}
                    </p>
                  </div>
                </div>

                {micTestPassed ? (
                  <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 p-4">
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium text-primary">
                      {t("onboarding.micSuccess", "Microphone detected!")}
                    </span>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full border-primary/30 hover:bg-primary/5"
                    disabled={isMicTesting}
                    onClick={() => void handleMicTest()}
                  >
                    {isMicTesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <Mic className="mr-2 h-4 w-4" />
                    {t("onboarding.testMic", "Test Microphone")}
                  </Button>
                )}

                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setStep("hotkey")}>
                    {t("common.back", "Back")}
                  </Button>
                  <Button className="flex-1" onClick={() => setStep("done")}>
                    {micTestPassed ? t("common.next", "Next") : t("onboarding.skip", "Skip")}
                  </Button>
                </div>
              </div>
            )}

            {/* Step indicator */}
            {showStepIndicator && (
              <div className="mt-6 flex items-center justify-center gap-1.5">
                {Array.from({ length: 3 }, (_, i) => (
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

        {/* ── Done ── */}
        {step === "done" && (
          <div className="flex flex-col items-center gap-8 text-center">
            <div className="relative">
              <div className="absolute inset-0 animate-pulse rounded-3xl bg-primary/20 blur-xl" />
              <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 backdrop-blur-sm">
                <Sparkles className="h-10 w-10 text-primary" />
              </div>
            </div>

            <div>
              <h2 className="text-3xl font-bold tracking-tight text-foreground">
                {t("onboarding.doneTitle", "You're all set!")}
              </h2>
              <p className="mt-3 text-base text-muted-foreground">
                {t("onboarding.doneDescription", "Press your hotkey anytime to start dictating. TypeLate will transcribe and paste the text automatically.")}
              </p>
              <div className="mt-4 inline-flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{t("onboarding.hotkeyHint", "Default: Fn key")}</span>
                <kbd className="inline-flex h-8 min-w-[2.5rem] items-center justify-center rounded-lg border border-border bg-muted px-3 text-sm font-medium text-foreground shadow-sm">
                  {hotkeyConfig?.triggerKey
                    ? typeof hotkeyConfig.triggerKey === "string"
                      ? t(`settings.hotkey.keys.${hotkeyConfig.triggerKey}`, { defaultValue: hotkeyConfig.triggerKey })
                      : t("settings.hotkey.custom")
                    : "Fn"}
                </kbd>
              </div>
              {slogan && (
                <p className="mt-3 text-sm italic text-primary/70">
                  &ldquo;{slogan}&rdquo;
                </p>
              )}
            </div>

            <Button
              size="lg"
              className="w-full gap-2 text-base"
              onClick={() => void handleComplete()}
            >
              {t("onboarding.startUsing", "Start Using TypeLate")}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
