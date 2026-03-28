import { uploadVocabulary } from "@/lib/googleDriveSync";
import { useVocabularyStore } from "@/stores/vocabularyStore";
import type { SyncProvider, SyncDisplayInfo } from "@/lib/syncEngine";

/**
 * Create a SyncProvider backed by Google Drive appDataFolder.
 * Wraps the existing googleAuth + googleDriveSync modules.
 *
 * Note: Google Drive sync uses its own read/merge flow in syncStore.syncNow(),
 * so this provider's read() returns null. Only write() is used independently.
 */
export function createGoogleDriveSyncProvider(
  clientId: string,
  userEmail: string | null,
): SyncProvider {
  return {
    id: "google-drive",

    async read(): Promise<string | null> {
      // Google Drive sync handled via syncVocabulary() in syncStore
      return null;
    },

    async write(_content: string): Promise<void> {
      const vocabularyStore = useVocabularyStore.getState();
      await uploadVocabulary(clientId, vocabularyStore.termList);
    },

    isConfigured(): boolean {
      return clientId.trim().length > 0;
    },

    getDisplayInfo(): SyncDisplayInfo {
      return {
        label: "google-drive",
        detail: userEmail ?? "",
      };
    },
  };
}
