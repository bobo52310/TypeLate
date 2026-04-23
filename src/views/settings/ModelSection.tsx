import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
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
  getWhisperModelsForProvider,
  getLlmModelsForProvider,
  findLlmModelConfig,
  findWhisperModelConfig,
  type WhisperModelId,
  type LlmModelId,
} from "@/lib/modelRegistry";

export default function ModelSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const selectedTranscriptionProviderId = useSettingsStore(
    (s) => s.selectedTranscriptionProviderId,
  );
  const selectedLlmProviderId = useSettingsStore((s) => s.selectedLlmProviderId);
  const selectedWhisperModelId = useSettingsStore((s) => s.selectedWhisperModelId);
  const selectedLlmModelId = useSettingsStore((s) => s.selectedLlmModelId);
  const saveWhisperModel = useSettingsStore((s) => s.saveWhisperModel);
  const saveLlmModel = useSettingsStore((s) => s.saveLlmModel);

  const whisperModels = useMemo(
    () => getWhisperModelsForProvider(selectedTranscriptionProviderId),
    [selectedTranscriptionProviderId],
  );
  const llmModels = useMemo(
    () => getLlmModelsForProvider(selectedLlmProviderId),
    [selectedLlmProviderId],
  );

  const whisperModelDescription = useMemo(() => {
    const config = findWhisperModelConfig(selectedWhisperModelId);
    if (!config) return "";
    return t("settings.model.costPerHour", { cost: config.costPerHour });
  }, [selectedWhisperModelId, t]);

  const llmModelDescription = useMemo(() => {
    const config = findLlmModelConfig(selectedLlmModelId);
    if (!config) return "";
    return `${config.speedTps} TPS · $${config.inputCostPerMillion}/$${config.outputCostPerMillion} per M tokens`;
  }, [selectedLlmModelId]);

  async function handleWhisperModelChange(newId: string) {
    try {
      await saveWhisperModel(newId as WhisperModelId);
      feedback.show("success", t("settings.model.whisperUpdated"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleLlmModelChange(newId: string) {
    try {
      await saveLlmModel(newId as LlmModelId);
      feedback.show("success", t("settings.model.llmUpdated"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <SettingsGroup
      title={t("settings.model.title")}
      description={t("settings.model.description")}
    >
      {/* Whisper model */}
      <SettingsRow
        label={t("settings.model.whisperLabel")}
        description={whisperModelDescription}
        htmlFor="whisper-model"
      >
        <Select
          value={selectedWhisperModelId}
          onValueChange={(val) => void handleWhisperModelChange(val)}
        >
          <SelectTrigger id="whisper-model" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {whisperModels.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                <span className="flex items-center gap-2">
                  {model.displayName}
                  {model.isDefault && (
                    <Badge variant="secondary" className="text-xs">
                      {t("settings.model.default")}
                    </Badge>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      {/* LLM model */}
      <SettingsRow
        label={t("settings.model.llmLabel")}
        description={llmModelDescription}
        htmlFor="llm-model"
      >
        <Select
          value={selectedLlmModelId}
          onValueChange={(val) => void handleLlmModelChange(val)}
        >
          <SelectTrigger id="llm-model" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {llmModels.map((model) => (
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

      <SettingsFeedback message={feedback.message} type={feedback.type} />
    </SettingsGroup>
  );
}
