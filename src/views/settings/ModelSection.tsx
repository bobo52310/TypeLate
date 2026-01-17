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
  LLM_MODEL_LIST,
  WHISPER_MODEL_LIST,
  findLlmModelConfig,
  findWhisperModelConfig,
  type WhisperModelId,
  type LlmModelId,
} from "@/lib/modelRegistry";

export default function ModelSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const selectedWhisperModelId = useSettingsStore(
    (s) => s.selectedWhisperModelId,
  );
  const selectedLlmModelId = useSettingsStore((s) => s.selectedLlmModelId);
  const saveWhisperModel = useSettingsStore((s) => s.saveWhisperModel);
  const saveLlmModel = useSettingsStore((s) => s.saveLlmModel);

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
      feedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handleLlmModelChange(newId: string) {
    try {
      await saveLlmModel(newId as LlmModelId);
      feedback.show("success", t("settings.model.llmUpdated"));
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
          {t("settings.model.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("settings.model.description")}
        </p>

        {/* Whisper model */}
        <div className="space-y-2">
          <Label htmlFor="whisper-model">
            {t("settings.model.whisperLabel")}
          </Label>
          <Select
            value={selectedWhisperModelId}
            onValueChange={(val) => void handleWhisperModelChange(val)}
          >
            <SelectTrigger id="whisper-model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WHISPER_MODEL_LIST.map((model) => (
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
          <p className="text-xs text-muted-foreground">
            {whisperModelDescription}
          </p>
        </div>

        {/* LLM model */}
        <div className="space-y-2">
          <Label htmlFor="llm-model">
            {t("settings.model.llmLabel")}
          </Label>
          <Select
            value={selectedLlmModelId}
            onValueChange={(val) => void handleLlmModelChange(val)}
          >
            <SelectTrigger id="llm-model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LLM_MODEL_LIST.map((model) => (
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
            {llmModelDescription}
          </p>
        </div>

        {feedback.message && (
          <p
            className={`text-sm ${
              feedback.type === "success"
                ? "text-primary"
                : "text-destructive"
            }`}
          >
            {feedback.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
