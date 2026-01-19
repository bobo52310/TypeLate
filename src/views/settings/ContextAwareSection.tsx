import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFeedbackMessage } from "@/hooks/useFeedbackMessage";
import type { AppCategory } from "@/lib/appContextMap";

interface CategoryInfo {
  category: AppCategory;
  labelKey: string;
  apps: string[];
}

const CATEGORY_LIST: CategoryInfo[] = [
  {
    category: "email",
    labelKey: "settings.contextAware.categories.email",
    apps: ["Mail", "Outlook"],
  },
  {
    category: "chat",
    labelKey: "settings.contextAware.categories.chat",
    apps: ["Slack", "Discord", "Telegram", "LINE", "Messages"],
  },
  {
    category: "ide",
    labelKey: "settings.contextAware.categories.ide",
    apps: ["VS Code", "Xcode", "Terminal", "iTerm", "Warp"],
  },
  {
    category: "notes",
    labelKey: "settings.contextAware.categories.notes",
    apps: ["Notes", "Obsidian", "Notion", "Bear"],
  },
];

export default function ContextAwareSection() {
  const { t } = useTranslation();
  const feedback = useFeedbackMessage();

  const isContextAwareEnabled = useSettingsStore((s) => s.isContextAwareEnabled);
  const saveContextAwareEnabled = useSettingsStore((s) => s.saveContextAwareEnabled);

  async function handleToggle(newValue: boolean) {
    try {
      await saveContextAwareEnabled(newValue);
      feedback.show(
        "success",
        t(newValue ? "settings.contextAware.enabled" : "settings.contextAware.disabled"),
      );
    } catch (err) {
      feedback.show("error", err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="text-base">{t("settings.contextAware.title")}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor="context-aware-toggle" className="text-sm font-medium">
              {t("settings.contextAware.title")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.contextAware.description")}
            </p>
          </div>
          <Switch
            id="context-aware-toggle"
            checked={isContextAwareEnabled}
            onCheckedChange={handleToggle}
          />
        </div>

        {feedback.message && (
          <p
            className={`mt-2 text-sm ${
              feedback.type === "success" ? "text-primary" : "text-destructive"
            }`}
          >
            {feedback.message}
          </p>
        )}

        {isContextAwareEnabled && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t("settings.contextAware.categoriesTitle")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORY_LIST.map((cat) => (
                <div
                  key={cat.category}
                  className="rounded-lg border border-border px-3 py-2"
                >
                  <p className="text-sm font-medium">{t(cat.labelKey)}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {cat.apps.map((app) => (
                      <Badge key={app} variant="secondary" className="text-[10px]">
                        {app}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
