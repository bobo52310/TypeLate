import AppSection from "@/views/settings/AppSection";
import HotkeySection from "@/views/settings/HotkeySection";
import AudioSection from "@/views/settings/AudioSection";
import RecordingSection from "@/views/settings/RecordingSection";
import AboutSection from "@/views/settings/AboutSection";
import PermissionsSection from "@/views/settings/PermissionsSection";
import { useHashRouter } from "@/app/router";

function getSettingsTab(): string {
  const hash = window.location.hash;
  if (hash.includes("/settings/voice")) return "voice";
  if (hash.includes("/settings/permissions")) return "permissions";
  if (hash.includes("/settings/about")) return "about";
  return "general";
}

export default function SettingsView() {
  // Subscribe to route changes so the view re-renders on navigation
  useHashRouter();
  const activeTab = getSettingsTab();

  return (
    <div className="flex h-full flex-col">
      {/* Content */}
      <div className="relative flex-1 overflow-y-auto">
        {/* Top scroll shadow */}
        <div className="pointer-events-none sticky top-0 z-10 h-3 bg-gradient-to-b from-background to-transparent" />

        <div className="space-y-8 px-6 pb-8">
          {activeTab === "general" && (
            <>
              <AppSection />
              <HotkeySection />
            </>
          )}

          {activeTab === "voice" && (
            <>
              <AudioSection />
              <RecordingSection />
            </>
          )}

          {activeTab === "permissions" && <PermissionsSection />}

          {activeTab === "about" && <AboutSection />}
        </div>

        {/* Bottom scroll shadow */}
        <div className="pointer-events-none sticky bottom-0 z-10 h-3 bg-gradient-to-t from-background to-transparent" />
      </div>
    </div>
  );
}
