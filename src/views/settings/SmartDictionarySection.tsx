import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";
import {
  VOCABULARY_ANALYSIS_MODEL_LIST,
  findVocabularyAnalysisModelConfig,
} from "@/lib/modelRegistry";

export default function SmartDictionarySection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const isSmartDictionaryEnabled = useSettingsStore(
    (s) => s.isSmartDictionaryEnabled,
  );
  const selectedVocabularyAnalysisModelId = useSettingsStore(
    (s) => s.selectedVocabularyAnalysisModelId,
  );
  const saveSmartDictionaryEnabled = useSettingsStore(
    (s) => s.saveSmartDictionaryEnabled,
  );
  const saveVocabularyAnalysisModel = useSettingsStore(
    (s) => s.saveVocabularyAnalysisModel,
  );

  const vocabularyAnalysisModelDescription = useMemo(() => {
    const config = findVocabularyAnalysisModelConfig(
      selectedVocabularyAnalysisModelId,
    );
    if (!config) return "";
    return `${config.speedTps} TPS · $${config.inputCostPerMillion}/$${config.outputCostPerMillion} per M tokens`;
  }, [selectedVocabularyAnalysisModelId]);

  async function handleToggle(newValue: boolean) {
    try {
      await saveSmartDictionaryEnabled(newValue);
      feedback.show("success", t("common.save"));
    } catch (err) {
      feedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handleModelChange(newId: string) {
    try {
      await saveVocabularyAnalysisModel(newId);
      feedback.show(
        "success",
        t("settings.smartDictionary.analysisModelUpdated"),
      );
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
          {t("settings.smartDictionary.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("settings.smartDictionary.description")}
        </p>

        <div className="flex items-center justify-between">
          <Label htmlFor="smart-dictionary-toggle">
            {t("settings.smartDictionary.title")}
          </Label>
          <Switch
            id="smart-dictionary-toggle"
            checked={isSmartDictionaryEnabled}
            onCheckedChange={(val) => void handleToggle(val)}
          />
        </div>

        {/* Vocabulary analysis model */}
        {isSmartDictionaryEnabled && (
          <div className="space-y-2">
            <Label htmlFor="vocabulary-analysis-model">
              {t("settings.smartDictionary.analysisModelLabel")}
            </Label>
            <Select
              value={selectedVocabularyAnalysisModelId}
              onValueChange={(val) => void handleModelChange(val)}
            >
              <SelectTrigger
                id="vocabulary-analysis-model"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOCABULARY_ANALYSIS_MODEL_LIST.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    <span className="flex items-center gap-2">
                      {model.displayName}
                      <Badge variant="secondary" className="text-xs">
                        {t(model.badgeKey)}
                      </Badge>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("settings.smartDictionary.analysisModelDescription")}
            </p>
            <p className="text-xs text-muted-foreground">
              {vocabularyAnalysisModelDescription}
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {t("settings.smartDictionary.privacyNote")}
        </p>

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
