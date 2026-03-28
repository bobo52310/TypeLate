import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { SyncProvider, SyncDisplayInfo } from "@/lib/syncEngine";

const VOCAB_FILENAME = "typelate-vocabulary.json";

/**
 * Open a native folder picker and return the selected path, or null if cancelled.
 */
export async function pickSyncFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected === "string") return selected;
  return null;
}

/**
 * Create a SyncProvider that reads/writes vocabulary JSON to a local folder.
 * The folder is typically inside iCloud Drive, Dropbox, OneDrive, or Google Drive desktop.
 */
export function createFileSyncProvider(folderPath: string): SyncProvider {
  const filePath = `${folderPath}/${VOCAB_FILENAME}`;

  return {
    id: "file",

    async read(): Promise<string | null> {
      return await invoke<string | null>("read_sync_file", { path: filePath });
    },

    async write(content: string): Promise<void> {
      await invoke("write_sync_file", { path: filePath, content });
    },

    isConfigured(): boolean {
      return folderPath.length > 0;
    },

    getDisplayInfo(): SyncDisplayInfo {
      // Show a shortened path for display
      const home = folderPath.replace(/^\/Users\/[^/]+/, "~");
      return {
        label: "folder",
        detail: home,
      };
    },
  };
}
