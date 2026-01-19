import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
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
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="text-base">{t("settings.pasteMode.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("settings.pasteMode.description")}
        </p>

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
              <Label className="text-sm font-medium cursor-pointer">{t(mode.labelKey)}</Label>
              <p className="text-xs leading-relaxed text-muted-foreground">{t(mode.descKey)}</p>
            </button>
          ))}
        </div>

        {feedback.message && (
          <p
            className={`text-sm ${
              feedback.type === "success" ? "text-primary" : "text-destructive"
            }`}
          >
            {feedback.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
