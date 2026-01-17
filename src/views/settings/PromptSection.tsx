import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";

type PromptMode = "minimal" | "active" | "custom";

export default function PromptSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const promptMode = useSettingsStore((s) => s.promptMode);
  const getAiPrompt = useSettingsStore((s) => s.getAiPrompt);
  const saveAiPrompt = useSettingsStore((s) => s.saveAiPrompt);
  const savePromptMode = useSettingsStore((s) => s.savePromptMode);
  const resetAiPrompt = useSettingsStore((s) => s.resetAiPrompt);

  const [selectedPromptMode, setSelectedPromptMode] =
    useState<PromptMode>("minimal");
  const [promptInput, setPromptInput] = useState("");
  const [isPresetDirty, setIsPresetDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const resetConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setSelectedPromptMode(promptMode as PromptMode);
    setPromptInput(getAiPrompt());
    setIsPresetDirty(false);
  }, [promptMode, getAiPrompt]);

  useEffect(() => {
    return () => clearTimeout(resetConfirmTimeoutRef.current);
  }, []);

  async function handlePromptModeChange(mode: string) {
    const newMode = mode as PromptMode;
    const previousMode = selectedPromptMode;
    setSelectedPromptMode(newMode);
    try {
      await savePromptMode(newMode);
      setPromptInput(getAiPrompt());
      setIsPresetDirty(false);
    } catch (err) {
      setSelectedPromptMode(previousMode);
      feedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  function handlePromptInput(value: string) {
    setPromptInput(value);
    if (selectedPromptMode !== "custom" && !isPresetDirty) {
      setIsPresetDirty(true);
    }
  }

  async function handleSavePrompt() {
    const wasModeSwitch =
      selectedPromptMode !== "custom" && isPresetDirty;
    const previousMode = selectedPromptMode;
    try {
      setIsSubmitting(true);
      if (wasModeSwitch) {
        await savePromptMode("custom");
        setSelectedPromptMode("custom");
        setIsPresetDirty(false);
      }
      await saveAiPrompt(promptInput);
      feedback.show("success", t("settings.prompt.saved"));
    } catch (err) {
      if (wasModeSwitch) {
        try {
          await savePromptMode(previousMode);
        } catch {
          /* best-effort rollback */
        }
        setSelectedPromptMode(previousMode);
      }
      feedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function requestResetPrompt() {
    if (!isConfirmingReset) {
      setIsConfirmingReset(true);
      resetConfirmTimeoutRef.current = setTimeout(() => {
        setIsConfirmingReset(false);
      }, 3000);
      return;
    }
    clearTimeout(resetConfirmTimeoutRef.current);
    setIsConfirmingReset(false);
    void handleResetPrompt();
  }

  async function handleResetPrompt() {
    try {
      setIsSubmitting(true);
      await resetAiPrompt();
      setSelectedPromptMode("minimal");
      setPromptInput(getAiPrompt());
      setIsPresetDirty(false);
      feedback.show("success", t("settings.prompt.resetDone"));
    } catch (err) {
      feedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const modes: { value: PromptMode; labelKey: string; descKey: string }[] = [
    {
      value: "minimal",
      labelKey: "settings.prompt.modeMinimal",
      descKey: "settings.prompt.modeMinimalDescription",
    },
    {
      value: "active",
      labelKey: "settings.prompt.modeActive",
      descKey: "settings.prompt.modeActiveDescription",
    },
    {
      value: "custom",
      labelKey: "settings.prompt.modeCustom",
      descKey: "settings.prompt.modeCustomDescription",
    },
  ];

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="text-base">
          {t("settings.prompt.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("settings.prompt.description")}
        </p>

        {/* Mode selector */}
        <div className="space-y-2">
          <Label>{t("settings.prompt.modeTitle")}</Label>
          <RadioGroup
            value={selectedPromptMode}
            onValueChange={(val) => void handlePromptModeChange(val)}
            className="grid grid-cols-3 gap-2"
          >
            {modes.map((mode) => (
              <Label
                key={mode.value}
                htmlFor={`mode-${mode.value}`}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-3 transition-colors",
                  selectedPromptMode === mode.value
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/50",
                )}
              >
                <RadioGroupItem
                  id={`mode-${mode.value}`}
                  value={mode.value}
                  className="!size-0 !border-0 !shadow-none overflow-hidden"
                />
                <div>
                  <span className="text-sm font-medium">
                    {t(mode.labelKey)}
                  </span>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t(mode.descKey)}
                  </p>
                </div>
              </Label>
            ))}
          </RadioGroup>
        </div>

        <Textarea
          value={promptInput}
          onChange={(e) => handlePromptInput(e.target.value)}
          className="min-h-[120px] font-mono"
        />

        <div className="flex justify-end gap-2">
          <Button
            disabled={
              isSubmitting ||
              (selectedPromptMode !== "custom" && !isPresetDirty)
            }
            onClick={() => void handleSavePrompt()}
          >
            {t("common.save")}
          </Button>
          <Button
            variant="outline"
            className={cn(
              isConfirmingReset &&
                "border-destructive text-destructive hover:bg-destructive/10",
            )}
            disabled={isSubmitting}
            onClick={requestResetPrompt}
          >
            {isConfirmingReset
              ? t("settings.prompt.confirmReset")
              : t("settings.prompt.reset")}
          </Button>
        </div>

        {feedback.message && (
          <p
            className={`text-sm ${
              feedback.type === "success"
                ? "text-green-400"
                : "text-red-400"
            }`}
          >
            {feedback.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
