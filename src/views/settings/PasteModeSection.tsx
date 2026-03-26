import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsRow, SettingsFeedback } from "@/components/settings-layout";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";

type PasteMode = "auto-paste" | "copy-only";

const PASTE_MODES: {
  value: PasteMode;
  labelKey: string;
  descKey: string;
}[] = [
  {
    value: "auto-paste",
    labelKey: "settings.pasteMode.autoPaste",
    descKey: "settings.pasteMode.autoPasteDescription",
  },
  {
    value: "copy-only",
    labelKey: "settings.pasteMode.copyOnly",
    descKey: "settings.pasteMode.copyOnlyDescription",
  },
];

export default function PasteModeSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const pasteMode = useSettingsStore((s) => s.pasteMode);
  const savePasteMode = useSettingsStore((s) => s.savePasteMode);

  async function handleChange(mode: PasteMode) {
    try {
      await savePasteMode(mode);
      feedback.show("success", t("settings.pasteMode.updated"));
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <SettingsGroup
      title={t("settings.pasteMode.title")}
      description={t("settings.pasteMode.description")}
    >
      <SettingsRow vertical>
        <div className="grid grid-cols-2 gap-2">
          {PASTE_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-md border p-3 text-left transition-colors",
                pasteMode === mode.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50",
              )}
              onClick={() => void handleChange(mode.value)}
            >
              <Label className="cursor-pointer text-sm font-medium">{t(mode.labelKey)}</Label>
              <p className="text-xs leading-relaxed text-muted-foreground">{t(mode.descKey)}</p>
            </button>
          ))}
        </div>
      </SettingsRow>

      <SettingsFeedback message={feedback.message} type={feedback.type} />
    </SettingsGroup>
  );
}
