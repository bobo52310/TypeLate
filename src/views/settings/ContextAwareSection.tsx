import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { SettingsGroup, SettingsRow, SettingsFeedback } from "@/components/settings-layout";
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
    <SettingsGroup title={t("settings.contextAware.title")}>
      <SettingsRow
        label={t("settings.contextAware.title")}
        description={t("settings.contextAware.description")}
        htmlFor="context-aware-toggle"
      >
        <Switch
          id="context-aware-toggle"
          checked={isContextAwareEnabled}
          onCheckedChange={handleToggle}
        />
      </SettingsRow>

      {isContextAwareEnabled && (
        <div className="space-y-2 px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground">
            {t("settings.contextAware.categoriesTitle")}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORY_LIST.map((cat) => (
              <div key={cat.category} className="rounded-lg border border-border px-3 py-2">
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

      <SettingsFeedback message={feedback.message} type={feedback.type} />
    </SettingsGroup>
  );
}
