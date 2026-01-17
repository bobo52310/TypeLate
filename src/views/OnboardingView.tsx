import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useSettingsStore } from "@/stores/settingsStore";
import { logError } from "@/lib/logger";
import { Mic, KeyRound, CheckCircle2, ArrowRight, Loader2 } from "lucide-react";

type OnboardingStep = "welcome" | "api-key" | "hotkey" | "mic-test" | "done";

interface OnboardingViewProps {
  onComplete: () => void;
}

export default function OnboardingView({ onComplete }: OnboardingViewProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [micTestPassed, setMicTestPassed] = useState(false);
  const [isMicTesting, setIsMicTesting] = useState(false);

  const saveApiKey = useSettingsStore((s) => s.saveApiKey);
  const hasApiKey = useSettingsStore((s) => s.hasApiKey);

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

  return (
    <div className="flex h-full items-center justify-center bg-background p-8">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          {step === "welcome" && (
            <div className="flex flex-col items-center gap-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                <Mic className="h-8 w-8 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  {t("onboarding.welcomeTitle", "Welcome to SayIt")}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("onboarding.welcomeDescription", "Voice-to-text, right where you type. Let's get you set up in 3 steps.")}
                </p>
              </div>
              <Button className="w-full" onClick={() => setStep("api-key")}>
                {t("onboarding.getStarted", "Get Started")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}

          {step === "api-key" && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <KeyRound className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    {t("onboarding.apiKeyTitle", "Groq API Key")}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {t("onboarding.apiKeyDescription", "SayIt uses Groq for fast transcription. Get a free key at console.groq.com")}
                  </p>
                </div>
              </div>
              <Input
                type="password"
                placeholder="gsk_..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSaveApiKey();
                }}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep("welcome")}>
                  {t("common.back", "Back")}
                </Button>
                <Button
                  className="flex-1"
                  disabled={!apiKeyInput.trim() || isSubmitting}
                  onClick={() => void handleSaveApiKey()}
                >
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t("common.save", "Save")}
                </Button>
              </div>
            </div>
          )}

          {step === "hotkey" && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <KeyRound className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    {t("onboarding.hotkeyTitle", "Hotkey")}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {t("onboarding.hotkeyDescription", "Press and hold the Fn key (or your configured hotkey) to start recording. Release to stop and transcribe.")}
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-muted/50 p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  {t("onboarding.hotkeyHint", "Default: Fn key (macOS) / Right Alt (Windows)")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("onboarding.hotkeyCustomize", "You can customize this later in Settings.")}
                </p>
              </div>
              <Button className="w-full" onClick={() => setStep("mic-test")}>
                {t("common.next", "Next")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}

          {step === "mic-test" && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <Mic className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    {t("onboarding.micTitle", "Microphone")}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {t("onboarding.micDescription", "Let's make sure your microphone is working.")}
                  </p>
                </div>
              </div>
              {micTestPassed ? (
                <div className="flex items-center gap-2 rounded-lg bg-green-500/10 p-3">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  <span className="text-sm text-green-500">
                    {t("onboarding.micSuccess", "Microphone detected!")}
                  </span>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={isMicTesting}
                  onClick={() => void handleMicTest()}
                >
                  {isMicTesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t("onboarding.testMic", "Test Microphone")}
                </Button>
              )}
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep("hotkey")}>
                  {t("common.back", "Back")}
                </Button>
                <Button className="flex-1" onClick={() => setStep("done")}>
                  {micTestPassed
                    ? t("common.next", "Next")
                    : t("onboarding.skip", "Skip")}
                </Button>
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center gap-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-green-500/10">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-foreground">
                  {t("onboarding.doneTitle", "You're all set!")}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("onboarding.doneDescription", "Press your hotkey anytime to start dictating. SayIt will transcribe and paste the text automatically.")}
                </p>
              </div>
              <Button className="w-full" onClick={() => void handleComplete()}>
                {t("onboarding.startUsing", "Start Using SayIt")}
              </Button>
            </div>
          )}

          {/* Step indicator */}
          {step !== "welcome" && step !== "done" && (
            <div className="mt-6 flex justify-center gap-1.5">
              {(["api-key", "hotkey", "mic-test"] as const).map((s) => (
                <div
                  key={s}
                  className={`h-1.5 w-8 rounded-full transition-colors ${
                    s === step ? "bg-primary" : "bg-muted"
                  }`}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
