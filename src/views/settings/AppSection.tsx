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
import { useSettingsStore, type SuccessDisplayDurationSec } from "@/stores/settingsStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";
import {
  LANGUAGE_OPTIONS,
  TRANSCRIPTION_LANGUAGE_OPTIONS,
  type SupportedLocale,
  type TranscriptionLocale,
} from "@/i18n/languageConfig";

const DURATION_OPTIONS: SuccessDisplayDurationSec[] = [1, 1.5, 2, 3, 5];

export default function AppSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const selectedLocale = useSettingsStore((s) => s.selectedLocale);
  const selectedTranscriptionLocale = useSettingsStore((s) => s.selectedTranscriptionLocale);
  const isAutoStartEnabled = useSettingsStore((s) => s.isAutoStartEnabled);
  const isCopyResultToClipboard = useSettingsStore((s) => s.isCopyResultToClipboard);
  const successDisplayDurationSec = useSettingsStore((s) => s.successDisplayDurationSec);
  const saveLocale = useSettingsStore((s) => s.saveLocale);
  const saveTranscriptionLocale = useSettingsStore((s) => s.saveTranscriptionLocale);
  const toggleAutoStart = useSettingsStore((s) => s.toggleAutoStart);
  const loadAutoStartStatus = useSettingsStore((s) => s.loadAutoStartStatus);
  const saveCopyResultToClipboard = useSettingsStore((s) => s.saveCopyResultToClipboard);
  const saveSuccessDisplayDuration = useSettingsStore((s) => s.saveSuccessDisplayDuration);

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

  async function handleToggleCopyResultToClipboard(newValue: boolean) {
    try {
      await saveCopyResultToClipboard(newValue);
      feedback.show(
        "success",
        newValue
          ? t("settings.copyResultToClipboard.enabled")
          : t("settings.copyResultToClipboard.disabled"),
      );
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSuccessDisplayDurationChange(value: string) {
    try {
      const sec = Number(value) as SuccessDisplayDurationSec;
      await saveSuccessDisplayDuration(sec);
      feedback.show("success", t("settings.successDisplayDuration.updated"));
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
        label={t("settings.copyResultToClipboard.label")}
        description={t("settings.copyResultToClipboard.description")}
        htmlFor="copy-result-to-clipboard"
      >
        <Switch
          id="copy-result-to-clipboard"
          checked={isCopyResultToClipboard}
          onCheckedChange={(val) => void handleToggleCopyResultToClipboard(val)}
        />
      </SettingsRow>

      <SettingsRow
        label={t("settings.successDisplayDuration.label")}
        description={t("settings.successDisplayDuration.description")}
        htmlFor="success-display-duration"
      >
        <Select
          value={String(successDisplayDurationSec)}
          onValueChange={(val) => void handleSuccessDisplayDurationChange(val)}
        >
          <SelectTrigger id="success-display-duration" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DURATION_OPTIONS.map((sec) => (
              <SelectItem key={sec} value={String(sec)}>
                {t("settings.successDisplayDuration.seconds", { value: sec })}
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
