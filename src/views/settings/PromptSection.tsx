import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wand2, AlignLeft, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsRow, SettingsFeedback } from "@/components/settings-layout";
import { useSettingsStore } from "@/stores/settingsStore";
import { isKnownDefaultPrompt } from "@/i18n/prompts";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";

type PromptMode = "none" | "minimal" | "active" | "custom";
type AiMode = Exclude<PromptMode, "none">;

const AI_MODES: { value: AiMode; labelKey: string; descKey: string; icon: typeof Wand2 }[] = [
  {
    value: "minimal",
    labelKey: "settings.prompt.modeMinimal",
    descKey: "settings.prompt.modeMinimalDescription",
    icon: Wand2,
  },
  {
    value: "active",
    labelKey: "settings.prompt.modeActive",
    descKey: "settings.prompt.modeActiveDescription",
    icon: AlignLeft,
  },
  {
    value: "custom",
    labelKey: "settings.prompt.modeCustom",
    descKey: "settings.prompt.modeCustomDescription",
    icon: PenLine,
  },
];

export default function PromptSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const promptMode = useSettingsStore((s) => s.promptMode);
  const getAiPrompt = useSettingsStore((s) => s.getAiPrompt);
  const saveAiPrompt = useSettingsStore((s) => s.saveAiPrompt);
  const savePromptMode = useSettingsStore((s) => s.savePromptMode);
  const resetAiPrompt = useSettingsStore((s) => s.resetAiPrompt);

  const [selectedPromptMode, setSelectedPromptMode] = useState<PromptMode>("minimal");
  const [promptInput, setPromptInput] = useState("");
  const [lastSavedPrompt, setLastSavedPrompt] = useState("");
  const [isPresetDirty, setIsPresetDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const resetConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const mode = promptMode as PromptMode;
    setSelectedPromptMode(mode);
    const currentPrompt = getAiPrompt();
    if (mode === "custom" && isKnownDefaultPrompt(currentPrompt)) {
      setPromptInput("");
      setLastSavedPrompt("");
    } else {
      setPromptInput(currentPrompt);
      setLastSavedPrompt(currentPrompt);
    }
    setIsPresetDirty(false);
  }, [promptMode, getAiPrompt]);

  useEffect(() => {
    return () => clearTimeout(resetConfirmTimeoutRef.current);
  }, []);

  async function handlePromptModeChange(mode: PromptMode) {
    const previousMode = selectedPromptMode;
    setSelectedPromptMode(mode);
    try {
      await savePromptMode(mode);
      if (mode === "custom") {
        setPromptInput("");
        setLastSavedPrompt("");
      } else if (mode !== "none") {
        const currentPrompt = getAiPrompt();
        setPromptInput(currentPrompt);
        setLastSavedPrompt(currentPrompt);
      }
      setIsPresetDirty(false);
    } catch (err) {
      setSelectedPromptMode(previousMode);
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  function handleAiToggle(checked: boolean) {
    void handlePromptModeChange(checked ? "minimal" : "none");
  }

  function handlePromptInput(value: string) {
    setPromptInput(value);
    if (selectedPromptMode !== "custom" && !isPresetDirty) {
      setIsPresetDirty(true);
    }
  }

  async function handleSavePrompt() {
    const wasModeSwitch = selectedPromptMode !== "custom" && isPresetDirty;
    const previousMode = selectedPromptMode;
    try {
      setIsSubmitting(true);
      if (wasModeSwitch) {
        await savePromptMode("custom");
        setSelectedPromptMode("custom");
        setIsPresetDirty(false);
      }
      await saveAiPrompt(promptInput);
      setLastSavedPrompt(promptInput);
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
      feedback.show("error", err instanceof Error ? err.message : String(err));
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
      const currentPrompt = getAiPrompt();
      setPromptInput(currentPrompt);
      setLastSavedPrompt(currentPrompt);
      setIsPresetDirty(false);
      feedback.show("success", t("settings.prompt.resetDone"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  const isAiEnabled = selectedPromptMode !== "none";
  const hasUnsavedChanges =
    selectedPromptMode === "custom"
      ? promptInput.trim() !== "" && promptInput.trim() !== lastSavedPrompt.trim()
      : isPresetDirty;
  const isSaveDisabled = isSubmitting || !hasUnsavedChanges;

  return (
    <SettingsGroup title={t("settings.prompt.title")}>
      <SettingsRow
        label={t("settings.prompt.aiToggle")}
        description={t("settings.prompt.aiToggleDescription")}
        htmlFor="ai-enhance-toggle"
      >
        <Switch
          id="ai-enhance-toggle"
          checked={isAiEnabled}
          onCheckedChange={handleAiToggle}
        />
      </SettingsRow>

      {isAiEnabled && (
        <div className="space-y-4 px-4 py-3">
          {/* Mode cards */}
          <div className="grid grid-cols-3 gap-2">
            {AI_MODES.map((mode) => {
              const Icon = mode.icon;
              const isSelected = selectedPromptMode === mode.value;
              return (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => void handlePromptModeChange(mode.value)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-center transition-colors",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-5",
                      isSelected ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span className="text-sm font-medium">{t(mode.labelKey)}</span>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {t(mode.descKey)}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Prompt editor */}
          <Textarea
            value={promptInput}
            onChange={(e) => handlePromptInput(e.target.value)}
            placeholder={
              selectedPromptMode === "custom"
                ? t("settings.prompt.customPlaceholder")
                : undefined
            }
            className="min-h-[120px] font-mono"
          />

          <div className="flex justify-end gap-2">
            <Button disabled={isSaveDisabled} onClick={() => void handleSavePrompt()}>
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
        </div>
      )}

      <SettingsFeedback message={feedback.message} type={feedback.type} />
    </SettingsGroup>
  );
}
