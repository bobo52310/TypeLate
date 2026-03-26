import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SettingsGroup, SettingsRow, SettingsFeedback } from "@/components/settings-layout";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";

export default function EnhancementSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const isEnhancementThresholdEnabled = useSettingsStore((s) => s.isEnhancementThresholdEnabled);
  const enhancementThresholdCharCount = useSettingsStore((s) => s.enhancementThresholdCharCount);
  const saveEnhancementThreshold = useSettingsStore((s) => s.saveEnhancementThreshold);

  const [thresholdEnabled, setThresholdEnabled] = useState(false);
  const [thresholdCharCount, setThresholdCharCount] = useState(10);

  useEffect(() => {
    setThresholdEnabled(isEnhancementThresholdEnabled);
    setThresholdCharCount(enhancementThresholdCharCount);
  }, [isEnhancementThresholdEnabled, enhancementThresholdCharCount]);

  async function handleToggle() {
    const newValue = !thresholdEnabled;
    setThresholdEnabled(newValue);
    try {
      await saveEnhancementThreshold(newValue, thresholdCharCount);
      feedback.show(
        "success",
        newValue
          ? t("settings.threshold.enabledFeedback")
          : t("settings.threshold.disabledFeedback"),
      );
    } catch (err) {
      setThresholdEnabled(!newValue);
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSaveCharCount() {
    try {
      await saveEnhancementThreshold(thresholdEnabled, thresholdCharCount);
      feedback.show("success", t("settings.threshold.charCountSaved"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <SettingsGroup
      title={t("settings.threshold.title")}
      description={t("settings.threshold.description")}
    >
      <SettingsRow
        label={thresholdEnabled ? t("settings.threshold.enabled") : t("settings.threshold.disabled")}
        htmlFor="threshold-toggle"
      >
        <Switch
          id="threshold-toggle"
          checked={thresholdEnabled}
          onCheckedChange={() => void handleToggle()}
        />
      </SettingsRow>

      {thresholdEnabled && (
        <SettingsRow label={t("settings.threshold.charCount")} htmlFor="threshold-char-count">
          <div className="flex items-center gap-2">
            <Input
              id="threshold-char-count"
              type="number"
              min={1}
              max={1000}
              value={thresholdCharCount}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                if (!Number.isNaN(parsed)) setThresholdCharCount(parsed);
              }}
              className="w-24"
            />
            <Button size="sm" onClick={() => void handleSaveCharCount()}>
              {t("common.save")}
            </Button>
          </div>
        </SettingsRow>
      )}

      <SettingsFeedback message={feedback.message} type={feedback.type} />
    </SettingsGroup>
  );
}
