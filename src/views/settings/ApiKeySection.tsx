import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsFeedback } from "@/components/settings-layout";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";

export default function ApiKeySection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const hasApiKey = useSettingsStore((s) => s.hasApiKey());
  const saveApiKey = useSettingsStore((s) => s.saveApiKey);
  const deleteApiKey = useSettingsStore((s) => s.deleteApiKey);
  const getApiKey = useSettingsStore((s) => s.getApiKey);

  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const deleteConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const apiKeyStatusLabel = hasApiKey ? t("settings.apiKey.set") : t("settings.apiKey.notSet");
  const apiKeyStatusClass = hasApiKey
    ? "bg-primary/20 text-primary"
    : "bg-destructive/20 text-destructive";
  const shouldShowOnboardingHint = !hasApiKey;

  useEffect(() => {
    if (hasApiKey) {
      setApiKeyInput(getApiKey());
    }
  }, [hasApiKey, getApiKey]);

  useEffect(() => {
    return () => {
      clearTimeout(deleteConfirmTimeoutRef.current);
    };
  }, []);

  async function handleSaveApiKey() {
    try {
      setIsSubmitting(true);
      await saveApiKey(apiKeyInput);
      setIsApiKeyVisible(false);
      feedback.show("success", t("settings.apiKey.saved"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  function requestDeleteApiKey() {
    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      deleteConfirmTimeoutRef.current = setTimeout(() => {
        setIsConfirmingDelete(false);
      }, 3000);
      return;
    }
    clearTimeout(deleteConfirmTimeoutRef.current);
    setIsConfirmingDelete(false);
    void handleDeleteApiKey();
  }

  async function handleDeleteApiKey() {
    try {
      setIsSubmitting(true);
      await deleteApiKey();
      setApiKeyInput("");
      setIsApiKeyVisible(false);
      feedback.show("success", t("settings.apiKey.deleted"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SettingsGroup title="Groq API Key">
      <div className="space-y-3 px-4 py-3">
        <div className="flex items-center justify-between">
          <Badge className={cn("border-0", apiKeyStatusClass)}>{apiKeyStatusLabel}</Badge>
          <a
            href="https://console.groq.com/keys"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("settings.apiKey.goToConsole")} &rarr;
          </a>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("settings.apiKey.instruction")}
        </p>

        {shouldShowOnboardingHint && (
          <p className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
            {t("settings.apiKey.onboarding")}
          </p>
        )}

        <div className="flex gap-2">
          <div className="flex flex-1 gap-2">
            <Input
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              type={isApiKeyVisible ? "text" : "password"}
              placeholder="gsk_..."
              autoComplete="off"
              className="flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setIsApiKeyVisible(!isApiKeyVisible)}
            >
              {isApiKeyVisible ? t("settings.apiKey.hide") : t("settings.apiKey.show")}
            </Button>
          </div>
          <Button disabled={isSubmitting} onClick={() => void handleSaveApiKey()}>
            {t("common.save")}
          </Button>
        </div>

        <div className="flex items-center justify-between">
          <SettingsFeedback message={feedback.message} type={feedback.type} className="px-0" />
          {hasApiKey && (
            <Button
              variant="outline"
              size="sm"
              className={cn(
                isConfirmingDelete
                  ? "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "border-destructive text-destructive hover:bg-destructive/10",
              )}
              disabled={isSubmitting}
              onClick={requestDeleteApiKey}
            >
              {isConfirmingDelete
                ? t("settings.apiKey.confirmDelete")
                : t("settings.apiKey.delete")}
            </Button>
          )}
        </div>
      </div>
    </SettingsGroup>
  );
}
