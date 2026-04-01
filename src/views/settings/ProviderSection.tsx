import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsFeedback } from "@/components/settings-layout";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";
import { PROVIDER_LIST, type ProviderId } from "@/lib/providerConfig";

export default function ProviderSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const selectedProviderId = useSettingsStore((s) => s.selectedProviderId);
  const saveProviderId = useSettingsStore((s) => s.saveProviderId);

  async function handleProviderChange(id: ProviderId) {
    if (id === selectedProviderId) return;
    try {
      await saveProviderId(id);
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
      <div className="space-y-3 px-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          {PROVIDER_LIST.map((provider) => {
            const isSelected = provider.id === selectedProviderId;
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => void handleProviderChange(provider.id)}
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
                  {isSelected && (
                    <span className="h-2 w-2 rounded-full bg-primary" />
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {t(`settings.provider.${provider.id}Description`)}
                </span>
              </button>
            );
          })}
        </div>
        <SettingsFeedback message={feedback.message} type={feedback.type} />
      </div>
    </SettingsGroup>
  );
}
