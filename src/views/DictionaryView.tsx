import SmartDictionarySection from "@/views/settings/SmartDictionarySection";
import VocabularyListSection from "@/views/settings/VocabularyListSection";
import GoogleDriveSyncSection from "@/views/settings/GoogleDriveSyncSection";

export default function DictionaryView() {
  return (
    <div className="space-y-8 p-6">
      <VocabularyListSection />
      <SmartDictionarySection />
      <GoogleDriveSyncSection />
    </div>
  );
}
