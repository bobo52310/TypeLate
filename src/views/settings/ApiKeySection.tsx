import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsFeedback } from "@/components/settings-layout";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";
import {
  getProviderConfig,
  type LlmProviderId,
  type ProviderConfig,
} from "@/lib/providerConfig";

export default function ApiKeySection() {
  const { t } = useTranslation();

  const selectedTranscriptionProviderId = useSettingsStore(
    (s) => s.selectedTranscriptionProviderId,
  );
  const selectedLlmProviderId = useSettingsStore((s) => s.selectedLlmProviderId);

  // Deduplicated union of providers that need a key right now.
  const activeProviders = useMemo(() => {
    const ids: LlmProviderId[] = [];
    if (!ids.includes(selectedTranscriptionProviderId)) {
      ids.push(selectedTranscriptionProviderId);
    }
    if (!ids.includes(selectedLlmProviderId)) {
      ids.push(selectedLlmProviderId);
    }
    return ids.map((id) => getProviderConfig(id));
  }, [selectedTranscriptionProviderId, selectedLlmProviderId]);

  return (
    <SettingsGroup title={t("settings.apiKeys.title")}>
      <div className="space-y-4 px-4 py-3">
        {activeProviders.map((providerConfig) => (
          <ProviderKeyRow
            key={providerConfig.id}
            providerConfig={providerConfig}
            purposeLabels={getPurposeLabelsFor(
              providerConfig.id,
              selectedTranscriptionProviderId,
              selectedLlmProviderId,
              t,
            )}
          />
        ))}
      </div>
    </SettingsGroup>
  );
}

function getPurposeLabelsFor(
  providerId: LlmProviderId,
  transcriptionId: LlmProviderId,
  llmId: LlmProviderId,
  t: (key: string) => string,
): string[] {
  const labels: string[] = [];
  if (providerId === transcriptionId) labels.push(t("settings.provider.transcriptionLabel"));
  if (providerId === llmId) labels.push(t("settings.provider.llmLabel"));
  return labels;
}

function ProviderKeyRow({
  providerConfig,
  purposeLabels,
}: {
  providerConfig: ProviderConfig;
  purposeLabels: string[];
}) {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const storedKey = useSettingsStore((s) => s.apiKeys[providerConfig.id]);
  const saveApiKey = useSettingsStore((s) => s.saveApiKey);
  const deleteApiKey = useSettingsStore((s) => s.deleteApiKey);

  const hasKey = storedKey !== "";
  const statusLabel = hasKey ? t("settings.apiKey.set") : t("settings.apiKey.notSet");
  const statusClass = hasKey ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive";

  const [input, setInput] = useState(storedKey);
  const [isVisible, setIsVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const deleteConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setInput(storedKey);
  }, [storedKey, providerConfig.id]);

  useEffect(() => {
    setIsConfirmingDelete(false);
    setIsVisible(false);
  }, [providerConfig.id]);

  useEffect(() => {
    return () => {
      clearTimeout(deleteConfirmTimeoutRef.current);
    };
  }, []);

  async function handleSave() {
    try {
      setIsSubmitting(true);
      await saveApiKey(providerConfig.id, input);
      setIsVisible(false);
      feedback.show("success", t("settings.apiKey.saved"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  function requestDelete() {
    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      deleteConfirmTimeoutRef.current = setTimeout(() => {
        setIsConfirmingDelete(false);
      }, 3000);
      return;
    }
    clearTimeout(deleteConfirmTimeoutRef.current);
    setIsConfirmingDelete(false);
    void handleDelete();
  }

  async function handleDelete() {
    try {
      setIsSubmitting(true);
      await deleteApiKey(providerConfig.id);
      setInput("");
      setIsVisible(false);
      feedback.show("success", t("settings.apiKey.deleted"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{providerConfig.displayName}</span>
          <Badge className={cn("border-0", statusClass)}>{statusLabel}</Badge>
          {purposeLabels.map((label) => (
            <Badge key={label} variant="outline" className="text-[10px]">
              {label}
            </Badge>
          ))}
        </div>
        <a
          href={providerConfig.consoleUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("settings.apiKey.goToConsoleTemplate", { provider: providerConfig.displayName })}
          {" →"}
        </a>
      </div>

      <div className="flex gap-2">
        <div className="flex flex-1 gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            type={isVisible ? "text" : "password"}
            placeholder={providerConfig.keyPlaceholder}
            autoComplete="off"
            className="flex-1"
          />
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => setIsVisible(!isVisible)}
          >
            {isVisible ? t("settings.apiKey.hide") : t("settings.apiKey.show")}
          </Button>
        </div>
        <Button disabled={isSubmitting} onClick={() => void handleSave()}>
          {t("common.save")}
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <SettingsFeedback message={feedback.message} type={feedback.type} className="px-0" />
        {hasKey && (
          <Button
            variant="outline"
            size="sm"
            className={cn(
              isConfirmingDelete
                ? "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "border-destructive text-destructive hover:bg-destructive/10",
            )}
            disabled={isSubmitting}
            onClick={requestDelete}
          >
            {isConfirmingDelete
              ? t("settings.apiKey.confirmDelete")
              : t("settings.apiKey.delete")}
          </Button>
        )}
      </div>
    </div>
  );
}
