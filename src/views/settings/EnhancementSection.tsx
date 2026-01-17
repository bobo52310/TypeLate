import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";

export default function EnhancementSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const isEnhancementThresholdEnabled = useSettingsStore(
    (s) => s.isEnhancementThresholdEnabled,
  );
  const enhancementThresholdCharCount = useSettingsStore(
    (s) => s.enhancementThresholdCharCount,
  );
  const saveEnhancementThreshold = useSettingsStore(
    (s) => s.saveEnhancementThreshold,
  );

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
      feedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handleSaveCharCount() {
    try {
      await saveEnhancementThreshold(thresholdEnabled, thresholdCharCount);
      feedback.show("success", t("settings.threshold.charCountSaved"));
    } catch (err) {
      feedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="text-base">
          {t("settings.threshold.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("settings.threshold.description")}
        </p>

        <div className="flex items-center justify-between">
          <Label htmlFor="threshold-toggle">
            {thresholdEnabled
              ? t("settings.threshold.enabled")
              : t("settings.threshold.disabled")}
          </Label>
          <Switch
            id="threshold-toggle"
            checked={thresholdEnabled}
            onCheckedChange={() => void handleToggle()}
          />
        </div>

        {thresholdEnabled && (
          <div className="flex items-center gap-3">
            <Label htmlFor="threshold-char-count">
              {t("settings.threshold.charCount")}
            </Label>
            <Input
              id="threshold-char-count"
              type="number"
              min={1}
              value={thresholdCharCount}
              onChange={(e) =>
                setThresholdCharCount(Number(e.target.value))
              }
              className="w-24"
            />
            <Button
              size="sm"
              onClick={() => void handleSaveCharCount()}
            >
              {t("common.save")}
            </Button>
          </div>
        )}

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
