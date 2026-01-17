import { useEffect, useRef, useState } from "react";
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
import AboutSection from "@/views/settings/AboutSection";

interface SettingsGroup {
  id: string;
  labelKey: string;
}

const SETTINGS_GROUPS: SettingsGroup[] = [
  { id: "general", labelKey: "settings.group.general" },
  { id: "voice", labelKey: "settings.group.voice" },
  { id: "ai", labelKey: "settings.group.ai" },
  { id: "about", labelKey: "settings.group.about" },
];

export default function SettingsView() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState("general");
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Scrollspy with IntersectionObserver
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      {
        root: container,
        rootMargin: "-20% 0px -70% 0px",
        threshold: 0,
      },
    );

    for (const group of SETTINGS_GROUPS) {
      const el = document.getElementById(group.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  function scrollToSection(id: string) {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <div className="flex h-full">
      {/* Side nav */}
      <nav className="sticky top-0 shrink-0 w-40 border-r border-border p-4">
        <ul className="space-y-1">
          {SETTINGS_GROUPS.map((group) => (
            <li key={group.id}>
              <button
                className={cn(
                  "w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                  activeSection === group.id
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
                onClick={() => scrollToSection(group.id)}
              >
                {t(group.labelKey)}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {/* General */}
        <section id="general" className="space-y-6 p-6">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("settings.group.general")}
          </h2>
          <AppSection />
          <HotkeySection />
        </section>

        {/* Voice & Audio */}
        <section id="voice" className="space-y-6 border-t border-border p-6">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("settings.group.voice")}
          </h2>
          <AudioSection />
          <RecordingSection />
        </section>

        {/* AI & Enhancement */}
        <section id="ai" className="space-y-6 border-t border-border p-6">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("settings.group.ai")}
          </h2>
          <ApiKeySection />
          <ModelSection />
          <PromptSection />
          <EnhancementSection />
          <SmartDictionarySection />
          <VocabularyListSection />
        </section>

        {/* About */}
        <section id="about" className="space-y-6 border-t border-border p-6">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("settings.group.about")}
          </h2>
          <AboutSection />
        </section>
      </div>
    </div>
  );
}
