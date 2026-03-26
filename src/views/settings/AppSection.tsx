import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  LANGUAGE_OPTIONS,
  TRANSCRIPTION_LANGUAGE_OPTIONS,
  type SupportedLocale,
  type TranscriptionLocale,
} from "@/i18n/languageConfig";

export default function AppSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const selectedLocale = useSettingsStore((s) => s.selectedLocale);
  const selectedTranscriptionLocale = useSettingsStore((s) => s.selectedTranscriptionLocale);
  const isAutoStartEnabled = useSettingsStore((s) => s.isAutoStartEnabled);
  const saveLocale = useSettingsStore((s) => s.saveLocale);
  const saveTranscriptionLocale = useSettingsStore((s) => s.saveTranscriptionLocale);
  const toggleAutoStart = useSettingsStore((s) => s.toggleAutoStart);
  const loadAutoStartStatus = useSettingsStore((s) => s.loadAutoStartStatus);

  const [isTogglingAutoStart, setIsTogglingAutoStart] = useState(false);

  useEffect(() => {
    void loadAutoStartStatus();
  }, [loadAutoStartStatus]);

  async function handleLocaleChange(newLocale: string) {
    try {
      await saveLocale(newLocale as SupportedLocale);
      feedback.show("success", t("settings.app.languageUpdated"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleTranscriptionLocaleChange(newLocale: string) {
    try {
      await saveTranscriptionLocale(newLocale as TranscriptionLocale);
      feedback.show("success", t("settings.app.transcriptionLanguageUpdated"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleToggleAutoStart() {
    try {
      setIsTogglingAutoStart(true);
      await toggleAutoStart();
      feedback.show(
        "success",
        isAutoStartEnabled
          ? t("settings.app.autoStartDisabled")
          : t("settings.app.autoStartEnabled"),
      );
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    } finally {
      setIsTogglingAutoStart(false);
    }
  }

  return (
    <SettingsGroup title={t("settings.app.title")}>
      <SettingsRow label={t("settings.app.language")} htmlFor="locale-select">
        <Select value={selectedLocale} onValueChange={(val) => void handleLocaleChange(val)}>
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
      </SettingsRow>

      <SettingsRow
        label={t("settings.app.transcriptionLanguage")}
        description={t("settings.app.transcriptionLanguageDescription")}
        htmlFor="transcription-locale-select"
      >
        <Select
          value={selectedTranscriptionLocale}
          onValueChange={(val) => void handleTranscriptionLocaleChange(val)}
        >
          <SelectTrigger id="transcription-locale-select" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRANSCRIPTION_LANGUAGE_OPTIONS.map((opt) => (
              <SelectItem key={opt.locale} value={opt.locale}>
                {opt.locale === "auto" ? t("settings.app.autoDetect") : opt.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        label={t("settings.app.autoStart")}
        description={t("settings.app.autoStartDescription")}
        htmlFor="auto-start"
      >
        <Switch
          id="auto-start"
          checked={isAutoStartEnabled}
          disabled={isTogglingAutoStart}
          onCheckedChange={() => void handleToggleAutoStart()}
        />
      </SettingsRow>

      <SettingsFeedback message={feedback.message} type={feedback.type} />
    </SettingsGroup>
  );
}
