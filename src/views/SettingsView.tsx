import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

import AppSection from "@/views/settings/AppSection";
import HotkeySection from "@/views/settings/HotkeySection";
import AudioSection from "@/views/settings/AudioSection";
import RecordingSection from "@/views/settings/RecordingSection";
import ApiKeySection from "@/views/settings/ApiKeySection";
import ModelSection from "@/views/settings/ModelSection";
import PromptSection from "@/views/settings/PromptSection";
import EnhancementSection from "@/views/settings/EnhancementSection";
import SmartDictionarySection from "@/views/settings/SmartDictionarySection";
import VocabularyListSection from "@/views/settings/VocabularyListSection";
import GoogleDriveSyncSection from "@/views/settings/GoogleDriveSyncSection";
import PasteModeSection from "@/views/settings/PasteModeSection";
import ContextAwareSection from "@/views/settings/ContextAwareSection";
import AboutSection from "@/views/settings/AboutSection";

interface SettingsTab {
  id: string;
  labelKey: string;
}

const SETTINGS_TABS: SettingsTab[] = [
  { id: "general", labelKey: "settings.group.general" },
  { id: "voice", labelKey: "settings.group.voice" },
  { id: "ai", labelKey: "settings.group.ai" },
  { id: "dictionary", labelKey: "settings.group.dictionary" },
  { id: "about", labelKey: "settings.group.about" },
];

export default function SettingsView() {
  const { t } = useTranslation();

  // Support deep-linking via hash param: #/settings?tab=ai
  const [activeTab, setActiveTab] = useState(() => {
    const hash = window.location.hash;
    const match = hash.match(/[?&]tab=(\w+)/);
    if (match) {
      const tab = match[1];
      if (SETTINGS_TABS.some((t) => t.id === tab)) return tab;
    }
    return "general";
  });

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="shrink-0 border-b border-border px-5 pt-4">
        <div className="flex gap-1">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              className={cn(
                "rounded-t-md px-3 py-1.5 text-sm transition-colors",
                activeTab === tab.id
                  ? "border-b-2 border-primary font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setActiveTab(tab.id)}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-6 p-6">
          {activeTab === "general" && (
            <>
              <AppSection />
              <PasteModeSection />
              <HotkeySection />
            </>
          )}

          {activeTab === "voice" && (
            <>
              <AudioSection />
              <RecordingSection />
            </>
          )}

          {activeTab === "ai" && (
            <>
              <ApiKeySection />
              <ModelSection />
              <PromptSection />
              <EnhancementSection />
              <ContextAwareSection />
            </>
          )}

          {activeTab === "dictionary" && (
            <>
              <SmartDictionarySection />
              <VocabularyListSection />
              <GoogleDriveSyncSection />
            </>
          )}

          {activeTab === "about" && <AboutSection />}
        </div>
      </div>
    </div>
  );
}
