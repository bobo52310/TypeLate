import AboutSection from "@/views/settings/AboutSection";
import HotkeySection from "@/views/settings/HotkeySection";
import ApiKeySection from "@/views/settings/ApiKeySection";
import PromptSection from "@/views/settings/PromptSection";
import EnhancementSection from "@/views/settings/EnhancementSection";
import ModelSection from "@/views/settings/ModelSection";
import AudioSection from "@/views/settings/AudioSection";
import SmartDictionarySection from "@/views/settings/SmartDictionarySection";
import RecordingSection from "@/views/settings/RecordingSection";
import AppSection from "@/views/settings/AppSection";

export default function SettingsView() {
  return (
    <div className="space-y-6 p-6">
      <AboutSection />
      <HotkeySection />
      <ApiKeySection />
      <PromptSection />
      <EnhancementSection />
      <ModelSection />
      <AudioSection />
      <SmartDictionarySection />
      <RecordingSection />
      <AppSection />
    </div>
  );
}
