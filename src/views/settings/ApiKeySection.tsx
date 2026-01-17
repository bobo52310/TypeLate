import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";

export default function ApiKeySection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const hasApiKey = useSettingsStore((s) => s.hasApiKey);
  const saveApiKey = useSettingsStore((s) => s.saveApiKey);
  const deleteApiKey = useSettingsStore((s) => s.deleteApiKey);
  const getApiKey = useSettingsStore((s) => s.getApiKey);

  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const deleteConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const apiKeyStatusLabel = hasApiKey
    ? t("settings.apiKey.set")
    : t("settings.apiKey.notSet");
  const apiKeyStatusClass = hasApiKey
    ? "bg-green-500/20 text-green-400"
    : "bg-red-500/20 text-red-400";
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
      feedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
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
      feedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between border-b border-border">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Groq API Key</CardTitle>
          <Badge className={cn("border-0", apiKeyStatusClass)}>
            {apiKeyStatusLabel}
          </Badge>
        </div>
        <a
          href="https://console.groq.com/keys"
          target="_blank"
          rel="noreferrer"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("settings.apiKey.goToConsole")} &rarr;
        </a>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("settings.apiKey.instruction")}
        </p>

        {shouldShowOnboardingHint && (
          <p className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-200">
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
              {isApiKeyVisible
                ? t("settings.apiKey.hide")
                : t("settings.apiKey.show")}
            </Button>
          </div>
          <Button
            disabled={isSubmitting}
            onClick={() => void handleSaveApiKey()}
          >
            {t("common.save")}
          </Button>
        </div>

        <div className="flex items-center justify-between">
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

          {hasApiKey && (
            <Button
              variant="outline"
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
      </CardContent>
    </Card>
  );
}
