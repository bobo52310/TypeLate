import SmartDictionarySection from "@/views/settings/SmartDictionarySection";
import TextAnalyzerSection from "@/views/settings/TextAnalyzerSection";
import VocabularyListSection from "@/views/settings/VocabularyListSection";
import CloudSyncSection from "@/views/settings/CloudSyncSection";

export default function DictionaryView() {
  return (
    <div className="space-y-8 p-6">
      <VocabularyListSection />
      <TextAnalyzerSection />
      <SmartDictionarySection />
      <CloudSyncSection />
    </div>
  );
}
