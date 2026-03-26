import ApiKeySection from "@/views/settings/ApiKeySection";
import ModelSection from "@/views/settings/ModelSection";
import PromptSection from "@/views/settings/PromptSection";
import EnhancementSection from "@/views/settings/EnhancementSection";
import ContextAwareSection from "@/views/settings/ContextAwareSection";

export default function AiSettingsView() {
  return (
    <div className="flex h-full flex-col">
      <div className="relative flex-1 overflow-y-auto">
        <div className="pointer-events-none sticky top-0 z-10 h-3 bg-gradient-to-b from-background to-transparent" />

        <div className="space-y-8 px-6 pb-8">
          <ApiKeySection />
          <ModelSection />
          <PromptSection />
          <EnhancementSection />
          <ContextAwareSection />
        </div>

        <div className="pointer-events-none sticky bottom-0 z-10 h-3 bg-gradient-to-t from-background to-transparent" />
      </div>
    </div>
  );
}
