import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  LANGUAGE_OPTIONS,
  TRANSCRIPTION_LANGUAGE_OPTIONS,
  type SupportedLocale,
  type TranscriptionLocale,
} from "@/i18n/languageConfig";

export default function AppSection() {
  const { t } = useTranslation();
  const localeFeedback = useFeedbackMessage();
  const transcriptionLocaleFeedback = useFeedbackMessage();
  const autoStartFeedback = useFeedbackMessage();

  const selectedLocale = useSettingsStore((s) => s.selectedLocale);
  const selectedTranscriptionLocale = useSettingsStore(
    (s) => s.selectedTranscriptionLocale,
  );
  const isAutoStartEnabled = useSettingsStore((s) => s.isAutoStartEnabled);
  const saveLocale = useSettingsStore((s) => s.saveLocale);
  const saveTranscriptionLocale = useSettingsStore(
    (s) => s.saveTranscriptionLocale,
  );
  const toggleAutoStart = useSettingsStore((s) => s.toggleAutoStart);
  const loadAutoStartStatus = useSettingsStore((s) => s.loadAutoStartStatus);

  const [isTogglingAutoStart, setIsTogglingAutoStart] = useState(false);

  useEffect(() => {
    void loadAutoStartStatus();
  }, [loadAutoStartStatus]);

  async function handleLocaleChange(newLocale: string) {
    try {
      await saveLocale(newLocale as SupportedLocale);
      localeFeedback.show("success", t("settings.app.languageUpdated"));
    } catch (err) {
      localeFeedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handleTranscriptionLocaleChange(newLocale: string) {
    try {
      await saveTranscriptionLocale(newLocale as TranscriptionLocale);
      transcriptionLocaleFeedback.show(
        "success",
        t("settings.app.transcriptionLanguageUpdated"),
      );
    } catch (err) {
      transcriptionLocaleFeedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handleToggleAutoStart() {
    try {
      setIsTogglingAutoStart(true);
      await toggleAutoStart();
      autoStartFeedback.show(
        "success",
        isAutoStartEnabled
          ? t("settings.app.autoStartDisabled")
          : t("settings.app.autoStartEnabled"),
      );
    } catch (err) {
      autoStartFeedback.show(
        "error",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setIsTogglingAutoStart(false);
    }
  }

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="text-base">
          {t("settings.app.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* UI Language */}
        <div className="flex items-center justify-between">
          <Label htmlFor="locale-select">
            {t("settings.app.language")}
          </Label>
          <Select
            value={selectedLocale}
            onValueChange={(val) => void handleLocaleChange(val)}
          >
            <SelectTrigger id="locale-select" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.locale} value={opt.locale}>
                  {opt.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {localeFeedback.message && (
          <p
            className={`text-sm ${
              localeFeedback.type === "success"
                ? "text-green-400"
                : "text-red-400"
            }`}
          >
            {localeFeedback.message}
          </p>
        )}

        {/* Transcription Language */}
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="transcription-locale-select">
              {t("settings.app.transcriptionLanguage")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("settings.app.transcriptionLanguageDescription")}
            </p>
          </div>
          <Select
            value={selectedTranscriptionLocale}
            onValueChange={(val) =>
              void handleTranscriptionLocaleChange(val)
            }
          >
            <SelectTrigger
              id="transcription-locale-select"
              className="w-48"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRANSCRIPTION_LANGUAGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.locale} value={opt.locale}>
                  {opt.locale === "auto"
                    ? t("settings.app.autoDetect")
                    : opt.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {transcriptionLocaleFeedback.message && (
          <p
            className={`text-sm ${
              transcriptionLocaleFeedback.type === "success"
                ? "text-green-400"
                : "text-red-400"
            }`}
          >
            {transcriptionLocaleFeedback.message}
          </p>
        )}

        <div className="border-t border-border" />

        {/* Auto start */}
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="auto-start">
              {t("settings.app.autoStart")}
            </Label>
            <p className="text-sm text-muted-foreground">
              {t("settings.app.autoStartDescription")}
            </p>
          </div>
          <Switch
            id="auto-start"
            checked={isAutoStartEnabled}
            disabled={isTogglingAutoStart}
            onCheckedChange={() => void handleToggleAutoStart()}
          />
        </div>

        {autoStartFeedback.message && (
          <p
            className={`text-sm ${
              autoStartFeedback.type === "success"
                ? "text-green-400"
                : "text-red-400"
            }`}
          >
            {autoStartFeedback.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
