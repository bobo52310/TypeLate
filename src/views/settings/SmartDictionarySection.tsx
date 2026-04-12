import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsGroup, SettingsRow, SettingsFeedback } from "@/components/settings-layout";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";
import {
  VOCABULARY_ANALYSIS_MODEL_LIST,
  findVocabularyAnalysisModelConfig,
  type VocabularyAnalysisModelId,
} from "@/lib/modelRegistry";

export default function SmartDictionarySection({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const isSmartDictionaryEnabled = useSettingsStore((s) => s.isSmartDictionaryEnabled);
  const selectedVocabularyAnalysisModelId = useSettingsStore(
    (s) => s.selectedVocabularyAnalysisModelId,
  );
  const saveSmartDictionaryEnabled = useSettingsStore((s) => s.saveSmartDictionaryEnabled);
  const saveVocabularyAnalysisModel = useSettingsStore((s) => s.saveVocabularyAnalysisModel);

  const vocabularyAnalysisModelDescription = useMemo(() => {
    const config = findVocabularyAnalysisModelConfig(selectedVocabularyAnalysisModelId);
    if (!config) return "";
    return `${config.speedTps} TPS · $${config.inputCostPerMillion}/$${config.outputCostPerMillion} per M tokens`;
  }, [selectedVocabularyAnalysisModelId]);

  async function handleToggle(newValue: boolean) {
    try {
      await saveSmartDictionaryEnabled(newValue);
      feedback.show("success", t("common.save"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleModelChange(newId: string) {
    try {
      await saveVocabularyAnalysisModel(newId as VocabularyAnalysisModelId);
      feedback.show("success", t("settings.smartDictionary.analysisModelUpdated"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  if (embedded) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t("settings.smartDictionary.description")}
        </p>

        {/* Toggle */}
        <div className="flex items-center justify-between">
          <label htmlFor="smart-dictionary-toggle" className="text-sm font-medium">
            {t("settings.smartDictionary.enableToggle")}
          </label>
          <Switch
            id="smart-dictionary-toggle"
            checked={isSmartDictionaryEnabled}
            onCheckedChange={(val) => void handleToggle(val)}
          />
        </div>

        {/* Model selector — stacked */}
        {isSmartDictionaryEnabled && (
          <div className="space-y-2 rounded-lg bg-muted/50 p-3">
            <label htmlFor="vocabulary-analysis-model" className="text-sm font-medium">
              {t("settings.smartDictionary.analysisModelLabel")}
            </label>
            <Select
              value={selectedVocabularyAnalysisModelId}
              onValueChange={(val) => void handleModelChange(val)}
            >
              <SelectTrigger id="vocabulary-analysis-model" className="w-full">
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
              {vocabularyAnalysisModelDescription}
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {t("settings.smartDictionary.privacyNote")}
        </p>

        <SettingsFeedback message={feedback.message} type={feedback.type} />
      </div>
    );
  }

  const content = (
    <>
      <SettingsRow
        label={t("settings.smartDictionary.title")}
        htmlFor="smart-dictionary-toggle"
      >
        <Switch
          id="smart-dictionary-toggle"
          checked={isSmartDictionaryEnabled}
          onCheckedChange={(val) => void handleToggle(val)}
        />
      </SettingsRow>

      {/* Vocabulary analysis model */}
      {isSmartDictionaryEnabled && (
        <SettingsRow
          label={t("settings.smartDictionary.analysisModelLabel")}
          description={`${t("settings.smartDictionary.analysisModelDescription")} · ${vocabularyAnalysisModelDescription}`}
          htmlFor="vocabulary-analysis-model"
        >
          <Select
            value={selectedVocabularyAnalysisModelId}
            onValueChange={(val) => void handleModelChange(val)}
          >
            <SelectTrigger id="vocabulary-analysis-model" className="w-56">
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
        </SettingsRow>
      )}

      <div className="px-4 py-2">
        <p className="text-xs text-muted-foreground">{t("settings.smartDictionary.privacyNote")}</p>
      </div>

      <SettingsFeedback message={feedback.message} type={feedback.type} />
    </>
  );

  return (
    <SettingsGroup
      title={t("settings.smartDictionary.title")}
      description={t("settings.smartDictionary.description")}
    >
      {content}
    </SettingsGroup>
  );
}
