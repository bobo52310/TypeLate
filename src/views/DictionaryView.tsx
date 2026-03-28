import SmartDictionarySection from "@/views/settings/SmartDictionarySection";
import VocabularyListSection from "@/views/settings/VocabularyListSection";
import CloudSyncSection from "@/views/settings/CloudSyncSection";

export default function DictionaryView() {
  return (
    <div className="space-y-8 p-6">
      <VocabularyListSection />
      <SmartDictionarySection />
      <CloudSyncSection />
    </div>
  );
}
