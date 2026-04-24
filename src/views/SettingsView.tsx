import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHashRouter } from "@/app/router";

// Section components (existing implementations, rendered under the V1 shell)
import HotkeySection from "@/views/settings/HotkeySection";
import AudioSection from "@/views/settings/AudioSection";
import RecordingSection from "@/views/settings/RecordingSection";
import ProviderSection from "@/views/settings/ProviderSection";
import ModelSection from "@/views/settings/ModelSection";
import EnhancementSection from "@/views/settings/EnhancementSection";
import PromptSection from "@/views/settings/PromptSection";
import SmartDictionarySection from "@/views/settings/SmartDictionarySection";
import ContextAwareSection from "@/views/settings/ContextAwareSection";
import AppSection from "@/views/settings/AppSection";
import CloudSyncSection from "@/views/settings/CloudSyncSection";
import PermissionsSection from "@/views/settings/PermissionsSection";
import AboutSection from "@/views/settings/AboutSection";

// ── Sidebar structure (mirrors wireframe) ──

type SectionId =
  | "hotkey"
  | "microphone"
  | "sound"
  | "retention"
  | "ai-models"
  | "enhancement"
  | "dictionary"
  | "context"
  | "language-sync"
  | "permissions"
  | "about";

interface SectionEntry {
  id: SectionId;
  glyph: string;
  labelKey: string;
  groupKey: "recording" | "text" | "general";
  subtitleKey: string;
}

const DEFAULT_HOTKEY_SECTION: SectionEntry = {
  id: "hotkey",
  glyph: "⌨︎",
  labelKey: "settings.v1.section.hotkey",
  subtitleKey: "settings.v1.section.hotkeySub",
  groupKey: "recording",
};

const SECTIONS: SectionEntry[] = [
  DEFAULT_HOTKEY_SECTION,
  {
    id: "microphone",
    glyph: "🎤",
    labelKey: "settings.v1.section.microphone",
    subtitleKey: "settings.v1.section.microphoneSub",
    groupKey: "recording",
  },
  {
    id: "sound",
    glyph: "♪",
    labelKey: "settings.v1.section.sound",
    subtitleKey: "settings.v1.section.soundSub",
    groupKey: "recording",
  },
  {
    id: "retention",
    glyph: "◉",
    labelKey: "settings.v1.section.retention",
    subtitleKey: "settings.v1.section.retentionSub",
    groupKey: "recording",
  },
  {
    id: "ai-models",
    glyph: "⚡",
    labelKey: "settings.v1.section.aiModels",
    subtitleKey: "settings.v1.section.aiModelsSub",
    groupKey: "text",
  },
  {
    id: "enhancement",
    glyph: "✎",
    labelKey: "settings.v1.section.enhancement",
    subtitleKey: "settings.v1.section.enhancementSub",
    groupKey: "text",
  },
  {
    id: "dictionary",
    glyph: "⊞",
    labelKey: "settings.v1.section.dictionary",
    subtitleKey: "settings.v1.section.dictionarySub",
    groupKey: "text",
  },
  {
    id: "context",
    glyph: "👁",
    labelKey: "settings.v1.section.context",
    subtitleKey: "settings.v1.section.contextSub",
    groupKey: "text",
  },
  {
    id: "language-sync",
    glyph: "🌐",
    labelKey: "settings.v1.section.languageSync",
    subtitleKey: "settings.v1.section.languageSyncSub",
    groupKey: "general",
  },
  {
    id: "permissions",
    glyph: "🔒",
    labelKey: "settings.v1.section.permissions",
    subtitleKey: "settings.v1.section.permissionsSub",
    groupKey: "general",
  },
  {
    id: "about",
    glyph: "ℹ",
    labelKey: "settings.v1.section.about",
    subtitleKey: "settings.v1.section.aboutSub",
    groupKey: "general",
  },
];

const GROUP_ORDER: { key: "recording" | "text" | "general"; glyph: string; labelKey: string }[] = [
  { key: "recording", glyph: "🎙", labelKey: "settings.v1.group.recording" },
  { key: "text", glyph: "✦", labelKey: "settings.v1.group.text" },
  { key: "general", glyph: "⚙", labelKey: "settings.v1.group.general" },
];

// Default section for each hash-route
function defaultSectionForHash(hash: string): SectionId {
  if (hash.includes("/settings/voice")) return "microphone";
  if (hash.includes("/settings/permissions")) return "permissions";
  if (hash.includes("/settings/about")) return "about";
  return "hotkey";
}

export default function SettingsView() {
  const { t } = useTranslation();
  const { currentPath } = useHashRouter();
  const [activeSection, setActiveSection] = useState<SectionId>(() =>
    defaultSectionForHash(window.location.hash),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // When the router moves to a different /settings/* path, pick its default section
  useEffect(() => {
    if (currentPath.startsWith("/settings"))
      setActiveSection(defaultSectionForHash(currentPath));
  }, [currentPath]);

  // ⌘F / Ctrl+F focuses the in-page search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const activeEntry = useMemo<SectionEntry>(
    () => SECTIONS.find((s) => s.id === activeSection) ?? DEFAULT_HOTKEY_SECTION,
    [activeSection],
  );

  const q = searchQuery.trim().toLowerCase();
  const filteredSections = useMemo(() => {
    if (!q) return SECTIONS;
    return SECTIONS.filter((s) => {
      const label = t(s.labelKey).toLowerCase();
      const sub = t(s.subtitleKey).toLowerCase();
      return label.includes(q) || sub.includes(q);
    });
  }, [q, t]);

  const activeGroup = GROUP_ORDER.find((g) => g.key === activeEntry.groupKey);
  const activeGroupLabel = activeGroup ? t(activeGroup.labelKey) : "";

  return (
    <div className="flex h-full">
      {/* ── Inner sidebar ── */}
      <aside
        className="flex shrink-0 flex-col"
        style={{
          width: 210,
          background: "var(--v1-paper-2)",
          borderRight: "1.5px solid var(--v1-line)",
          padding: "14px 10px",
          gap: 4,
        }}
      >
        <div style={{ padding: "0 6px 10px", fontSize: 13, fontWeight: 700 }}>
          {t("settings.v1.title")}
        </div>

        {GROUP_ORDER.map((group) => {
          const items = filteredSections.filter((s) => s.groupKey === group.key);
          if (items.length === 0) return null;
          return (
            <div key={group.key}>
              <div
                className="font-hand"
                style={{
                  padding: "8px 6px 4px",
                  fontSize: 10,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  color: "var(--v1-ink-3)",
                }}
              >
                {group.glyph} {t(group.labelKey)}
              </div>
              {items.map((s) => {
                const isActive = s.id === activeSection;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={"v1-nav-item" + (isActive ? " active" : "")}
                    onClick={() => setActiveSection(s.id)}
                  >
                    <span
                      style={{ width: 14, textAlign: "center", fontSize: 13 }}
                      aria-hidden
                    >
                      {s.glyph}
                    </span>
                    <span style={{ flex: 1, fontWeight: isActive ? 600 : 400 }}>
                      {t(s.labelKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}

        <div style={{ flex: 1 }} />

        <div
          className="v1-rough-dash"
          style={{
            padding: 10,
            fontSize: 11,
            color: "var(--v1-ink-3)",
          }}
        >
          <span className="v1-kbd">⌘</span>
          <span style={{ margin: "0 4px" }}>,</span>
          {t("settings.v1.shortcutOpen")} · <span className="v1-kbd">⌘</span>
          <span className="v1-kbd">F</span> {t("settings.v1.shortcutSearch")}
        </div>
      </aside>

      {/* ── Content ── */}
      <section
        className="v1-paper flex-1 overflow-auto"
        style={{ padding: "22px 28px" }}
      >
        {/* Search bar */}
        <div
          className="v1-rough mb-5 flex items-center gap-2"
          style={{ padding: "8px 12px", background: "#fff" }}
        >
          <span style={{ fontSize: 13, color: "var(--v1-ink-3)" }}>⌕</span>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("settings.v1.searchPlaceholder")}
            style={{
              flex: 1,
              background: "transparent",
              border: 0,
              outline: "none",
              fontSize: 12,
              color: "var(--v1-ink)",
            }}
          />
          <span className="v1-kbd">⌘</span>
          <span className="v1-kbd">F</span>
        </div>

        {/* Title + breadcrumb */}
        <div className="mb-1 flex items-baseline gap-2.5">
          <div className="font-hand" style={{ fontSize: 22, fontWeight: 700 }}>
            {t(activeEntry.labelKey)}
          </div>
          <div style={{ fontSize: 12, color: "var(--v1-ink-3)" }}>
            {t(activeEntry.subtitleKey)}
          </div>
        </div>
        <div className="mb-4" style={{ fontSize: 11, color: "var(--v1-ink-4)" }}>
          {activeGroupLabel} › {t(activeEntry.labelKey)}
        </div>

        {/* Section content */}
        <div className="space-y-4">
          <SectionContent sectionId={activeSection} />
        </div>
      </section>
    </div>
  );
}

function SectionContent({ sectionId }: { sectionId: SectionId }) {
  switch (sectionId) {
    case "hotkey":
      return <HotkeySection />;
    case "microphone":
      return <AudioSection />;
    case "sound":
      return <AudioSection />;
    case "retention":
      return <RecordingSection />;
    case "ai-models":
      return (
        <>
          <ProviderSection />
          <ModelSection />
        </>
      );
    case "enhancement":
      return (
        <>
          <EnhancementSection />
          <PromptSection />
        </>
      );
    case "dictionary":
      return <SmartDictionarySection />;
    case "context":
      return <ContextAwareSection />;
    case "language-sync":
      return (
        <>
          <AppSection />
          <CloudSyncSection />
        </>
      );
    case "permissions":
      return <PermissionsSection />;
    case "about":
      return <AboutSection />;
  }
}
