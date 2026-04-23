import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsFeedback } from "@/components/settings-layout";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";
import {
  getTranscriptionProviders,
  getLlmProviders,
  type LlmProviderId,
  type ProviderConfig,
  type TranscriptionProviderId,
} from "@/lib/providerConfig";

export default function ProviderSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const selectedTranscriptionProviderId = useSettingsStore(
    (s) => s.selectedTranscriptionProviderId,
  );
  const selectedLlmProviderId = useSettingsStore((s) => s.selectedLlmProviderId);
  const saveTranscriptionProviderId = useSettingsStore((s) => s.saveTranscriptionProviderId);
  const saveLlmProviderId = useSettingsStore((s) => s.saveLlmProviderId);

  async function handleTranscriptionChange(id: TranscriptionProviderId) {
    if (id === selectedTranscriptionProviderId) return;
    try {
      await saveTranscriptionProviderId(id);
      feedback.show("success", t("settings.provider.updated"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleLlmChange(id: LlmProviderId) {
    if (id === selectedLlmProviderId) return;
    try {
      await saveLlmProviderId(id);
      feedback.show("success", t("settings.provider.updated"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <SettingsGroup
      title={t("settings.provider.title")}
      description={t("settings.provider.description")}
    >
      <div className="space-y-4 px-4 py-3">
        <ProviderGrid
          label={t("settings.provider.transcriptionLabel")}
          providers={getTranscriptionProviders()}
          selectedId={selectedTranscriptionProviderId}
          onSelect={(id) => void handleTranscriptionChange(id as TranscriptionProviderId)}
        />
        <ProviderGrid
          label={t("settings.provider.llmLabel")}
          providers={getLlmProviders()}
          selectedId={selectedLlmProviderId}
          onSelect={(id) => void handleLlmChange(id)}
        />
        <SettingsFeedback message={feedback.message} type={feedback.type} />
      </div>
    </SettingsGroup>
  );
}

function ProviderGrid({
  label,
  providers,
  selectedId,
  onSelect,
}: {
  label: string;
  providers: ProviderConfig[];
  selectedId: string;
  onSelect: (id: LlmProviderId) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {providers.map((provider) => {
          const isSelected = provider.id === selectedId;
          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => onSelect(provider.id)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40 hover:bg-muted/30",
              )}
            >
              <div className="flex w-full items-center justify-between">
                <span
                  className={cn(
                    "text-sm font-medium",
                    isSelected ? "text-primary" : "text-foreground",
                  )}
                >
                  {provider.displayName}
                </span>
                {isSelected && <span className="h-2 w-2 rounded-full bg-primary" />}
              </div>
              <span className="text-xs text-muted-foreground">
                {t(`settings.provider.${provider.id}Description`)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
